"use strict";

/* =========================================================
   Gemini Live 音声アシスタント（無料枠向け）

   - 通常のGEMINI_API_KEYはブラウザーへ置かない。
   - Supabase Edge Functionが短時間有効なephemeral tokenを発行する。
   - ブラウザーはGemini Live APIへWebSocketで直接接続する。
   - 読み上げだけならマイクを使わない。
   - AIアシスタント中だけマイクを使う。
   ========================================================= */

(() => {
  const MODEL = "gemini-3.8-live";
  const TOKEN_FUNCTION_NAME = "gemini-live-token";
  const LIVE_WS_BASE =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
  const OUTPUT_SAMPLE_RATE = 24000;
  const INPUT_SAMPLE_RATE = 16000;

  let websocket = null;
  let connectPromise = null;
  let setupPromise = null;
  let setupResolve = null;
  let setupReject = null;
  let sessionKey = "";
  let interactiveMode = false;
  let lastContext = "";

  let micStream = null;
  let inputAudioContext = null;
  let inputSource = null;
  let inputProcessor = null;
  let silentGain = null;

  let outputAudioContext = null;
  let nextPlaybackTime = 0;
  const activeSources = new Set();

  function dispatchStatus(state, message, extra = {}) {
    window.dispatchEvent(new CustomEvent("parking:gemini-voice-status", {
      detail: {
        state,
        message,
        assistantActive: Boolean(
          websocket
          && websocket.readyState === WebSocket.OPEN
          && interactiveMode
        ),
        ...extra,
      },
    }));
  }

  function getRemoteConfig() {
    return window.PARKING_REMOTE_CONFIG ?? {};
  }

  function isSupported() {
    const config = getRemoteConfig();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    return Boolean(
      config.enabled
      && config.supabaseUrl
      && "WebSocket" in window
      && AudioContextClass
      && navigator.mediaDevices,
    );
  }

  function getTokenEndpoint() {
    const base = String(getRemoteConfig().supabaseUrl ?? "").replace(/\/$/, "");
    return base ? `${base}/functions/v1/${TOKEN_FUNCTION_NAME}` : "";
  }

  async function requestEphemeralToken() {
    const endpoint = getTokenEndpoint();
    if (!endpoint) {
      throw new Error("Gemini音声用のSupabase設定がありません。");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Gemini音声の一時トークンを取得できませんでした（${response.status}）${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      );
    }

    const payload = await response.json();
    const token = String(payload?.name ?? payload?.token ?? "").trim();
    if (!token) {
      throw new Error("Gemini音声の一時トークン形式が正しくありません。");
    }
    return token;
  }

  function buildInstructions(language, contextText = "") {
    const context = contextText?.trim()
      ? `\n\nCURRENT PARKING APP CONTEXT:\n${contextText.trim()}`
      : "";

    if (language === "en") {
      return `You are the spoken parking assistant for a university graduation-research prototype.
Speak in clear, easy English. Use short sentences, common words, and a calm pace.
Parking-space numbers must be spoken slowly and clearly.
Never invent parking availability, space numbers, distances, entrances, or routes.
Use only the app context below. If information is missing, say that it is not available.
If the user asks for screen operation while driving, tell them to ask a passenger or stop safely first.
When the user's text begins with [GUIDANCE_TO_READ], read only the text after that marker naturally, without a preface or extra facts.
For normal conversation, answer in at most two short sentences unless more detail is requested.${context}`;
    }

    return `あなたは大学の卒業研究用「駐車場空き区画案内Web」の音声アシスタントです。
日本語で、車内でも聞き取りやすいように短く、明瞭に、落ち着いた速さで話してください。
駐車区画番号は特にはっきり、少し間を取って読み上げてください。
駐車区画の空き状況、区画番号、距離、入口、経路を推測して作らないでください。
下記の駐車場アプリ情報にある内容だけを事実として使い、不明な情報は「確認できません」と伝えてください。
運転中に画面操作を求められた場合は、同乗者へ依頼するか安全な場所に停車してから操作するよう案内してください。
ユーザーの入力が [GUIDANCE_TO_READ] で始まる場合、その後の文章だけを前置きや追加情報なしで自然に読み上げてください。
通常の会話は、詳しい説明を求められない限り2文以内を基本にしてください。${context}`;
  }

  function normalizeVoiceName(voice) {
    const allowed = new Set(["Kore", "Puck", "Aoede", "Charon"]);
    return allowed.has(voice) ? voice : "Kore";
  }

  function base64ToInt16(base64) {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(buffer);
  }

  function int16ToBase64(samples) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    }
    return btoa(binary);
  }

  function floatToInt16(samples) {
    const result = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      result[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
    }
    return result;
  }

  function resampleFloat32(input, inputRate, outputRate) {
    if (inputRate === outputRate) return input.slice();
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(input.length - 1, left + 1);
      const fraction = position - left;
      output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  async function ensureOutputContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!outputAudioContext || outputAudioContext.state === "closed") {
      outputAudioContext = new AudioContextClass();
      nextPlaybackTime = 0;
    }
    if (outputAudioContext.state === "suspended") {
      await outputAudioContext.resume();
    }
    return outputAudioContext;
  }

  function stopOutputAudio() {
    activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* 既に停止済みでも続行する。 */
      }
    });
    activeSources.clear();
    nextPlaybackTime = outputAudioContext?.currentTime ?? 0;
  }

  async function playPcmChunk(base64Audio) {
    if (!base64Audio) return;
    const context = await ensureOutputContext();
    const int16 = base64ToInt16(base64Audio);
    if (!int16.length) return;

    const buffer = context.createBuffer(1, int16.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i += 1) {
      channel[i] = int16[i] / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.015, nextPlaybackTime);
    source.start(startAt);
    nextPlaybackTime = startAt + buffer.duration;
    activeSources.add(source);
    source.addEventListener("ended", () => activeSources.delete(source), { once: true });
  }

  function sendMessage(payload) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      throw new Error("Gemini音声が接続されていません。");
    }
    websocket.send(JSON.stringify(payload));
  }

  async function stopMicrophone() {
    if (inputProcessor) {
      try { inputProcessor.disconnect(); } catch {}
      inputProcessor.onaudioprocess = null;
      inputProcessor = null;
    }
    if (inputSource) {
      try { inputSource.disconnect(); } catch {}
      inputSource = null;
    }
    if (silentGain) {
      try { silentGain.disconnect(); } catch {}
      silentGain = null;
    }
    if (inputAudioContext) {
      try { await inputAudioContext.close(); } catch {}
      inputAudioContext = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      micStream = null;
    }
  }

  async function startMicrophone() {
    if (micStream) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    inputAudioContext = new AudioContextClass();
    if (inputAudioContext.state === "suspended") {
      await inputAudioContext.resume();
    }

    inputSource = inputAudioContext.createMediaStreamSource(micStream);
    inputProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
    silentGain = inputAudioContext.createGain();
    silentGain.gain.value = 0;

    inputProcessor.onaudioprocess = (event) => {
      if (!websocket || websocket.readyState !== WebSocket.OPEN || !interactiveMode) return;

      const input = event.inputBuffer.getChannelData(0);
      const resampled = resampleFloat32(input, inputAudioContext.sampleRate, INPUT_SAMPLE_RATE);
      const pcm = floatToInt16(resampled);

      try {
        sendMessage({
          realtimeInput: {
            audio: {
              data: int16ToBase64(pcm),
              mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
            },
          },
        });
      } catch {
        /* 切断直後の最後の音声チャンクは送信しない。 */
      }
    };

    inputSource.connect(inputProcessor);
    inputProcessor.connect(silentGain);
    silentGain.connect(inputAudioContext.destination);
  }

  async function disconnect({ silent = false } = {}) {
    connectPromise = null;
    sessionKey = "";
    interactiveMode = false;
    lastContext = "";

    await stopMicrophone();
    stopOutputAudio();

    if (websocket) {
      try { websocket.close(1000, "client disconnect"); } catch {}
      websocket = null;
    }

    if (!silent) {
      dispatchStatus("disconnected", "Gemini音声を停止しました。");
    }
  }

  function handleServerMessage(message) {
    let payload;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }

    if (payload.setupComplete !== undefined) {
      setupResolve?.();
      setupResolve = null;
      setupReject = null;
      dispatchStatus(
        interactiveMode ? "listening" : "ready",
        interactiveMode
          ? "Gemini AIアシスタントが質問を待っています。"
          : "Gemini音声の準備ができました。",
      );
      return;
    }

    if (payload.goAway) {
      dispatchStatus("error", "Gemini音声セッションの終了時刻が近づいています。");
      return;
    }

    if (payload.serverContent) {
      const content = payload.serverContent;

      if (content.interrupted) {
        stopOutputAudio();
        dispatchStatus("listening", "聞き取っています…");
      }

      if (content.inputTranscription?.text) {
        dispatchStatus("thinking", "内容を確認しています…", {
          userTranscript: content.inputTranscription.text,
        });
      }

      if (content.outputTranscription?.text) {
        dispatchStatus(
          interactiveMode ? "listening" : "speaking",
          "Geminiが案内しています…",
          { assistantTranscript: content.outputTranscription.text },
        );
      }

      const parts = content.modelTurn?.parts ?? [];
      parts.forEach((part) => {
        const inlineData = part.inlineData;
        if (inlineData?.data && String(inlineData.mimeType ?? "").startsWith("audio/")) {
          dispatchStatus("speaking", "Gemini音声で案内しています…");
          void playPcmChunk(inlineData.data);
        }
      });

      if (content.turnComplete) {
        dispatchStatus(
          interactiveMode ? "listening" : "ready",
          interactiveMode
            ? "Gemini AIアシスタントが質問を待っています。"
            : "読み上げが完了しました。",
        );
      }
    }
  }

  async function connect({
    language = "ja",
    voice = "Kore",
    interactive = false,
    contextText = "",
  } = {}) {
    if (!isSupported()) {
      throw new Error("この環境ではGemini Live音声を利用できません。");
    }

    const normalizedLanguage = language === "en" ? "en" : "ja";
    const normalizedVoice = normalizeVoiceName(voice);
    const nextSessionKey =
      `${normalizedLanguage}:${normalizedVoice}:${interactive ? "assistant" : "speech"}`;

    if (
      websocket
      && websocket.readyState === WebSocket.OPEN
      && sessionKey === nextSessionKey
      && lastContext === contextText
    ) {
      return;
    }

    if (connectPromise && sessionKey === nextSessionKey) {
      await connectPromise;
      return;
    }

    await disconnect({ silent: true });
    sessionKey = nextSessionKey;
    interactiveMode = Boolean(interactive);
    lastContext = contextText ?? "";

    connectPromise = (async () => {
      dispatchStatus("connecting", "Gemini Liveへ接続しています…");
      const token = await requestEphemeralToken();
      const url = `${LIVE_WS_BASE}?access_token=${encodeURIComponent(token)}`;

      setupPromise = new Promise((resolve, reject) => {
        setupResolve = resolve;
        setupReject = reject;
        window.setTimeout(() => {
          if (setupResolve) {
            setupReject?.(new Error("Gemini Liveの初期設定がタイムアウトしました。"));
            setupResolve = null;
            setupReject = null;
          }
        }, 10000);
      });

      websocket = new WebSocket(url);
      websocket.addEventListener("message", handleServerMessage);

      websocket.addEventListener("error", () => {
        setupReject?.(new Error("Gemini LiveのWebSocket接続に失敗しました。"));
        setupResolve = null;
        setupReject = null;
        dispatchStatus("error", "Gemini Liveへ接続できませんでした。");
      });

      websocket.addEventListener("close", (event) => {
        if (event.code !== 1000) {
          dispatchStatus("error", "Gemini Liveとの接続が終了しました。");
        }
      });

      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Gemini Liveへの接続がタイムアウトしました。")),
          10000,
        );

        websocket.addEventListener("open", () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });

        websocket.addEventListener("error", () => {
          window.clearTimeout(timeout);
          reject(new Error("Gemini Liveへ接続できませんでした。"));
        }, { once: true });
      });

      sendMessage({
        setup: {
          model: `models/${MODEL}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: normalizedVoice },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: buildInstructions(normalizedLanguage, lastContext) }],
          },
          inputAudioTranscription: { mode: "SMART" },
          outputAudioTranscription: {},
        },
      });

      await setupPromise;

      if (interactive) {
        await startMicrophone();
      }
    })();

    try {
      await connectPromise;
    } catch (error) {
      await disconnect({ silent: true });
      dispatchStatus("error", error?.message ?? "Gemini Liveへ接続できませんでした。");
      throw error;
    } finally {
      connectPromise = null;
    }
  }

  async function speak(text, {
    language = "ja",
    voice = "Kore",
    contextText = "",
  } = {}) {
    if (!text?.trim()) return false;

    await connect({ language, voice, interactive: false, contextText });
    stopOutputAudio();
    dispatchStatus("speaking", "Gemini音声で案内しています…");
    sendMessage({
      realtimeInput: {
        text: `[GUIDANCE_TO_READ]\n${text.trim()}`,
      },
    });
    return true;
  }

  async function startAssistant({
    language = "ja",
    voice = "Kore",
    contextText = "",
  } = {}) {
    await connect({ language, voice, interactive: true, contextText });
    sendMessage({
      realtimeInput: {
        text: language === "en"
          ? "Say briefly that the parking assistant is ready and invite one short question."
          : "駐車場AIアシスタントの準備ができたことと、短く質問してよいことだけを簡潔に伝えてください。",
      },
    });
    return true;
  }

  function updateContext(contextText) {
    lastContext = contextText ?? "";
  }

  window.parkingGeminiVoice = Object.freeze({
    model: MODEL,
    isSupported,
    speak,
    startAssistant,
    updateContext,
    disconnect,
    isAssistantActive: () => Boolean(
      websocket
      && websocket.readyState === WebSocket.OPEN
      && interactiveMode
    ),
  });
})();
