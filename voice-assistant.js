"use strict";

/* =========================================================
   OpenAI Realtime 音声アシスタント

   - GitHub Pages側には通常のOpenAI APIキーを置かない。
   - Supabase Edge Functionから短時間だけ使えるephemeral keyを取得する。
   - ブラウザーはWebRTCでOpenAI Realtime APIへ直接接続する。
   - 読み上げのみのときはマイクを取得しない。
   - AIアシスタント開始時だけマイクを取得する。
   ========================================================= */

(() => {
  const MODEL = "gpt-realtime-2.1";
  const REALTIME_URL = "https://api.openai.com/v1/realtime/calls";
  const TOKEN_FUNCTION_NAME = "openai-realtime-token";

  let peerConnection = null;
  let dataChannel = null;
  let mediaStream = null;
  let audioElement = null;
  let connectPromise = null;
  let sessionKey = "";
  let interactiveMode = false;
  let lastContext = "";

  function dispatchStatus(state, message, extra = {}) {
    window.dispatchEvent(new CustomEvent("parking:openai-voice-status", {
      detail: {
        state,
        message,
        assistantActive: Boolean(peerConnection && interactiveMode),
        ...extra,
      },
    }));
  }

  function getRemoteConfig() {
    return window.PARKING_REMOTE_CONFIG ?? {};
  }

  function isSupported() {
    const config = getRemoteConfig();
    return Boolean(
      config.enabled
      && config.supabaseUrl
      && "RTCPeerConnection" in window
      && navigator.mediaDevices,
    );
  }

  function getTokenEndpoint() {
    const base = String(getRemoteConfig().supabaseUrl ?? "").replace(/\/$/, "");
    return base ? `${base}/functions/v1/${TOKEN_FUNCTION_NAME}` : "";
  }

  async function requestEphemeralKey({ language, voice, interactive }) {
    const endpoint = getTokenEndpoint();
    if (!endpoint) {
      throw new Error("OpenAI音声用のSupabase設定がありません。");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language: language === "en" ? "en" : "ja",
        voice,
        interactive: Boolean(interactive),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenAI音声の一時トークンを取得できませんでした（${response.status}）${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      );
    }

    const payload = await response.json();
    const value =
      payload?.value
      ?? payload?.client_secret?.value
      ?? payload?.client_secret
      ?? "";

    if (!String(value).startsWith("ek_")) {
      throw new Error("OpenAI音声の一時トークン形式が正しくありません。");
    }

    return String(value);
  }

  function waitForDataChannelOpen(channel, timeoutMs = 10000) {
    if (channel.readyState === "open") return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("OpenAI音声の接続がタイムアウトしました。"));
      }, timeoutMs);

      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("OpenAI音声のデータ接続に失敗しました。"));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        channel.removeEventListener("open", onOpen);
        channel.removeEventListener("error", onError);
      };

      channel.addEventListener("open", onOpen, { once: true });
      channel.addEventListener("error", onError, { once: true });
    });
  }

  function stopLocalMedia() {
    if (!mediaStream) return;
    mediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* 既に停止済みでも続行する。 */
      }
    });
    mediaStream = null;
  }

  function disconnect({ silent = false } = {}) {
    connectPromise = null;
    sessionKey = "";
    interactiveMode = false;

    stopLocalMedia();

    if (dataChannel) {
      try {
        dataChannel.close();
      } catch {
        /* close失敗は無視する。 */
      }
      dataChannel = null;
    }

    if (peerConnection) {
      try {
        peerConnection.close();
      } catch {
        /* close失敗は無視する。 */
      }
      peerConnection = null;
    }

    if (audioElement) {
      try {
        audioElement.pause();
        audioElement.srcObject = null;
      } catch {
        /* 音声要素の後片付け失敗は無視する。 */
      }
      audioElement = null;
    }

    if (!silent) {
      dispatchStatus("disconnected", "OpenAI音声を停止しました。");
    }
  }

  function sendEvent(event) {
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new Error("OpenAI音声が接続されていません。");
    }
    dataChannel.send(JSON.stringify(event));
  }

  function buildRuntimeInstructions(language, contextText = "") {
    const context = contextText?.trim()
      ? `\n\nCURRENT PARKING APP CONTEXT:\n${contextText.trim()}`
      : "";

    if (language === "en") {
      return `You are the spoken parking assistant for a university graduation-research prototype.
Speak in clear, easy English with short sentences and a calm pace.
Use simple words that are easy to understand in a car.
Never invent parking availability, space numbers, distances, entrances, or routes.
Use only the parking-app context provided below. If information is missing, say that it is not available.
If a user asks to operate the screen while driving, tell them to ask a passenger or stop safely first.
When a user message begins with [GUIDANCE_TO_READ], read the text after that marker faithfully with no preface and no added information.
For normal conversation, answer in at most two short sentences unless the user asks for more detail.${context}`;
    }

    return `あなたは大学の卒業研究用「駐車場空き区画案内Web」の音声アシスタントです。
日本語で、車内でも聞き取りやすいように短く、明瞭に、落ち着いた速さで話してください。
難しい言葉や長い前置きは避けてください。
駐車区画の空き状況、区画番号、距離、入口、経路を推測して作らないでください。
下記の駐車場アプリ情報にある内容だけを事実として使い、不明な情報は「確認できません」と伝えてください。
運転中に画面操作を求められた場合は、同乗者へ依頼するか安全な場所に停車してから操作するよう案内してください。
ユーザーの入力が [GUIDANCE_TO_READ] で始まる場合、その後の文章を前置きや追加情報なしで自然に読み上げてください。
通常の会話は、詳しい説明を求められない限り2文以内を基本にしてください。${context}`;
  }

  function handleServerEvent(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "error") {
      const message = payload.error?.message ?? "OpenAI音声でエラーが発生しました。";
      dispatchStatus("error", message);
      return;
    }

    if (payload.type === "session.created" || payload.type === "session.updated") {
      dispatchStatus(
        interactiveMode ? "listening" : "ready",
        interactiveMode ? "AIアシスタントが質問を待っています。" : "OpenAI音声の準備ができました。",
      );
      return;
    }

    if (payload.type === "input_audio_buffer.speech_started") {
      dispatchStatus("listening", "聞き取っています…");
      return;
    }

    if (payload.type === "input_audio_buffer.speech_stopped") {
      dispatchStatus("thinking", "内容を確認しています…");
      return;
    }

    if (payload.type === "conversation.item.input_audio_transcription.completed") {
      dispatchStatus("thinking", "内容を確認しています…", {
        userTranscript: payload.transcript ?? "",
      });
      return;
    }

    if (
      payload.type === "response.output_audio_transcript.done"
      || payload.type === "response.audio_transcript.done"
    ) {
      dispatchStatus(interactiveMode ? "listening" : "ready", interactiveMode
        ? "AIアシスタントが質問を待っています。"
        : "OpenAI音声の準備ができました。", {
        assistantTranscript: payload.transcript ?? "",
      });
      return;
    }

    if (payload.type === "response.done") {
      dispatchStatus(
        interactiveMode ? "listening" : "ready",
        interactiveMode ? "AIアシスタントが質問を待っています。" : "読み上げが完了しました。",
      );
    }
  }

  async function connect({
    language = "ja",
    voice = "marin",
    interactive = false,
    contextText = "",
  } = {}) {
    if (!isSupported()) {
      throw new Error("この環境ではOpenAI音声を利用できません。");
    }

    const normalizedLanguage = language === "en" ? "en" : "ja";
    const normalizedVoice = ["marin", "cedar", "coral", "alloy"].includes(voice)
      ? voice
      : "marin";
    const nextSessionKey = `${normalizedLanguage}:${normalizedVoice}:${interactive ? "assistant" : "speech"}`;

    lastContext = contextText ?? "";

    if (
      peerConnection
      && dataChannel?.readyState === "open"
      && sessionKey === nextSessionKey
    ) {
      sendEvent({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: buildRuntimeInstructions(normalizedLanguage, lastContext),
        },
      });
      return;
    }

    if (connectPromise && sessionKey === nextSessionKey) {
      await connectPromise;
      return;
    }

    disconnect({ silent: true });
    sessionKey = nextSessionKey;
    interactiveMode = Boolean(interactive);

    connectPromise = (async () => {
      dispatchStatus("connecting", "OpenAI音声へ接続しています…");

      const ephemeralKey = await requestEphemeralKey({
        language: normalizedLanguage,
        voice: normalizedVoice,
        interactive,
      });

      const pc = new RTCPeerConnection();
      const dc = pc.createDataChannel("oai-events");
      peerConnection = pc;
      dataChannel = dc;

      dc.addEventListener("message", handleServerEvent);

      audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.playsInline = true;

      pc.addEventListener("track", (event) => {
        audioElement.srcObject = event.streams[0];
        void audioElement.play().catch(() => {
          dispatchStatus(
            "needs-interaction",
            "音声再生がブロックされました。「音声を試す」をもう一度押してください。",
          );
        });
      });

      if (interactive) {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const [track] = mediaStream.getAudioTracks();
        if (!track) {
          throw new Error("マイクを利用できません。");
        }
        pc.addTrack(track, mediaStream);
      } else {
        pc.addTransceiver("audio", { direction: "recvonly" });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const openPromise = waitForDataChannelOpen(dc);
      const sdpResponse = await fetch(REALTIME_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        const detail = await sdpResponse.text().catch(() => "");
        throw new Error(
          `OpenAI Realtime接続に失敗しました（${sdpResponse.status}）${detail ? `: ${detail.slice(0, 160)}` : ""}`,
        );
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await openPromise;

      sendEvent({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: buildRuntimeInstructions(normalizedLanguage, lastContext),
        },
      });

      dispatchStatus(
        interactive ? "listening" : "ready",
        interactive ? "AIアシスタントが質問を待っています。" : "OpenAI音声の準備ができました。",
      );
    })();

    try {
      await connectPromise;
    } catch (error) {
      disconnect({ silent: true });
      dispatchStatus("error", error?.message ?? "OpenAI音声へ接続できませんでした。");
      throw error;
    } finally {
      connectPromise = null;
    }
  }

  async function speak(text, {
    language = "ja",
    voice = "marin",
    contextText = "",
  } = {}) {
    if (!text?.trim()) return false;

    await connect({
      language,
      voice,
      interactive: false,
      contextText,
    });

    dispatchStatus("speaking", "OpenAI音声で案内しています…");

    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: `[GUIDANCE_TO_READ]\n${text.trim()}`,
        }],
      },
    });
    sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
      },
    });

    return true;
  }

  async function startAssistant({
    language = "ja",
    voice = "marin",
    contextText = "",
  } = {}) {
    await connect({
      language,
      voice,
      interactive: true,
      contextText,
    });

    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: language === "en"
            ? "[ASSISTANT_START] Say briefly that the parking assistant is ready and invite one short question."
            : "[ASSISTANT_START] 駐車場AIアシスタントの準備ができたことと、短く質問してよいことだけを簡潔に伝えてください。",
        }],
      },
    });
    sendEvent({ type: "response.create", response: { output_modalities: ["audio"] } });
    return true;
  }

  function updateContext(contextText, language = "ja") {
    lastContext = contextText ?? "";
    if (!dataChannel || dataChannel.readyState !== "open") return;

    sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: buildRuntimeInstructions(language === "en" ? "en" : "ja", lastContext),
      },
    });
  }

  window.parkingOpenAIVoice = Object.freeze({
    model: MODEL,
    isSupported,
    speak,
    startAssistant,
    updateContext,
    disconnect,
    isAssistantActive: () => Boolean(
      peerConnection
      && dataChannel?.readyState === "open"
      && interactiveMode
    ),
  });
})();
