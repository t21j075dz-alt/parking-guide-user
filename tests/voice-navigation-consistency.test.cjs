"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const bankCode = fs.readFileSync(path.join(root, "voice-guide-scripts.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(bankCode, context);
const scripts = context.window.ParkingVoiceGuideScripts;
const sample = {
  "目的施設名": "サンプル施設",
  "目的店舗名": "サンプル店舗",
  "混雑状況": "混雑しています",
  "駐車枠": "A列の12",
  "施設名": "サンプル施設",
  "時刻": "午前9時",
  "駐車場名": "サンプル駐車場",
  "方向": "右",
  "エリア名": "Aエリア",
  "駐車時間": "15分",
};

test("日本語37種類のナビ案内には空の読み上げや未置換の語句がない", () => {
  assert.equal(scripts.ids.length, 37);
  for (const id of scripts.ids) {
    const result = scripts.build(id, sample);
    assert.ok(result.text.length > 5, id);
    assert.doesNotMatch(result.text, /［[^］]+］/, id);
    assert.equal(result.parts.map(part => part.text).join(""), result.text, id);
    assert.ok(result.text.length < 310, id + " is too long for navigation");
  }
});

test("駐車枠の案内は同じ番号を必ず2回読み、現地標識の案内を含む", () => {
  for (const id of ["space_found", "space_alternative", "retry_found", "parked_location"]) {
    const text = scripts.build(id, sample).text;
    assert.equal(text.split("A列の12番です。").length - 1, 2, id);
    if (id !== "parked_location") assert.match(text, /現地の標識や係員の案内を優先/, id);
  }
});

test("通常画面には読み上げ全文を表示せず、音声確認専用画面だけに残す", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.doesNotMatch(html, /class="guidance-audio-message"/);
  assert.match(html, /id="voice-test-transcript"/);
  assert.match(html, /class="[^"]*guidance-audio-replay/);
  assert.doesNotMatch(app, /node\.textContent = lastGuidanceTranscript/);
  assert.doesNotMatch(app, /案内内容："[, ]*.*\+ message/);
});

test("保存音声の取得を待ち過ぎないようにし、取得失敗時も端末音声へ切り替える", () => {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /Prepared audio retrieval timed out/);
  assert.match(app, /isPreview \? 2400 : 1700/);
  assert.match(app, /speakDeviceAssembledParts\(message, parts, requestId/);
});
