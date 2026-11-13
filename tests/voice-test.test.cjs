"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { element } = require("./fake-dom.cjs");

function loadScript(context, name) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", name), "utf8"), context);
}

function testApp() {
  const nodes = new Map();
  const document = {
    documentElement:{lang:"ja"}, hidden:false,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    createElement:element,createElementNS:(_,tag)=>element(tag),
  };
  const context = vm.createContext({
    document, console, setTimeout, clearTimeout, AbortController, AbortSignal, URL,
    Option:class Option { constructor(label,value){this.label=label;this.value=value;} },
    FACILITY_CATALOG:[],
    window:{
      PARKING_LAYOUTS:{}, PARKING_REMOTE_CONFIG:{enabled:false},
      scrollTo(){},addEventListener(){},
      history:{pushState(){}},
      speechSynthesis:{cancel(){},speak(){}},
    },
  });
  loadScript(context,"speech-readings.js");
  loadScript(context,"map-display.js");
  loadScript(context,"voice-guide-scripts.js");
  loadScript(context,"voice-test-scenarios.js");
  const source = fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
  vm.runInContext(source.split("/* =========================================================\n   操作イベント")[0],context);
  const run = code => vm.runInContext(code,context);
  run("renderFacilities = () => {}; state.selectedFacility = VOICE_TEST_FACILITY; state.voiceEnabled = true;");
  nodes.get("#voice-enabled").checked = true;
  // 実デバイスの音声代わりに終了・失敗イベントだけを手動で送信する。
  run("window.__realSpeakText = speakText; speakText = (message,options) => { window.__currentVoice = {message, options}; return true; };");
  return { run, context, nodes };
}

test("日本語38種類の台本を実際のシナリオへ組み立て、プレースホルダーを残さない",()=>{
  const context=vm.createContext({window:{}});
  loadScript(context,"voice-guide-scripts.js");
  loadScript(context,"voice-test-scenarios.js");
  const data=vm.runInContext("window.ParkingVoiceTestScenarios",context);
  const scenarios=data.scenarios("ja-JP","all");
  assert.equal(scenarios.length,38);
  for(const item of scenarios){
    const result=data.build(item,{facility:"試験施設",space:"びー、ご",destination:"店舗"}, "ja-JP");
    assert.ok(result.text.length>5,item.id);
    assert.equal(result.text.includes("［"),false,item.id);
    assert.equal(result.text,result.parts.join(""),item.id);
  }
  for(const locale of ["en-US","en-GB","zh-CN","ko-KR","es-ES"]){
    const localized=data.scenarios(locale);
    assert.ok(localized.length>=10,locale);
    localized.forEach(item=>{
      const script=data.build(item,{},locale);
      assert.ok(script.text.length>10,item.id);
      assert.equal(script.parts,null);
      assert.doesNotMatch(script.text,/［/);
    });
  }
});

test("音声テストだけに専用画面を表示し、通常のカメラ状態は変更しない",()=>{
  const {run,nodes}=testApp();
  run("updateVoiceTestEntry()");
  assert.equal(nodes.get("#voice-test-launch").hidden,false);
  assert.equal(nodes.get("#normal-condition-actions").hidden,true);
  assert.match(nodes.get("#voice-test-count").textContent,/38/);
  assert.equal(run("state.currentScreen"),"facility");
  run("state.selectedFacility = {id:'home-test-001'}; updateVoiceTestEntry()");
  assert.equal(nodes.get("#voice-test-launch").hidden,true);
  assert.equal(nodes.get("#normal-condition-actions").hidden,false);
});

test("完了イベント1回ごとに次画面へ進み、最後は終了画面に移る",()=>{
  const {run,context,nodes}=testApp();
  nodes.get("#voice-test-category").value="basic";
  assert.equal(run("startVoiceTest()"),true);
  assert.equal(run("state.currentScreen"),"voice-test");
  assert.equal(run("state.voiceTestRun.index"),0);
  assert.match(nodes.get("#voice-test-progress").textContent,/1 \/ 5/);
  const oldComplete=context.window.__currentVoice.options.onComplete;
  oldComplete();
  assert.equal(run("state.voiceTestRun.index"),1);
  assert.match(nodes.get("#voice-test-progress").textContent,/2 \/ 5/);
  oldComplete(); // 重複した終了通知で2つ進んではいけない。
  assert.equal(run("state.voiceTestRun.index"),1);
  for(let i=1;i<5;i++) context.window.__currentVoice.options.onComplete();
  assert.equal(run("state.currentScreen"),"voice-test-complete");
  assert.match(nodes.get("#voice-test-complete-count").textContent,/5種類/);
});

test("一時停止・移動・通信失敗後は古い音声の通知で勝手に画面を進めない",()=>{
  const {run,context,nodes}=testApp();
  nodes.get("#voice-test-category").value="basic";
  run("startVoiceTest()");
  const previous=context.window.__currentVoice.options;
  run("state.voiceTestRun.paused = true; state.voiceTestRun.token += 1; cancelSpeech()");
  previous.onComplete();
  assert.equal(run("state.voiceTestRun.index"),0);
  run("playVoiceTestStep()");
  context.window.__currentVoice.options.onError();
  assert.equal(run("state.voiceTestRun.paused"),true);
  assert.match(nodes.get("#voice-test-status").textContent,/再開/);
  const failed=context.window.__currentVoice.options;
  run("moveVoiceTestStep(1)");
  failed.onComplete();
  assert.equal(run("state.voiceTestRun.index"),1);
  run("state.voiceTestRun = null; showScreen('condition')");
  context.window.__currentVoice.options.onComplete();
  assert.equal(run("state.currentScreen"),"condition");
});

test("非表示タブでは次画面に進んでも自動発話しない",()=>{
  const {run,context,nodes}=testApp();
  nodes.get("#voice-test-category").value="basic";
  run("startVoiceTest()");
  const old=context.window.__currentVoice;
  context.document.hidden=true;
  old.options.onComplete();
  assert.equal(run("state.voiceTestRun.index"),1);
  assert.equal(run("state.voiceTestRun.paused"),true);
  assert.equal(context.window.__currentVoice,old);
});

test("端末の音声は最終endでのみ完了し、手動中止や音声エラーでは進まない",()=>{
  const {run,context}=testApp();
  let current;
  context.window.ParkingVoiceAssembler = {segments: parts => [{text:parts.join(""),pauseAfterMs:0}]};
  context.SpeechSynthesisUtterance = class {
    constructor(text){this.text=text;this.handlers={};}
    addEventListener(name,fn){this.handlers[name]=fn;}
  };
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis.getVoices=()=>[];
  context.window.speechSynthesis.speak=utterance=>{current=utterance;};
  run("state.cloudVoiceEnabled = false; window.__finished = 0; window.__errors = 0;");
  assert.equal(run("window.__realSpeakText('確認音声', {parts:['確認音声'], onComplete:()=>window.__finished++, onError:()=>window.__errors++})"),true);
  const canceled=current;
  run("cancelSpeech()");
  canceled.handlers.end();
  assert.equal(context.window.__finished,0);
  assert.equal(run("window.__realSpeakText('再開した音声', {parts:['再開した音声'], onComplete:()=>window.__finished++, onError:()=>window.__errors++})"),true);
  current.handlers.start();
  current.handlers.end();
  assert.equal(context.window.__finished,1);
  assert.equal(context.window.__errors,0);
  run("window.__realSpeakText('失敗した音声', {parts:['失敗した音声'], onComplete:()=>window.__finished++, onError:()=>window.__errors++})");
  current.handlers.error({error:"synthesis-failed"});
  assert.equal(context.window.__errors,1);
  assert.equal(context.window.__finished,1);
});

test("保存済み音声は最後のMP3のendedでのみ完了する",async()=>{
  const {run,context}=testApp();
  let lastSource;
  const audioContext={
    currentTime:0,state:"running",destination:{},
    decodeAudioData:async()=>({duration:.3}),
    createBufferSource(){
      lastSource={
        playbackRate:{setValueAtTime(){}},connect(){},start(){},stop(){},
        addEventListener(event,fn){ if(event==="ended")this.onEnded=fn; },
      };
      return lastSource;
    },
    createGain(){return {gain:{setValueAtTime(){}},connect(){}};},
    close:async()=>{},
  };
  context.window.ParkingVoiceAudioCache = {
    get:async()=>({bytes:new ArrayBuffer(300),source:"saved"}),
  };
  context.window.__route={context:audioContext,oscillator:{stop(){}},voiceSources:[]};
  run("state.cloudVoiceEnabled=true; window.__finished=0; speechRequestId=9; activeSpeechAudioRoute=window.__route;");
  const played=await run("playCloudVoiceAudio('保存済み',9,false,null,null,()=>window.__finished++)");
  assert.equal(played,true);
  assert.ok(lastSource?.onEnded);
  assert.equal(context.window.__finished,0);
  lastSource.onEnded();
  assert.equal(context.window.__finished,1);
});

test("English audio test covers every Japanese case and uses current example labels", () => {
  const ctx = vm.createContext({window:{}});
  loadScript(ctx,"voice-guide-scripts.js");
  loadScript(ctx,"voice-test-scenarios.js");
  const api=ctx.window.ParkingVoiceTestScenarios;
  assert.equal(api.scenarios("en-US").length,38);
  assert.equal(api.scenarios("en-GB").length,38);
  for (const item of api.scenarios("en-US")) {
    const result=api.build(item,{
      facility:"Example mall",space:"C 29",destination:"Example store"
    },"en-US");
    assert.doesNotMatch(result.text,/［[^］]+］|テスト施設/);
    assert.equal(result.parts,null);
  }
  const assigned=api.build(api.scenarios("en-US").find(x=>x.id==="space_found"),
    {space:"C 29"},"en-US").text;
  assert.equal(assigned.split("C 29").length-1,2);
});

test("English parking row and area labels are pronounced without Japanese suffixes", () => {
  const {run}=testApp();
  assert.equal(run('getSpokenSpaceId({sourceObject:{spaceGroup:"B",spaceGroupKind:"row",spaceNumber:"042"}},"en-US")'),"Row B, space 42");
  assert.equal(run('getSpokenSpaceId({sourceObject:{spaceGroup:"C",spaceGroupKind:"area",spaceNumber:"009"}},"en-GB")'),"Area C, space 9");
  assert.equal(run('getSpokenSpaceId({sourceObject:{spaceNumber:"007"}},"en-US")'),"7");
});

test("combined parking-space audio missing: reuse letter and number clips and replay twice", async () => {
  const {run,context}=testApp();
  loadScript(context,"voice-guide-playback.js");
  const requests=[], sources=[];
  const audioContext={
    currentTime:0,state:"running",destination:{},
    decodeAudioData:async()=>({duration:.15}),
    createBufferSource(){
      const source={
        playbackRate:{setValueAtTime(){}},connect(){},start(){},stop(){},
        addEventListener(event,handler){if(event==="ended")this.onEnded=handler;}
      };
      sources.push(source);
      return source;
    },
    createGain(){return {gain:{setValueAtTime(){}},connect(){}};},
    close:async()=>{},
  };
  context.window.ParkingVoiceAudioCache={
    async get(text){
      requests.push(text);
      if(text==="えー、れつ じゅうに") throw new Error("not prepared");
      return {bytes:new ArrayBuffer(300),source:"saved"};
    },
  };
  context.window.__route={context:audioContext,oscillator:{stop(){}},voiceSources:[]};
  run("speechRequestId=18; activeSpeechAudioRoute=window.__route; window.__done=0;");
  const played=await run(`playCloudVoiceAudio(
    "前えー、れつ じゅうに後えー、れつ じゅうに",18,false,
    ["前","えー、れつ じゅうに","後","えー、れつ じゅうに"],
    ["fixed","駐車枠","fixed","駐車枠"],()=>window.__done++
  )`);
  assert.equal(played,true);
  assert.equal(sources.length,8);
  for(const text of ["えー、れつ じゅうに","えー","れつ","じゅうに"])
    assert.equal(requests.filter(x=>x===text).length,1,text);
  assert.equal(run("window.__done"),0);
  sources[sources.length-1].onEnded();
  assert.equal(run("window.__done"),1);
});

test("English live parking guidance uses the same 38-script bank as the voice test", () => {
  const {run,context}=testApp();
  run(`state.language="en"; state.guidanceVoiceLanguage="en-GB";
    state.selectedFacility={id:"example",name:"Example mall"};
    state.selectedDestination={name:"Sample store",nameReading:"さんぷる"};
    state.searchOutcome="found"; state.lastSearchWasRetry=false;
    state.lastSearchWasAuto=false; state.userLocation=null;
    state.recommendedSpace={id:"B12",sourceObject:{spaceNumber:"012",spaceGroup:"B",spaceGroupKind:"row"}};
    getFacilityOccupancy=()=>({level:"open"}); getOperatingStatus=()=>null;`);
  const start=run("startScript().text");
  assert.match(start,/Parking guidance is set for Sample store at Example mall/);
  assert.match(start,/spaces are available/);
  assert.doesNotMatch(start,/さんぷる|駐車/);
  const parking=run("parkingScript().text");
  assert.match(parking,/Row B, space 12/);
  assert.equal(parking.split("Row B, space 12").length-1,2);
  assert.doesNotMatch(parking,/まもなく|繰り返します/);
  assert.equal(run("speakCurrentGuidance()"),true);
  assert.equal(context.window.__currentVoice.message,parking);
  run('state.searchOutcome="not-found"; state.recommendedSpace=null;');
  const unavailable=run("parkingScript().text");
  assert.match(unavailable,/No parking space is available/);
  assert.doesNotMatch(unavailable,/空き枠/);
});

test("English guidance displays the bilingual script even with audio disabled", () => {
  const {run}=testApp();
  run(`state.language="en"; state.guidanceVoiceLanguage="en-US";
    state.selectedFacility={id:"example",name:"Test centre"};
    state.searchOutcome="not-found"; state.recommendedSpace=null;
    state.lastSearchWasRetry=true;
    getFacilityOccupancy=()=>({level:"open"});
    getOperatingStatus=()=>null;`);
  assert.match(run("parkingScript().text"),/Sorry, no parking space is available/);
  assert.match(run("makePreparedScript('closing_soon').text"),/The facility will close within one hour/);
});
