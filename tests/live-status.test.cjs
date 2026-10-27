"use strict";
/* 公開されていない施設、更新期限切れ、障害物、通信断の回帰テスト。 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "live-status.js"), "utf8");

function makeClient(published, status, checkedAt, failed = false) {
  const mockWindow = {
    PARKING_REMOTE_CONFIG: { enabled: true, supabaseUrl: "https://example.supabase.co", publishableKey: "public-example-key" },
    addEventListener() {},
  };
  const sandbox = {
    window: mockWindow, document: { hidden: false },
    setInterval() {}, clearInterval() {},
    AbortSignal: { timeout() { return undefined; } },
    fetch: async (url) => {
      if (failed) throw new Error("offline");
      return { ok: true, json: async () => String(url).includes("visibility")
        ? (published ? [{ facility_id: "f" }] : [])
        : [{ space_uid: "s", status, checked_at: checkedAt }] };
    },
  };
  vm.runInNewContext(source, sandbox);
  return mockWindow.ParkingLiveStatus;
}
const space = { uid: "s", occupancyStatus: "available", isOccupied: false };

test("非公開ならカメラ状態を適用しない", async () => {
  const client = makeClient(false, "occupied", new Date().toISOString());
  await client.refresh("f");
  assert.equal(client.snapshot("f").published, false);
  assert.equal(client.apply("f", [space])[0].occupancyStatus, "available");
});
test("20秒以上前の空き情報を未確認にする", async () => {
  const client = makeClient(true, "available", new Date(Date.now() - 35000).toISOString());
  await client.refresh("f");
  assert.equal(client.apply("f", [space])[0].occupancyStatus, "unknown");
});
test("コーンなどで利用不可の場合、空きとして扱わない", async () => {
  const client = makeClient(true, "blocked", new Date().toISOString());
  await client.refresh("f");
  assert.equal(client.apply("f", [space])[0].isOccupied, true);
});
test("通信が切れた場合、過去の空き情報を使わない", async () => {
  const client = makeClient(true, "available", new Date().toISOString(), true);
  await client.refresh("f");
  assert.equal(client.apply("f", [space])[0].occupancyStatus, "unknown");
});

test("自宅のライブ実験施設は未公開時に古い空き表示を使わない", async () => {
  const client = makeClient(false, "available", new Date().toISOString());
  await client.refresh("home-test-001");
  const result = client.apply("home-test-001", [space])[0];
  assert.equal(result.occupancyStatus, "unknown");
  assert.equal(result.isOccupied, true);
  assert.equal(result.liveCheckedAt, null);
});
