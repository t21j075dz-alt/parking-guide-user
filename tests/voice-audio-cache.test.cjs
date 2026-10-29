const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../voice-audio-cache.js"), "utf8");

function createAudioHarness({ rateLimited = false, remoteEnabled = false } = {}) {
  const entries = new Map();
  let calls = 0;
  const storageValues = new Map();
  let online = true;
  const fakeBytes = new Uint8Array(512).fill(23).buffer;
  const cache = {
    async match(key) { return entries.get(key) || null; },
    async put(key, response) { entries.set(key, response); },
    async keys() { return [...entries.keys()].map(url => ({ url })); },
    async delete(key) { entries.delete(typeof key === "string" ? key : key.url); },
  };
  class FakeResponse {
    constructor(bytes) { this.bytes = bytes; }
    async arrayBuffer() { return this.bytes.slice(0); }
  }
  const navigator = {};
  Object.defineProperty(navigator, "onLine", { get: () => online });
  const context = vm.createContext({
    localStorage: { getItem(key) { return storageValues.get(key) ?? null; }, setItem(key, value) { storageValues.set(key, value); } },
    window: { caches: {},
      PARKING_REMOTE_CONFIG: remoteEnabled ? { enabled:true, supabaseUrl:"https://gahoqlpuufqjqpyaaykt.supabase.co" } : {},
      location: { href: "https://example.test/parking-guide-user/#facility" }, crypto: webcrypto },
    navigator, caches: { async open() { return cache; } },
    fetch: async (url) => {
      calls++;
      if (url.includes("/storage/v1/object/public/parking-voice/ja-JP/"))
        return { ok: true, headers: {get: () => "512"}, arrayBuffer: async () => fakeBytes.slice(0) };
      if (url.includes("/synthesis?") && rateLimited) return { ok: false, status: 429 };
      if (url.includes("/synthesis?")) return {
        ok: true, async json() { return { success: true,
          mp3DownloadUrl: "https://audio1.tts.quest/v1/data/abc123/audio.mp3",
          audioStatusUrl: "https://audio1.tts.quest/v1/data/abc123/status.json" }; },
      };
      if (url.endsWith("/status.json")) return { ok: true, async json() { return { isAudioReady: true }; } };
      if (url.endsWith("/audio.mp3")) return { ok: true, async arrayBuffer() { return fakeBytes.slice(0); } };
      throw new Error("Unexpected URL");
    },
    TextEncoder, URL, Uint8Array, Array, AbortController, DOMException,
    Response: FakeResponse, setTimeout, clearTimeout, console,
  });
  vm.runInContext(source, context);
  return { api: context.window.ParkingVoiceAudioCache, entries,
    getCalls: () => calls, setOnline: v => { online = v; }, setRateLimited: v => { rateLimited = v; } };
}

test("first request generates audio once, then replays the saved file offline", async () => {
  const h = createAudioHarness();
  assert.equal((await h.api.get("Aエリアの12番です。")).source, "created");
  assert.equal(h.getCalls(), 3);
  assert.equal(await h.api.count(), 1);
  h.setOnline(false);
  const cached = await h.api.get("Aエリアの12番です。");
  assert.equal(cached.source, "saved");
  assert.equal(h.getCalls(), 3);
  assert.equal(cached.bytes.byteLength, 512);
  assert.ok([...h.entries.keys()][0].includes("/__prepared_voice__/"));
  assert.ok(![...h.entries.keys()][0].includes("Aエリア"));
});

test("unsaved voice never contacts third parties while offline", async () => {
  const h = createAudioHarness();
  h.setOnline(false);
  await assert.rejects(h.api.get("まだ保存されていない文章"), /offline/);
  assert.equal(h.getCalls(), 0);
});

test("preparing repeated messages generates each clip only once", async () => {
  const h = createAudioHarness();
  const progress = [];
  const report = await h.api.prepare(["発話一", "発話一", "発話二"], p => progress.push(p.done));
  assert.equal(report.total, 2);
  assert.equal(report.created, 2);
  assert.equal(report.failed, 0);
  assert.equal(h.getCalls(), 6);
  assert.deepEqual(progress, [1, 2]);
  const second = await h.api.prepare(["発話一", "発話二"]);
  assert.equal(second.saved, 2);
  assert.equal(h.getCalls(), 6);
});


test("HTTP 429 starts a cooldown and prevents repeated third-party synthesis requests", async () => {
  const h = createAudioHarness({ rateLimited: true });
  await assert.rejects(h.api.get("未保存"), /429/);
  const afterFailure = h.getCalls();
  assert.equal(afterFailure, 1);
  assert.equal(h.api.status().blocked, true);
  assert.ok(h.api.status().cooldownSeconds > 0);
  await assert.rejects(h.api.get("別の未保存"), /429/);
  assert.equal(h.getCalls(), afterFailure, "429中は生成要求を送信しない");
});

test("a cached voice file remains available during HTTP 429 cooldown", async () => {
  const h = createAudioHarness();
  assert.equal((await h.api.get("保存済み音声")).source, "created");
  h.setRateLimited(true);
  await assert.rejects(h.api.get("新規音声"), /429/);
  const calls = h.getCalls();
  assert.equal((await h.api.get("保存済み音声", { cachedOnly: true })).source, "saved");
  assert.equal(h.getCalls(), calls);
});

test("a batch stops after rate limiting and reports its failed count", async () => {
  const h = createAudioHarness({ rateLimited: true });
  const results = await h.api.prepare(["音声1", "音声2", "音声3"]);
  assert.equal(results.failed, 1);
  assert.equal(results.created, 0);
  assert.equal(h.getCalls(), 1);
  assert.ok(results.cooldownSeconds > 0);
});


test("cloud prepared store names download once, then play from local cache offline", async () => {
  const h = createAudioHarness({ remoteEnabled: true });
  const first = await h.api.get("らむー おかやまてん", { cachedOnly:true, remote:true });
  assert.equal(first.source, "shared");
  assert.equal(h.getCalls(), 1, "only one Supabase Storage fetch");
  h.setOnline(false);
  const second = await h.api.get("らむー おかやまてん", { cachedOnly:true, remote:true });
  assert.equal(second.source, "saved");
  assert.equal(h.getCalls(), 1, "offline replay must not use network");
});
