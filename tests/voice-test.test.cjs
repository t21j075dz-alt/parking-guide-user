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
