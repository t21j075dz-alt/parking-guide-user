const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

function load() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, "voice-guide-scripts.js"), "utf8"), {window});
  vm.runInNewContext(fs.readFileSync(path.join(root, "voice-guide-playback.js"), "utf8"), {window});
  return window;
}

test("the same selected parking space is repeated twice when assembled into device sentences", () => {
  const x = load();
  const phrase = x.ParkingVoiceGuideScripts.build("space_found", { "駐車枠": "Aエリアの12" });
  const sentences = x.ParkingVoiceAssembler.sentences(phrase.parts);
  assert.equal(sentences.join(""), phrase.text);
  assert.equal(sentences.join("").split("Aエリアの12番です。").length - 1, 2);
  assert.equal(sentences.some(s => s.includes("繰り返します。")), true);
});

test("the facility and tenant name are preserved without missing joins", () => {
  const x = load();
  const phrase = x.ParkingVoiceGuideScripts.build("start_complex", {
    "目的施設名": "大型施設", "目的店舗名": "店舗A", "混雑状況": "比較的空いています",
  });
  const result = x.ParkingVoiceAssembler.sentences(phrase.parts);
  assert.equal(result.join(""), phrase.text);
  assert.ok(result.join("").includes("大型施設内の店舗Aへの案内"));
  assert.ok(result.every(s => s.trim() !== ""));
});

test("building chunks works offline with no TTS service or storage", () => {
  const x = load();
  const phrase = x.ParkingVoiceGuideScripts.build("retry_found", {"駐車枠":"B列の5"});
  const result = x.ParkingVoiceAssembler.sentences(phrase.parts);
  assert.ok(result.length > 0);
  assert.equal(result.join(""), phrase.text);
  assert.equal(result.join("").split("B列の5番です。").length - 1, 2);
});


test("meaningful speech pauses separate approach, each numbered slot and its repetition", () => {
  const x=load();
  const guide=x.ParkingVoiceGuideScripts.build("space_found",{"駐車枠":"Aエリアの12"});
  const pieces=x.ParkingVoiceAssembler.segments(guide.parts);
  assert.equal(pieces.map(p=>p.text).join(""),guide.text);
  const approach=pieces.find(p=>p.text === "まもなく目的地です。");
  assert.ok(approach && approach.pauseAfterMs>=200);
  const numbers=pieces.filter(p=>p.text.endsWith("Aエリアの12番です。"));
  assert.equal(numbers.length,2);
  assert.ok(numbers.every(p=>p.pauseAfterMs>=200));
  const repeat=pieces.find(p=>p.text === "繰り返します。");
  assert.ok(repeat && repeat.pauseAfterMs>=400);
});

test("long facility and tenant names stay intact within an assembled sentence", () => {
  const x=load();
  const name="スーパーセンタートライアル福岡新宮中央店";
  const script=x.ParkingVoiceGuideScripts.build("start_complex",{
    "目的施設名":"大型複合商業施設",
    "目的店舗名":name,"混雑状況":"混雑しています"
  });
  const pieces=x.ParkingVoiceAssembler.segments(script.parts);
  assert.ok(pieces.some(p=>p.text.includes(name)));
  assert.equal(pieces.map(p=>p.text).join(""),script.text);
});
