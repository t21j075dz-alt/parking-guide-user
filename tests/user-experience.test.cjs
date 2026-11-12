const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("利用者画面とPWAが同じUIファイルを参照する", () => {
  const html = read("index.html");
  const sw = read("service-worker.js");
  for (const extension of ["css", "js"]) {
    const pattern = new RegExp(`\\./user-experience\\.${extension}\\?v=[^"\\s]+`);
    const reference = html.match(pattern)?.[0];
    assert.ok(reference, `HTMLにバージョン付き${extension}参照が必要`);
    assert.ok(sw.includes(`"${reference}"`), `PWAとHTMLの参照が不一致: ${reference}`);
  }
});

test("利用者画面に研究者向けの説明を常時表示しない", () => {
  const html = read("index.html");
  const beforeFooter = html.split('<footer class="site-footer">')[0]
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(beforeFooter, /卒業研究|研究用デモ|研究用：|YOLOは駐車枠|Supabaseから取得/);
  assert.match(html, /<details class="app-about">/);
});

test("区画番号は既存の要素を再利用し、通常画面にも案内文を表示する", () => {
  const js = read("user-experience.js");
  const css = read("user-experience.css");
  assert.match(js, /result\.prepend\(hero\)/);
  assert.doesNotMatch(js, /transcript\?\.remove\(\)/);
  assert.match(read("app.js"), /node.textContent = message/);
  assert.match(js, /#waiting-screen \.guidance-audio-card, #result-screen \.guidance-audio-card/);
  assert.match(css, /#space-number/);
  assert.match(css, /position: sticky/);
  assert.match(read("index.html"), /id="voice-test-transcript"/);
});

test("録画映像を現在の空き状況と誤認させない", () => {
  const js = read("user-experience.js");
  assert.match(js, /録画の結果です。現在の空き状況は未確認です。/);
  assert.match(read("app.js"), /録画の結果です。現在の空き状況は未確認です。/);
});

test("区画の判定や音声再生ロジックはUI専用ファイルに置かない", () => {
  const js = read("user-experience.js");
  assert.doesNotMatch(js, /runSpaceSearch\(|speakCurrentGuidance\(|ParkingLiveStatus\.refresh\(/);
});

test("利用者向け全画面は、操作と状態を短い日本語で示す", () => {
  const html = read("index.html");
  const ux = read("user-experience.js");
  const app = read("app.js");
  for (const screen of ["facility", "condition", "waiting", "result", "parked", "voice-test", "voice-test-complete"]) {
    assert.match(html, new RegExp('data-screen="' + screen + '"'));
  }
  for (const expected of ["行き先を選ぶ", "駐車場の写真を見る", "もう一度探す", "駐車位置を保存しました"]) {
    assert.ok(ux.includes(expected), expected);
  }
  const resultText = app.slice(app.indexOf("function updateSearchResultNotice()"),
    app.indexOf("function getFacilitySpokenName(locale)"));
  assert.match(resultText, /現在の空き状況は未確認です/);
  assert.doesNotMatch(resultText, /YOLO|管理者アプリ|公開OFF/);
  assert.match(resultText, /現地の表示/);
});

test("録画再生画面は過去の結果と明示し、内部IDを要約に出さない", () => {
  const html = read("recorded-demo.html");
  const js = read("recorded-demo.js");
  assert.match(html, /過去の録画です。現在の空き状況ではありません/);
  assert.match(js, /録画（現在の空きではありません）/);
  assert.doesNotMatch(js, /" \(" \+ payload\.facility_id/);
});

test("録画中の各区画は内部IDではなく一覧番号を表示する", () => {
  const js = read("recorded-demo.js");
  assert.match(js, /heading\.textContent = "区画 " \+ \(i \+ 1\)/);
  assert.doesNotMatch(js, /heading\.textContent = uid;/);
});
