"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const readings = fs.readFileSync(path.join(root, "speech-readings.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "voice-guide-scripts.js"), "utf8");
const ctx = vm.createContext({ window: {} });
vm.runInContext(scriptSource, ctx);
const bank = ctx.window.ParkingVoiceGuideScripts;

function section(start, end) {
  const i = app.indexOf(start), j = app.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, "Could not locate source section " + start);
  return app.slice(i, j);
}

test("録画用施設でも通常の駐車場名で読み上げる", () => {
  const spokenName = section("function getFacilitySpokenName(locale)", "function getNoSpaceGuidanceMessage");
  assert.match(spokenName, /VIDEO_REPLAY_FACILITY_ID/);
  assert.match(spokenName, /"自宅駐車場"/);
  assert.match(readings, /"home-video-demo-001":\s*"じたくちゅうしゃじょう"/);
});

test("録画用施設の案内・再探索に録画や研究の音声前置きを挿入しない", () => {
  const prepared = section("function makePreparedScript(id, values", "function speakPreparedScript");
  const dynamic = section("function getParkingGuidanceMessage(locale", "function speakCurrentGuidance");
  assert.doesNotMatch(prepared, /bank\.build\("recorded_demo"\)/);
  assert.doesNotMatch(dynamic, /replayWarnings|replayNotice|録画映像による|research demo|recorded footage/i);
  assert.match(dynamic, /voiceTestWarnings/, "Keep the voice-test-only notice");
  const guide = bank.build("space_found", { "駐車枠": "ろく" });
  assert.equal(guide.text.split("ろく番です。").length - 1, 2);
});

test("録画の停車検知と駐車完了は普通のナビ文体で再生する", () => {
  const arrival = section("function updateParkingArrivalPanel()", "const PARKED_SESSION_KEY");
  const completed = section("function confirmOwnParking()", "function rejectOtherCar");
  assert.match(arrival, /speakPreparedScript\("arrival_video_confirm"\)/);
  assert.match(completed, /speakPreparedScript\("parking_completed"/);
  const notice = bank.build("arrival_video_confirm").text;
  assert.match(notice, /ご案内した駐車枠に車を検知しました/);
  assert.doesNotMatch(notice, /実験|研究|録画|現在の空き/);
  assert.doesNotMatch(completed, /speakText\(ui\("録画の中で駐車/);
});

test("録画結果を現在の駐車位置として保存せず、画面では録画を明示する", () => {
  const confirm = section("function confirmOwnParking()", "function rejectOtherCar");
  const screen = section("function updateParkedScreenCopy()", "function confirmOwnParking");
  assert.match(confirm, /if \(!recorded\) saveParkedSession\(space\)/);
  assert.match(screen, /録画で駐車を確認しました/);
  assert.match(app, /録画YOLO実演・現在の駐車場ではありません/);
});
