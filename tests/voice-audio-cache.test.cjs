const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../voice-audio-cache.js"), "utf8");

function createAudioHarness() {
  const entries = new Map();
  let calls = 0;
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
    window: { location: { href: "https://example.test/parking-guide-user/#facility" }, crypto: webcrypto },
    navigator, caches: { async open() { return cache; } },
    fetch: async (url) => {
      calls++;
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
    getCalls: () => calls, setOnline: v => { online = v; } };
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
