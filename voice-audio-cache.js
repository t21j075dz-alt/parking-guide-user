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
    try {
      const endpoint = "https://api.tts.quest/v3/voicevox/synthesis?speaker="
        + SPEAKER + "&text=" + encodeURIComponent(message);
      const response = await fetch(endpoint, { signal: controller.signal });
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
    if (options.cachedOnly) throw new Error("Audio clip is not prepared");
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
    let saved = 0, created = 0, failed = 0;
    for (const message of unique) {
      if (signal?.aborted) break;
      try {
        const audio = await get(message, { signal });
        if (audio.source === "saved") saved += 1;
        else if (audio.persisted) created += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        if (signal?.aborted || /HTTP 429/.test(String(error?.message))) {
          onProgress({ total: unique.length, done: saved + created + failed, saved, created, failed, error: String(error?.message || "") });
          break;
        }
      }
      onProgress({ total: unique.length, done: saved + created + failed,
        saved, created, failed });
      if (navigator.onLine === false) break;
    }
    return { total: unique.length, saved, created, failed };
  }

  async function count() {
    const cache = await storage();
    if (!cache) return null;
    try { return (await cache.keys()).length; } catch { return null; }
  }

  window.ParkingVoiceAudioCache = Object.freeze({ get, prepare, count });
})();
