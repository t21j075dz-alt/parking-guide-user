const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bankSource = fs.readFileSync(path.join(__dirname, "../voice-guide-scripts.js"), "utf8");
const window = {};
vm.runInNewContext(bankSource, { window });
const bank = window.ParkingVoiceGuideScripts;

test("the script bank defines all seven categories of the supplied Japanese guidance", () => {
  const ids = ["start_complex", "start_single", "approaching", "space_found",
    "space_alternative", "space_none", "space_maybe_taken",
    "retry_started", "retry_found", "retry_none",
    "arrival_detected", "arrival_video_confirm", "parking_completed", "guidance_ended",
    "full", "rest", "closed", "space_changed", "conditions_changed",
    "conditions_unavailable", "destination_changed",
    "camera_disconnected", "camera_recovered", "recognition_unknown",
    "location_unknown", "status_stale",
    "entrance_near", "entrance_entered", "route_turn", "space_unavailable",
    "timer_started", "timer_elapsed", "parked_location", "exit_detected"];
  for (const id of ids) assert.ok(bank.ids.includes(id), id);
});

test("the selected space is spoken twice, using only one dynamic space clip", () => {
  const script = bank.build("space_found", { "駐車枠": "Aエリアの12" });
  assert.equal(script.text.split("Aエリアの12番です。").length - 1, 2);
  assert.equal(script.parts.filter(part => part.role === "駐車枠").length, 2);
  assert.equal(new Set(script.parts.filter(part => part.role === "駐車枠").map(part => part.text)).size, 1);
  assert.ok(script.text.includes("現地の標識や係員の案内を優先"));
});

test("compound facility uses reusable facility and tenant-name clips", () => {
  const script = bank.build("start_complex", {
    "目的施設名": "ラ・ムータウン",
    "目的店舗名": "ラ・ムー岡山中央店",
    "混雑状況": "混雑しています",
  });
  assert.equal(script.parts.filter(p => p.role === "目的施設名").length, 2);
  assert.equal(script.parts.filter(p => p.role === "目的店舗名").length, 1);
  assert.equal(script.parts.filter(p => p.role === "混雑状況").length, 1);
  assert.ok(script.text.includes("ラ・ムータウン内のラ・ムー岡山中央店"));
});

test("preparation exposes fixed clips without sending placeholder tokens", () => {
  const fixed = bank.catalogFixed();
  assert.ok(fixed.length > 30);
  assert.ok(fixed.includes("繰り返します。"));
  assert.ok(fixed.every(x => !x.includes("［")));
  assert.equal(new Set(fixed).size, fixed.length);
});

test("missing dynamic item does not silently produce incorrect navigation", () => {
  assert.throws(() => bank.build("space_found"), /Voice value missing/);
  assert.throws(() => bank.build("closed", { "施設名": "A店" }), /時刻/);
  assert.throws(() => bank.build("unknown-key"), /Unknown voice script/);
});

test("user interface loads the script bank before the application", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.indexOf("voice-guide-scripts.js") >= 0);
  assert.ok(html.indexOf("voice-guide-scripts.js") < html.indexOf("app.js"));
  assert.ok(html.includes('id="voice-prepare-names-button"'));
  assert.ok(html.includes('id="voice-prepare-cancel-button"'));
});
