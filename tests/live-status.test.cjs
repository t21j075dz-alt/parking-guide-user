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


test("録画実演の駐車中・停車中・出庫中を専用ソースから読める", async () => {
  const sourceRows = ["parking_in", "stopped", "exiting", "available"].map(phase => ({
    space_uid: "s", status: phase === "available" ? "available" : "occupied",
    source: "recorded_video_demo", occupancy_phase: phase,
    checked_at: new Date().toISOString(),
  }));
  let active = 0;
  const mockWindow = {
    PARKING_REMOTE_CONFIG: {
      enabled: true, supabaseUrl: "https://example.supabase.co",
      publishableKey: "public-example-key"
    },
    addEventListener() {},
  };
  const sandbox = {
    window: mockWindow, document: { hidden: false },
    setInterval() {}, clearInterval() {},
    AbortSignal: { timeout() { return undefined; } },
    fetch: async url => ({
      ok: true, json: async () => String(url).includes("visibility")
        ? [{ facility_id: "home-video-demo-001" }] : [sourceRows[active]],
    }),
  };
  vm.runInNewContext(source, sandbox);
  const client = mockWindow.ParkingLiveStatus;
  for (const phase of ["parking_in","stopped","exiting","available"]) {
    await client.refresh("home-video-demo-001");
    const result = client.apply("home-video-demo-001", [space])[0];
    assert.equal(result.occupancyPhase, phase);
    assert.equal(result.isOccupied, phase !== "available");
    active += 1;
  }
});

test("録画実演に実カメラの行や古い判定を混ぜない", async () => {
  const mockWindow = {
    PARKING_REMOTE_CONFIG: {
      enabled: true, supabaseUrl: "https://example.supabase.co",
      publishableKey: "public-example-key"
    },
    addEventListener() {},
  };
  let row = {space_uid:"s", status:"available",source:"yolo",
             occupancy_phase:"available",checked_at:new Date().toISOString()};
  const sandbox = {
    window: mockWindow, document: { hidden: false },
    setInterval() {}, clearInterval() {},
    AbortSignal: { timeout() { return undefined; } },
    fetch: async url => ({ok:true,json: async () =>
      String(url).includes("visibility") ? [{facility_id:"home-video-demo-001"}] : [row]}),
  };
  vm.runInNewContext(source, sandbox);
  const client = mockWindow.ParkingLiveStatus;
  await client.refresh("home-video-demo-001");
  assert.equal(client.apply("home-video-demo-001", [space])[0].occupancyStatus,"unknown");
  row = {space_uid:"s",status:"available",source:"recorded_video_demo",
         occupancy_phase:"available",checked_at:new Date(Date.now()-30000).toISOString()};
  await client.refresh("home-video-demo-001");
  assert.equal(client.apply("home-video-demo-001", [space])[0].occupancyPhase,null);
});
