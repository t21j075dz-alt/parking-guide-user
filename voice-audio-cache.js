"use strict";
/**
 * VOICEVOX音声の事前生成・端末内保存。
 * - 利用者が外部音声を有効にした場合のみ呼び出す（無断送信しない）。
 * - 音声本文をURLやストレージキーに記録しない（SHA-256で識別）。
 * - 利用者アプリのCache Storageに保存し、次回は通信なしで再生できる。
 * - 端末が保存データを削除する場合があるため、永続性は保証しない。
 */
(() => {
  const CACHE_NAME = "parking-guide-user:voice-audio:v1:speaker8";
  const SPEAKER = 8;
  const MAX_FILES = 750; // 全施設名・案内の固定文・駐車枠番号を保持できるよう拡張
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_NEW_PER_BATCH = 8; // 大量一括生成による429を避ける
  const COOLDOWN_MS = 30 * 60 * 1000;
  const COOLDOWN_STORAGE_KEY = "parkingVoiceQuestBlockedUntilV1";
  let blockedUntil = 0;
  let lastSynthesisStarted = 0;
  let synthesisInFlight = null;
  try { blockedUntil = Math.max(0, Number(localStorage.getItem(COOLDOWN_STORAGE_KEY)) || 0); } catch {}
  function cooldownSeconds() { return Math.ceil(Math.max(0, blockedUntil - Date.now()) / 1000); }
  function markRateLimited() {
    blockedUntil = Date.now() + COOLDOWN_MS;
    try { localStorage.setItem(COOLDOWN_STORAGE_KEY, String(blockedUntil)); } catch {}
  }
  function status() { return { cooldownSeconds: cooldownSeconds(), blocked: cooldownSeconds() > 0 }; }

  // 音声の準備完了ハッシュだけを取得する。店舗名などの本文は公開しない。
  // 未生成の名前へ毎回MP3取得(404)を行わず、聞き取り開始の遅延を減らす。
  let readyHashes = null;
  let readyAt = 0;
  const MANIFEST_TIMEOUT_MS = 1400;
  const MANIFEST_RETRY_DELAY_MS = 15000;
  let manifestRetryAt = 0;
  let manifestPromise = null;
  async function sharedReadyHashes(base, publishableKey) {
    if (!publishableKey) return null;
    if (readyHashes && Date.now() - readyAt < 120000) return readyHashes;
    if (manifestPromise) return manifestPromise;
    // 電波が弱い場合、音声一覧の取得待ちが案内を停止させないようにする。
    // 一度失敗した直後は何十部品も同じ通信を繰り返さず端末TTSへ切り替える。
    if (Date.now() < manifestRetryAt) return readyHashes;
    manifestPromise = (async () => {
      const controller = new AbortController();
      let timer = null;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Audio list timed out"));
          }, MANIFEST_TIMEOUT_MS);
        });
        // この一覧は全ての部品から共有する。個々の再生中止で
        // 他の部品の取得まで中断させないよう、個別signalは使わない。
        const data = await Promise.race([
          (async () => {
            const response = await fetch(
              // 1,000件制限のあるテーブル一覧ではなく、完成済みハッシュの配列だけを取得する。
              // 店舗・施設が増えても先頭1,000件以外が再生不能にならない。
              base + "/rest/v1/rpc/parking_voice_ready_hashes",
              { headers: { apikey: publishableKey },
                signal: controller.signal, cache: "no-store" },
            );
            if (!response.ok) throw new Error("Audio list unavailable");
            return response.json();
          })(),
          timeout,
        ]);
        if (!Array.isArray(data)) throw new Error("Invalid audio list");
        readyHashes = new Set(data.filter(h =>
          typeof h === "string" && /^[a-f0-9]{64}$/.test(h)));
        readyAt = Date.now();
        manifestRetryAt = 0;
        return readyHashes;
      } catch {
        manifestRetryAt = Date.now() + MANIFEST_RETRY_DELAY_MS;
        return readyHashes; // 古い一覧があれば完成済み分の再生は継続できる
      } finally {
        if (timer !== null) clearTimeout(timer);
        manifestPromise = null;
      }
    })();
    return manifestPromise;
  }

  const SCOPE = new URL("./", window.location.href);

  function trustedAudioUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:"
        && /^audio[0-9]+\.tts\.quest$/.test(url.hostname)
        && /^\/v1\/data\/[a-zA-Z0-9]+\/(?:audio\.(?:wav|mp3)|status\.json)$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function cacheKey(message) {
    if (!window.crypto?.subtle || typeof TextEncoder === "undefined") return null;
    const input = new TextEncoder().encode("voice-cache-v1:" + SPEAKER + ":" + message);
    const bytes = new Uint8Array(await window.crypto.subtle.digest("SHA-256", input));
    const hash = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return new URL("./__prepared_voice__/" + hash + ".mp3", SCOPE).href;
  }

  async function storage() {
    if (!("caches" in window)) return null;
    try { return await caches.open(CACHE_NAME); } catch { return null; }
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
      function stop() {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        reject(new DOMException("Cancelled", "AbortError"));
      }
      signal.addEventListener("abort", stop, { once: true });
    });
  }

  async function synthesize(message, { signal, timeoutMs = 45000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (cooldownSeconds()) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      throw new Error("VOICEVOX HTTP 429 cooldown");
    }
    // 複数のボタン・タブ操作でも短時間に連続生成しない。
    // 保存済み音声の再生ではこの待機は発生しない。
    const ahead = synthesisInFlight;
    const work = (async () => {
      if (ahead) await ahead.catch(() => {});
      if (cooldownSeconds()) throw new Error("VOICEVOX HTTP 429 cooldown");
      const remaining = Math.max(0, lastSynthesisStarted + 2000 - Date.now());
      if (remaining > 0) await pause(remaining, controller.signal);
      if (cooldownSeconds()) throw new Error("VOICEVOX HTTP 429 cooldown");
      lastSynthesisStarted = Date.now();
    })();
    synthesisInFlight = work;
    try {
      await work;
    } finally {
      if (synthesisInFlight === work) synthesisInFlight = null;
    }
    try {
      const endpoint = "https://api.tts.quest/v3/voicevox/synthesis?speaker="
        + SPEAKER + "&text=" + encodeURIComponent(message);
      const response = await fetch(endpoint, { signal: controller.signal });
      if (response.status === 429) {
        markRateLimited();
        throw new Error("VOICEVOX API HTTP 429");
      }
      if (!response.ok) throw new Error("VOICEVOX API HTTP " + response.status);
      const output = await response.json();
      if (!output?.success || !trustedAudioUrl(output.mp3DownloadUrl)
          || !trustedAudioUrl(output.audioStatusUrl)) {
        throw new Error("Invalid audio response");
      }
      let ready = false;
      for (let i = 0; i < 36; i += 1) {
        const statusResponse = await fetch(output.audioStatusUrl, { signal: controller.signal });
        if (!statusResponse.ok) throw new Error("Audio status unavailable");
        const status = await statusResponse.json();
        if (status.isAudioError) throw new Error("Audio generation failed");
        if (status.isAudioReady) { ready = true; break; }
        await pause(750, controller.signal);
      }
      if (!ready) throw new Error("Audio generation is taking too long");
      const file = await fetch(output.mp3DownloadUrl, { signal: controller.signal });
      if (!file.ok) throw new Error("Audio download failed");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength < 200 || bytes.byteLength > MAX_BYTES) {
        throw new Error("Invalid audio file size");
      }
      return bytes;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function get(message, options = {}) {
    if (typeof message !== "string" || !message.trim()) throw new Error("No voice message");
    const key = await cacheKey(message);
    const cache = key ? await storage() : null;
    if (cache && key) {
      try {
        const stored = await cache.match(key);
        if (stored) return { bytes: await stored.arrayBuffer(), source: "saved" };
      } catch { /* 保存済みファイルが壊れていても通常生成へ進む。 */ }
    }
    // 管理者が登録時に作成した店舗名音声をSupabase Storageから取得する。
    // 音声ファイルの生成はここでは一切行わない（429やAPI遅延に影響されない）。
    if (options.remote === true && navigator.onLine !== false && key) {
      try {
        const base = window.PARKING_REMOTE_CONFIG?.supabaseUrl;
        if (window.PARKING_REMOTE_CONFIG?.enabled === true && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base || "")) {
          const hash = key.match(/\/([0-9a-f]{64})\.mp3$/)?.[1];
          if (hash) {
            const manifest = await sharedReadyHashes(
              base, window.PARKING_REMOTE_CONFIG?.publishableKey);
            // 一覧が取得できない場合は未知のURLへ無駄なMP3要求を送らない。
            // 再生は外部音声サービスを待たずに端末TTSへ移行する。
            if (!manifest || !manifest.has(hash)) throw new Error("Audio preparation pending");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2600);
            const onAbort = () => controller.abort();
            options.signal?.addEventListener?.("abort", onAbort, { once: true });
            try {
              const response = await fetch(base + "/storage/v1/object/public/parking-voice/ja-JP/" + hash + ".mp3", {
                signal: controller.signal, cache: "force-cache",
              });
              if (response.ok && Number(response.headers.get("content-length") || "0") <= MAX_BYTES) {
                const bytes = await response.arrayBuffer();
                if (bytes.byteLength >= 200 && bytes.byteLength <= MAX_BYTES) {
                  if (cache) {
                    try { await cache.put(key, new Response(bytes.slice(0), {
                      headers: { "Content-Type": "audio/mpeg" },
                    })); } catch {}
                  }
                  return { bytes, source: "shared" };
                }
              }
            } finally {
              clearTimeout(timer);
              options.signal?.removeEventListener?.("abort", onAbort);
            }
          }
        }
      } catch { /* クラウド音声が未生成・取得失敗でも端末音声へ切り替える。 */ }
    }
    if (options.cachedOnly) throw new Error("Audio clip is not prepared");
    if (cooldownSeconds()) throw new Error("VOICEVOX HTTP 429 cooldown");
    if (navigator.onLine === false) throw new Error("Audio not saved and device is offline");
    const bytes = await synthesize(message, options);
    let persisted = false;
    if (cache && key) {
      try {
        await cache.put(key, new Response(bytes.slice(0), {
          headers: { "Content-Type": "audio/mpeg" },
        }));
        persisted = true;
        const keys = await cache.keys();
        if (keys.length > MAX_FILES) {
          await Promise.all(keys.slice(0, keys.length - MAX_FILES).map(k => cache.delete(k)));
        }
      } catch { /* 保存できないブラウザーでも今回の再生は続行する。 */ }
    }
    return { bytes, source: "created", persisted };
  }

  async function prepare(messages, onProgress = () => {}, signal = null) {
    const unique = [...new Set(messages.filter(v => typeof v === "string" && v.trim()))];
    let saved = 0, created = 0, failed = 0, deferred = 0;
    for (const message of unique) {
      if (signal?.aborted) break;
      // まず保存の有無だけ確認。新規生成は最大8件で明示操作を区切る。
      let cached;
      try { cached = await get(message, { signal, cachedOnly: true }); } catch {}
      if (cached) {
        saved += 1;
        onProgress({ total: unique.length, done: saved + created + failed, saved, created, failed, deferred });
        continue;
      }
      if (created >= MAX_NEW_PER_BATCH || cooldownSeconds()) {
        deferred += 1;
        continue;
      }
      try {
        const audio = await get(message, { signal });
        if (audio.source === "saved") saved += 1;
        else if (audio.persisted) created += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        if (signal?.aborted || /HTTP 429/.test(String(error?.message))) {
          onProgress({ total: unique.length, done: saved + created + failed, saved, created, failed, deferred, error: String(error?.message || "") });
          break;
        }
      }
      onProgress({ total: unique.length, done: saved + created + failed,
        saved, created, failed, deferred });
      if (navigator.onLine === false) break;
    }
    return { total: unique.length, saved, created, failed, deferred, cooldownSeconds: cooldownSeconds() };
  }

  async function count() {
    const cache = await storage();
    if (!cache) return null;
    try { return (await cache.keys()).length; } catch { return null; }
  }

  window.ParkingVoiceAudioCache = Object.freeze({ get, prepare, count, status });
})();
