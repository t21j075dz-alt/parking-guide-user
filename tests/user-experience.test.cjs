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
  assert.match(js, /録画映像（現在の空きではありません）/);
  assert.match(js, /録画映像を再生中（現在の空きではありません）/);
});

test("区画の判定や音声再生ロジックはUI専用ファイルに置かない", () => {
  const js = read("user-experience.js");
  assert.doesNotMatch(js, /runSpaceSearch\(|speakCurrentGuidance\(|ParkingLiveStatus\.refresh\(/);
});
