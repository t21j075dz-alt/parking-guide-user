const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {element,walk}=require('./fake-dom.cjs');

function app(catalog = []) {
  const nodes = new Map();
  const document = { documentElement: { lang: 'ja' }, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }, querySelectorAll() { return []; }, createElement: element,createElementNS:(_,tag)=>element(tag) };
  const context = vm.createContext({ document, console, setTimeout, clearTimeout, AbortSignal, AbortController, URL, FACILITY_CATALOG: catalog,
    window: { PARKING_LAYOUTS: {}, PARKING_REMOTE_CONFIG: { enabled: true, supabaseUrl: 'https://example.test', publishableKey: 'sb_publishable_test' },
      addEventListener() {}, setTimeout, scrollTo() {}, history: { pushState() {} },
      speechSynthesis: { cancel() {}, speak() {} } },
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../speech-readings.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../map-display.js'), 'utf8'), context);
  const source = fs.readFileSync(process.env.PARKING_TEST_SOURCE || path.join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(source.replace(/\r\n/g, '\n').split('/* =========================================================\n   操作イベント')[0], context);
  const run = (code) => vm.runInContext(code, context);
  run('renderFacilities = () => {};');
  return { run, context, nodes };
}

test('通信待ち中に施設を変えた古い検索は画面を遷移させない', async () => {
  const { run, context } = app();
  let finish;
  context.fetch = () => new Promise((resolve) => { finish = resolve; });
  run(`state.selectedFacility = { id: 'a' }; state.currentScreen = 'condition';`);
  const pending = run('runSpaceSearch()');
  run(`state.selectedFacility = { id: 'b' }; state.searchRequestId += 1;`);
  finish({ ok: true, json: async () => [] });
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(run('state.currentScreen'), 'condition');
});

test('戻る操作は検索と接近時の自動案内を取り消す', () => {
  const { run } = app();
  run(`state.currentScreen = 'waiting'; state.autoProximityArmed = true; showScreen('condition');`);
  assert.equal(run('state.searchRequestId'), 1);
  assert.equal(run('state.autoProximityArmed'), false);
});

test('クラウドで消えたレイアウトを古いキャッシュから復活させない', async () => {
  const { run, context } = app();
  context.fetch = async () => ({ ok: true, json: async () => [{ facility_id: 'a', layout_data: { facilityId: 'a', objects: [] } }] });
  await run('loadRemoteParkingLayouts()');
  assert.ok(context.window.PARKING_LAYOUTS.a);
  context.fetch = async () => ({ ok: true, json: async () => [] });
  await run('loadRemoteParkingLayouts()');
  assert.equal(context.window.PARKING_LAYOUTS.a, undefined);
});

test('古い通信結果は新しいクラウドレイアウトを上書きしない', async () => {
  const { run, context } = app();
  const responses = [];
  context.fetch = () => new Promise((resolve) => responses.push(resolve));
  const first = run('loadRemoteParkingLayouts()');
  const second = run('loadRemoteParkingLayouts()');
  const response = (note) => ({ ok: true, json: async () => [{ facility_id: 'a', layout_data: { facilityId: 'a', objects: [], note } }] });
  responses[1](response('new'));
  await second;
  responses[0](response('old'));
  await first;
  assert.equal(context.window.PARKING_LAYOUTS.a.note, 'new');
});

test('無効な区画データを読み込まず、匿名取得に公開APIキーを使用する', async () => {
  const { run, context } = app();
  let headers;
  context.fetch = async (_url, options) => {
    headers = options.headers;
    return { ok: true, json: async () => [{ facility_id: 'a', layout_data: { facilityId: 'a', objects: [null] } }] };
  };
  await run('loadRemoteParkingLayouts()');
  assert.equal(context.window.PARKING_LAYOUTS.a, undefined);
  assert.equal(headers.apikey, 'sb_publishable_test');
  assert.equal(headers.Authorization, undefined);
});

test('音声一覧の待機中に案内を取り消すと後から読み上げない', async () => {
  const { run, context } = app();
  let finish;
  let spoken = 0;
  context.wait = () => new Promise((resolve) => { finish = resolve; });
  context.window.speechSynthesis.speak = () => spoken++;
  run('waitForSpeechVoices = wait;');
  const pending = run("speakTextWhenVoicesReady('test')");
  run('cancelSpeech()');
  finish([]);
  await pending;
  assert.equal(spoken, 0);
});

test('希望車種かつ空き区画だけを案内する', () => {
  const { run } = app();
  assert.equal(run(`selectRecommendedSpace([
    { id: 'occupied', spaceType: 'standard', isOccupied: true, distanceScore: 1 },
    { id: 'accessible', spaceType: 'accessible', isOccupied: false, distanceScore: 2 },
    { id: 'ok', spaceType: 'standard', isOccupied: false, distanceScore: 10 }
  ], 'near').id`), 'ok');
});

test('入口未登録のレイアウトを距離比較したと説明しない', async () => {
  const { run, context, nodes } = app();
  context.fetch = async () => ({ ok: true, json: async () => [{ facility_id: 'a', layout_data: {
    facilityId: 'a', objects: [{ uid: 'p', name: '001', status: 'available', objectType: 'parkingSpace', x: 0, y: 0, width: 6, height: 12 }],
  } }] });
  run(`state.selectedFacility = { id: 'a', name: 'test' }; state.currentScreen = 'result';
    state.voiceEnabled = false; saveSearchConditions = () => {}; renderParkingMap = () => {};`);
  await run('runSpaceSearch()');
  assert.match(nodes.get('#space-description').textContent, /入口が未登録/);
});

test('AudioSession対応ブラウザーでは音楽との混合再生を指定する', async () => {
  const { run, context } = app();
  run("state.voiceOutputMode = 'mix'");
  context.navigator = { audioSession: { type: 'auto' } };
  let utterance;
  context.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
    addEventListener() {}
  };
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = (voice) => { utterance = voice; };
  await run("speakTextWhenVoicesReady('test')");
  assert.equal(context.navigator.audioSession.type, 'ambient');
  assert.equal(utterance.volume, 1);
});

test('AudioSession未対応でも従来の読み上げ機能を使用できる', () => {
  const { run, context } = app();
  assert.equal(run('configureVoiceAudioSession()'), false);
  context.navigator = { audioSession: { get type() { return 'auto'; }, set type(_) { throw new Error('unsupported'); } } };
  assert.equal(run('configureVoiceAudioSession()'), false);
});

test('画面を戻したときだけ中断した読み上げを再開する', () => {
  const { run, context } = app();
  let resumed = 0;
  context.window.speechSynthesis.paused = true;
  context.window.speechSynthesis.resume = () => { resumed++; };
  context.document.hidden = true;
  run('resumePausedSpeechOnReturn()');
  assert.equal(resumed, 0);
  context.document.hidden = false;
  run('resumePausedSpeechOnReturn()');
  assert.equal(resumed, 1);
});

test('CarPlay用の再生方式は混合・案内優先・端末標準を切り替えられる', () => {
  const { run, context } = app();
  context.navigator = { audioSession: { type: 'auto' } };
  run("state.voiceOutputMode = 'mix'");
  assert.equal(run('configureVoiceAudioSession()'), true);
  assert.equal(context.navigator.audioSession.type, 'ambient');
  run("state.voiceOutputMode = 'priority'");
  assert.equal(run('configureVoiceAudioSession()'), true);
  assert.equal(context.navigator.audioSession.type, 'transient-solo');
  run('releasePriorityAudioSession()');
  assert.equal(context.navigator.audioSession.type, 'ambient');
  run("state.voiceOutputMode = 'call-test'");
  assert.equal(run('configureVoiceAudioSession()'), true);
  assert.equal(context.navigator.audioSession.type, 'play-and-record');
  run('releasePriorityAudioSession()');
  assert.equal(context.navigator.audioSession.type, 'ambient');
  run("state.voiceOutputMode = 'system'");
  assert.equal(run('configureVoiceAudioSession()'), true);
  assert.equal(context.navigator.audioSession.type, 'auto');
});

test('Audio Session APIに非対応でも読み上げを止めない', () => {
  const { run, context } = app();
  assert.equal(run('configureVoiceAudioSession()'), false);
  context.navigator = { audioSession: {
    get type() { return 'auto'; },
    set type(_) { throw new Error('unsupported'); },
  } };
  assert.equal(run('configureVoiceAudioSession()'), false);
});

test('案内優先の読み上げ完了後に音楽と混ぜる再生設定へ戻す', async () => {
  const { run, context } = app();
  context.navigator = { audioSession: { type: 'auto' } };
  let spoken;
  context.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.handlers = {}; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
  };
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = (utterance) => { spoken = utterance; };
  run("state.voiceOutputMode = 'priority'");
  await run("speakTextWhenVoicesReady('接続テスト')");
  assert.equal(context.navigator.audioSession.type, 'transient-solo');
  assert.equal(spoken.volume, 1);
  assert.equal(spoken.text, '接続テスト');
  spoken.handlers.end();
  assert.equal(context.navigator.audioSession.type, 'ambient');
});

test('テスト音はWeb Audio未対応端末で失敗として説明する', async () => {
  const { run, nodes } = app();
  assert.equal(await run('playVoiceOutputTestSound()'), false);
  assert.match(nodes.get('#voice-output-status').textContent, /テスト音/);
});

test('通信向け試験設定はマイク権限要求や通話開始を伴わない', () => {
  const { run, context } = app();
  let microphoneCalls = 0;
  context.navigator = {
    audioSession: { type: 'auto' },
    mediaDevices: { getUserMedia: () => { microphoneCalls++; throw new Error('unexpected'); } },
  };
  run("state.voiceOutputMode = 'call-test'");
  assert.equal(run('configureVoiceAudioSession()'), true);
  assert.equal(context.navigator.audioSession.type, 'play-and-record');
  assert.equal(microphoneCalls, 0);
});

test('通話向け音声を新規利用と旧標準設定の既定値にする', () => {
  const { run } = app();
  assert.equal(run('state.voiceOutputMode'), 'call-test');
  assert.equal(run('restoreVoiceOutputMode(null, null)'), 'call-test');
  assert.equal(run("restoreVoiceOutputMode(null, 'mix')"), 'call-test');
  assert.equal(run("restoreVoiceOutputMode(null, 'call-test')"), 'call-test');
});

test('新しい設定で音楽混合を選んだ場合はその選択を維持する', () => {
  const { run } = app();
  assert.equal(run("restoreVoiceOutputMode('mix', 'call-test')"), 'mix');
  assert.equal(run("restoreVoiceOutputMode('priority', 'mix')"), 'priority');
  assert.equal(run("restoreVoiceOutputMode('system', 'mix')"), 'system');
  assert.equal(run("restoreVoiceOutputMode('invalid', 'mix')"), 'call-test');
});

test('通常の読み上げも選択操作なしで通話向けの再生方式を使用する', async () => {
  const { run, context } = app();
  context.navigator = { audioSession: { type: 'auto' } };
  let lastSpoken;
  context.SpeechSynthesisUtterance = class {
    constructor(message) { this.text = message; this.handlers = {}; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
  };
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = (utterance) => { lastSpoken = utterance; };
  await run("speakTextWhenVoicesReady('実際の案内')");
  assert.equal(context.navigator.audioSession.type, 'play-and-record');
  assert.equal(lastSpoken.text, '実際の案内');
  assert.equal(lastSpoken.volume, 1);
  lastSpoken.handlers.end();
  assert.equal(context.navigator.audioSession.type, 'ambient');
});

test('自動案内と手動案内に標準の通話向け音声設定を適用する', async () => {
  const { run, context } = app();
  const history = [];
  context.navigator = { audioSession: { type: 'auto' } };
  class FakeUtterance {
    constructor(text) { this.text = text; this.handlers = {}; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
  }
  context.SpeechSynthesisUtterance = FakeUtterance;
  context.window.SpeechSynthesisUtterance = FakeUtterance;
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = (utterance) => {
    history.push({ utterance, sessionType: context.navigator.audioSession.type });
  };

  assert.equal(run('speakAutomaticGuidanceStartMessage()'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(history.length, 1);
  assert.equal(history[0].sessionType, 'play-and-record');
  assert.equal(history[0].utterance.volume, 1);
  history[0].utterance.handlers.end();

  run("state.recommendedSpace = { id: '5', spaceType: 'standard' }");
  assert.equal(run('speakCurrentGuidance()'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(history.length, 2);
  assert.equal(history[1].sessionType, 'play-and-record');
  assert.match(history[1].utterance.text, /くかく/);
  history[1].utterance.handlers.end();
  assert.equal(context.navigator.audioSession.type, 'ambient');
});

test('通話向け案内は電子音のWeb Audio経路を準備し、発話後に閉じる', async () => {
  const { run, context } = app();
  const audioEvents = [];
  let spoken;
  context.navigator = { audioSession: { type: 'ambient' } };
  context.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.handlers = {}; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
  };
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = (u) => { spoken = u; };
  context.window.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      audioEvents.push('created');
    }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {} },
        connect() {},
        start() { audioEvents.push('started'); },
        stop() { audioEvents.push('stopped'); },
      };
    }
    createGain() {
      return { gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() { audioEvents.push('cue'); },
        cancelScheduledValues() {},
      }, connect() {} };
    }
    resume() { return Promise.resolve(); }
    close() { audioEvents.push('closed'); return Promise.resolve(); }
  };

  assert.equal(run("speakText('通常の駐車区画案内')"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(spoken);
  assert.equal(spoken.volume, 1);
  assert.equal(context.navigator.audioSession.type, 'play-and-record');
  assert.ok(audioEvents.includes('cue'));
  spoken.handlers.end();
  assert.ok(audioEvents.includes('stopped'));
  assert.ok(audioEvents.includes('closed'));
  assert.equal(context.navigator.audioSession.type, 'ambient');
});

test('案内の途中取消でWeb Audio経路を解放する', async () => {
  const { run, context } = app();
  let closes = 0;
  context.navigator = { audioSession: { type: 'ambient' } };
  context.window.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() {
      return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    }
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; }
    resume() { return Promise.resolve(); }
    close() { closes++; return Promise.resolve(); }
  };
  run('prepareSpeechAudioRoute()');
  run('cancelSpeech()');
  assert.equal(closes, 1);
  assert.equal(context.navigator.audioSession.type, 'ambient');
});

test('Web Audio非対応でも読み上げだけは維持する', async () => {
  const { run, context } = app();
  let spoken;
  context.navigator = { audioSession: { type: 'ambient' } };
  context.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; this.handlers = {}; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
  };
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = (utterance) => { spoken = utterance; };
  assert.equal(run("speakText('案内')"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spoken.text, '案内');
});

test('保存済み音声は初期状態で有効だが、外部TTSを勝手に生成しない', () => {
  const { run } = app();
  assert.equal(run('state.cloudVoiceEnabled'), true);
  assert.equal(run("isTrustedVoiceAudioUrl('https://evil.test/sample.mp3')"), false);
  assert.equal(run("isTrustedVoiceAudioUrl('https://audio2.tts.quest/v1/data/a12b3c/audio.mp3')"), true);
  assert.equal(run("isTrustedVoiceAudioUrl('https://audio2.tts.quest.evil.test/v1/data/a12b3c/audio.mp3')"), false);
});

test('保存済み日本語音声をWeb Audioへ流し、通常の端末読み上げを使わない', async () => {
  const { run, context } = app();
  let synthesisCalls = 0;
  let voiceAudio = null;
  let submittedText = null;
  let audioSessionType = '';
  context.navigator = { audioSession: { type: 'ambient' } };
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = () => { synthesisCalls += 1; };
  context.window.AudioContext = class {
    constructor() { this.destination = {}; this.currentTime = 0; }
    createOscillator() {
      return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    }
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; }
    createBufferSource() {
      return { connect() {}, addEventListener(name, fn) { this.onEnd = fn; },
        start() { audioSessionType = context.navigator.audioSession.type; voiceAudio = this; },
        stop() {} };
    }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  context.window.ParkingVoiceAudioCache = {
    async get(text) { submittedText = text; return { bytes: new ArrayBuffer(4), source: "saved" }; },
  };
  run('state.cloudVoiceEnabled = true');
  assert.equal(run("speakText('駐車区画、5番です。')"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(synthesisCalls, 0);
  assert.ok(voiceAudio);
  assert.equal(submittedText, 'ちゅうしゃくかく、ごばんです。');
  assert.equal(audioSessionType, 'play-and-record');
  voiceAudio.onEnd();
  assert.equal(context.navigator.audioSession.type, 'ambient');
});

test('音声部品が未保存なら端末音声へすぐ切り替える', async () => {
  const { run, context, nodes } = app();
  let fallbackCalls = 0;
  context.navigator = { audioSession: { type: 'ambient' } };
  class Speech { constructor(text) { this.text = text; this.events = {}; }
    addEventListener(k, fn) { this.events[k] = fn; } }
  context.SpeechSynthesisUtterance = Speech;
  context.window.SpeechSynthesisUtterance = Speech;
  context.window.speechSynthesis.getVoices = () => [{ name: 'Google 日本語', lang: 'ja-JP' }];
  context.window.speechSynthesis.speak = () => { fallbackCalls++; };
  context.window.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; }
    createBufferSource() { return { connect() {}, start() {}, addEventListener() {} }; }
    decodeAudioData() { return Promise.resolve({}); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  context.window.ParkingVoiceAudioCache = { async get() { throw new Error('VOICEVOX API HTTP 429'); } };
  run('state.cloudVoiceEnabled = true');
  assert.equal(run("speakText('診断音声', {preview: true})"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(nodes.get('#cloud-voice-diagnostic').textContent, /未保存|混雑|端末音声/);
  assert.equal(fallbackCalls, 1);
});

test('Safariだけ新しい既定値へ移行し、Googleアプリと明示した設定は保持する', () => {
  const { run, context } = app();
  const safari = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
  context.navigator = { userAgent: safari, audioSession: { type: 'auto' } };
  assert.equal(run("restoreVoiceOutputMode(null, 'call-test')"), 'media');
  assert.equal(run("restoreVoiceOutputMode('call-test', 'call-test')"), 'call-test');
  assert.equal(run("restoreVoiceOutputMode('mix', 'call-test')"), 'mix');
  run("state.voiceOutputMode = 'media'");
  assert.equal(run('configureVoiceAudioSession()'), true);
  assert.equal(context.navigator.audioSession.type, 'playback');
  run('releasePriorityAudioSession()');
  assert.equal(context.navigator.audioSession.type, 'ambient');
  context.navigator.userAgent = safari + ' GSA/350.0';
  assert.equal(run('getDefaultVoiceOutputMode()'), 'call-test');
});

test('各言語の音声・速度・音量を別々に適用し、音声一覧があれば同期的に発話する', async () => {
  const { run, context } = app();
  const voices = [
    { name: '日本語', lang: 'ja-JP', voiceURI: 'ja' },
    ...['en-US', 'en-GB', 'zh-CN', 'ko-KR', 'es-ES'].map((lang) => ({ name: lang, lang, voiceURI: lang })),
  ];
  let spoken;
  context.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
    addEventListener() {}
  };
  context.window.speechSynthesis.getVoices = () => voices;
  context.window.speechSynthesis.speak = (u) => { spoken = u; };
  for (const locale of ['en-US', 'en-GB', 'zh-CN', 'ko-KR', 'es-ES']) {
    context.testLocale = locale;
    run("state.language = 'en'; state.guidanceVoiceLanguage = testLocale; state.voiceProfiles[testLocale] = {voiceURI: testLocale, rate: 0.8, volume: 0.7}");
    const pending = run("speakTextWhenVoicesReady('sample')");
    assert.equal(spoken.lang, locale);
    assert.equal(spoken.voice.voiceURI, locale);
    assert.equal(spoken.rate, 0.8);
    assert.equal(spoken.volume, 0.7);
    await pending;
  }
  run("state.language = 'ja'");
  assert.equal(run('getGuidanceSpeechRate()'), 1);
  assert.equal(run('getGuidanceSpeechVolume()'), 1);
  run("state.voiceProfiles['ja-JP'] = { volume: 99 }");
  assert.equal(run('getGuidanceSpeechVolume()'), 1);
});

test('日本語案内に読み仮名・番号・通過案内を含め、手動探索で接近を断定しない', () => {
  const { run } = app();
  run("state.selectedFacility = {name: 'テスト施設'}; state.recommendedSpace = {id: '005'}; state.lastSearchWasAuto = true");
  assert.match(run('getAutomaticGuidanceStartMessage()'), /テスト施設にちかづくと、じどうであきくかく/);
  assert.match(run('getCurrentGuidanceMessage()'), /テスト施設にせっきんしました。ごあんないするくかくは、ごばん/);
  assert.match(run('getCurrentGuidanceMessage()'), /こうどうでまつことなく、あんぜんにつうか/);
  for (const locale of ['en-US', 'en-GB', 'zh-CN', 'ko-KR', 'es-ES']) {
    assert.ok(run(`getCurrentGuidanceMessage('${locale}')`).includes('5'));
    assert.ok(run(`getAutomaticGuidanceStartMessage('${locale}')`).includes('テスト施設'));
  }
  run('state.lastSearchWasAuto = false');
  assert.doesNotMatch(run('getCurrentGuidanceMessage()'), /せっきんしました/);
});

test('音声ファイルの小さい振幅を補正し、増幅上限とクリッピング余裕を守る', () => {
  const { run, context } = app();
  context.buffer = { numberOfChannels: 1, getChannelData: () => [0.1, -0.2] };
  assert.equal(run('getAudioFileGain(buffer)'), 3);
  context.buffer.getChannelData = () => [0, -1];
  assert.equal(run('getAudioFileGain(buffer)'), 0.9);
  context.buffer.getChannelData = () => [0, 0];
  assert.equal(run('getAudioFileGain(buffer)'), 1);
});

function safetyApp() {
  const nodes = new Map();
  const documentEvents = {};
  let now = 1000000, receive, error, notices = 0;
  function element() {
    return { hidden: false, open: false, handlers: {}, addEventListener(n, f) { this.handlers[n] = f; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; } };
  }
  const document = { hidden: false, documentElement: { lang: 'ja' }, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id);
  }, querySelectorAll() { return []; }, addEventListener(n, f) { documentEvents[n] = f; } };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ document, Date: Clock, console,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    Notification: class { static permission = 'granted'; constructor() { notices++; } },
    window: { isSecureContext: true, addEventListener() {}, dispatchEvent() {},
      setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {} },
    navigator: { geolocation: { watchPosition(r, e) { receive = r; error = e; return 1; }, clearWatch() {} } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../location-safety.js'), 'utf8'), context);
  function movement(speed = 3, count = 5) {
    for (let i = 0; i < count; i++) {
      now += 2000;
      receive({ timestamp: now, coords: { latitude: 34, longitude: 133, accuracy: 5, speed } });
    }
  }
  return { nodes, document, context, movement, error: () => error({ code: 2 }),
    advance: (ms) => { now += ms; }, notices: () => notices,
    visibility: () => documentEvents.visibilitychange(), api: context.window.parkingSafety };
}

test('運転者ではない選択は時間経過・測位エラー・画面復帰・停止後の再移動でも保持する', () => {
  const s = safetyApp();
  s.api.start(); s.movement();
  assert.equal(s.nodes.get('driving-dialog').open, true);
  s.nodes.get('confirm-passenger-button').handlers.click();
  assert.equal(s.api.guardOperation(), true);
  const notices = s.notices();
  s.advance(6 * 60 * 1000);
  assert.equal(s.api.guardOperation(), true);
  s.document.hidden = true; s.visibility();
  s.document.hidden = false; s.visibility(); s.movement();
  s.error(); s.api.stop(); s.api.start();
  s.movement(0, 12); s.movement();
  assert.equal(s.api.guardOperation(), true);
  assert.equal(s.nodes.get('driving-dialog').open, false);
  assert.equal(s.notices(), notices);
  s.api.resetConfirmation();
  assert.equal(s.api.guardOperation(), false);
  assert.equal(s.nodes.get('driving-dialog').open, true);
});

test('運転者を選んだ場合は操作制限を維持する', () => {
  const s = safetyApp();
  s.api.start(); s.movement();
  s.nodes.get('confirm-driver-button').handlers.click();
  assert.equal(s.api.guardOperation(), false);
  s.nodes.get('confirm-passenger-button').handlers.click();
  s.api.resetConfirmation();
  assert.equal(s.api.guardOperation(), false);
});

test('音声調整UIは選択言語の実在音声を表示し、選択を保存・復元できる', () => {
  const { run, context, nodes } = app();
  const saved = new Map();
  context.localStorage = { setItem(k,v) { saved.set(k,v); } };
  context.window.speechSynthesis.getVoices = () => [
    { name: '日本語', lang: 'ja-JP', voiceURI: 'ja' },
    { name: 'Korean enhanced', lang: 'ko-KR', voiceURI: 'ko' },
    { name: 'English', lang: 'en-US', voiceURI: 'en' },
  ];
  run("state.language = 'en'; state.guidanceVoiceLanguage = 'ko-KR'; updateVoiceControls()");
  assert.deepEqual(nodes.get('#voice-select').children.map(c=>c.value), ['', 'ko']);
  nodes.get('#voice-select').value = 'ko';
  nodes.get('#voice-rate').value = '0.8';
  nodes.get('#voice-volume').value = '80';
  run('saveVoiceProfile(); updateVoiceControls()');
  const profile = JSON.parse(saved.get('parkingGuideVoiceProfiles'))['ko-KR'];
  assert.deepEqual(profile, { voiceURI: 'ko', rate: 0.8, volume: 0.8 });
  assert.equal(nodes.get('#voice-volume-label').textContent, '80%');
  run("state.language = 'ja'; updateVoiceControls()");
  assert.equal(nodes.get('#voice-volume').value, '100');
  run("state.language = 'en'; updateVoiceControls()");
  assert.equal(nodes.get('#voice-select').value, 'ko');
  assert.equal(nodes.get('#voice-rate').value, '0.8');
});

test('全215施設に独立した日本語読み仮名があり、難読名を正しい読みで保持する', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../facilities.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../speech-readings.js'), 'utf8'), context);
  assert.equal(vm.runInContext('Object.keys(window.PARKING_SPEECH_READINGS).length', context), 215);
  assert.equal(vm.runInContext('FACILITY_CATALOG.every(f => /^[ぁ-ゖー、。 ]+$/.test(window.PARKING_SPEECH_READINGS[f.id]))', context), true);
  for (const id of ['home-test-001', 'home-video-demo-001', 'home-voice-test-001']) {
    assert.ok(context.window.PARKING_SPEECH_READINGS[id], id + ' の施設名音声がありません');
  }
  for (const [id, reading] of Object.entries({target_024:'まるなか よしだてん',target_034:'みすたーまっくす はちほんまつてん',target_073:'みちのえき そのぎのしょう',target_098:'まるきょう みなはるてん',target_107:'とらいある みやこのじょうとほくてん',target_111:'はんずまん うすきてん',target_118:'とらいある いずみこがねてん'})) {
    assert.equal(context.window.PARKING_SPEECH_READINGS[id], reading);
  }
});

test('自宅の録画・リアルタイム・音声は共通配置図を使い、満空情報は別々に判定する', () => {
  const { run, context } = app([{
    id: 'home-test-001', name: '実験用駐車場（自宅駐車場リアルタイム用）',
    prefecture: '岡山県', layoutId: 'home-test-001',
  }]);
  const layout = { facilityId: 'home-test-001', objects: [
    { uid: 'space_001', objectType: 'parkingSpace', x: 10, y: 20, width: 5, height: 8, spaceType: 'standard', status: 'unknown' },
  ] };
  context.window.PARKING_LAYOUTS['home-test-001'] = layout;
  const ids = run("FACILITIES.filter(f => ['home-test-001','home-video-demo-001','home-voice-test-001'].includes(f.id)).map(f => f.id)");
  assert.deepEqual([...ids].sort(), ['home-test-001','home-video-demo-001','home-voice-test-001'].sort());
  assert.equal(run('getFacilityLayout(VIDEO_REPLAY_FACILITY)'), layout);
  assert.equal(run('getFacilityLayout(VOICE_TEST_FACILITY)'), layout);
  assert.equal(run("getFacilityLayout(FACILITIES.find(f => f.id === 'home-test-001'))"), layout);
  const testSpace = run('prepareSpaces(VOICE_TEST_FACILITY)');
  assert.equal(testSpace.isSimulation, true);
  assert.equal(testSpace.isLive, false);
  assert.equal(testSpace.spaces.length, 1);
  assert.equal(testSpace.spaces[0].occupancyStatus, 'available');
  const videoSpace = run('prepareSpaces(VIDEO_REPLAY_FACILITY)');
  assert.equal(videoSpace.spaces[0].occupancyStatus, 'unknown');
  assert.equal(run('privateTestStorageKey(VIDEO_REPLAY_FACILITY)'),
               run("privateTestStorageKey(FACILITIES.find(f => f.id === 'home-test-001'))"));
  assert.equal(run('privateTestStorageKey(VOICE_TEST_FACILITY)'),
               run('privateTestStorageKey(VIDEO_REPLAY_FACILITY)'));
});

test('区画番号は英字・全角・先頭ゼロ・桁数を処理し、管理用読み仮名を優先する', () => {
  const { run } = app();
  assert.equal(run("getSpokenSpaceId({id:'Ｂ－０５'})"), 'びー、ご');
  assert.equal(run("getSpokenSpaceId({id:'A-12'})"), 'えー、じゅうに');
  assert.equal(run("getSpokenSpaceId({id:'0306'})"), 'さんびゃくろく');
  assert.equal(run("getSpokenSpaceId({id:'B-05',sourceObject:{spaceNumberReading:'びー、ご'}})"), 'びー、ご');
  assert.equal(run("getSpokenSpaceId({id:'005'},'en-US')"), '5');
  assert.equal(run("normalizeJapaneseSpeech('満車です。公道で順番待ちをせず通過。区画５番。')"), 'まんしゃです。こうどうでじゅんばんまちをせずつうか。くかくごばん。');
});

test('店舗状態の判定で満・混・空・不明を区別し、不明や利用不可を空き扱いしない', () => {
  const { run } = app();
  run(`function fixtureSpaces(available,occupied,unknown=0,closed=0) {
    return [...Array.from({length:available},()=>({isOccupied:false,occupancyStatus:'available'})),
      ...Array.from({length:occupied},()=>({isOccupied:true,occupancyStatus:'occupied'})),
      ...Array.from({length:unknown},()=>({isOccupied:true,occupancyStatus:'unknown'})),
      ...Array.from({length:closed},()=>({isOccupied:true,occupancyStatus:'unavailable'}))];
  }`);
  assert.equal(run('summarizeOccupancy(fixtureSpaces(0,10)).level'), 'full');
  assert.equal(run('summarizeOccupancy(fixtureSpaces(3,1)).level'), 'busy');
  assert.equal(run('summarizeOccupancy(fixtureSpaces(4,16)).level'), 'busy');
  assert.equal(run('summarizeOccupancy(fixtureSpaces(4,15)).level'), 'open');
  assert.equal(run('summarizeOccupancy(fixtureSpaces(4,15,1)).level'), 'unknown');
  assert.equal(run('summarizeOccupancy(fixtureSpaces(0,0,0,10)).level'), 'unknown');
  assert.equal(run('summarizeOccupancy(fixtureSpaces(4,0,0,20)).total'), 4);
  assert.equal(run("createLayoutParkingSpaces({objects:[{objectType:'parkingSpace',x:0,y:0}]},{id:'a'})[0].isOccupied"), true);
});

async function searchFixture({ available = 0, occupied = 5, requested = 'standard', availableType = 'standard', voice = true, unknown = false } = {}) {
  const instance = app();
  const { run, context } = instance;
  const objects = Array.from({length: available+occupied}, (_,i) => ({objectType:'parkingSpace',uid:`p${i}`,spaceNumber:String(i+1),x:i*10,y:10,width:6,height:12,spaceType:i<available?availableType:'standard',status: unknown?undefined:i<available?'available':'occupied'}));
  context.fetch = async () => ({ok:true,json:async()=>[{facility_id:'a',layout_data:{facilityId:'a',objects}}]});
  run(`state.selectedFacility = { id:'a', name:'テスト' }; state.currentScreen='result';
    state.requestedSpaceType='${requested}'; state.voiceEnabled=${voice}; saveSearchConditions=()=>{};renderParkingMap=()=>{};
    speechCalls=[];speakText=(message)=>{speechCalls.push(message);return true;};`);
  const result = await run('runSpaceSearch()');
  return {...instance, result};
}

test('満車では通常の結果を隠し、通過表示と音声・再検索・施設変更の画面を表示する', async () => {
  const { run, nodes, result } = await searchFixture();
  assert.equal(result.spaceId, null);
  assert.equal(run('state.searchOutcome'), 'not-found');
  assert.equal(nodes.get('#result-content').hidden, true);
  assert.equal(nodes.get('#no-space-content').hidden, false);
  assert.match(nodes.get('#search-status').textContent, /満車.*登録データ.*実際の空き情報ではありません/);
  assert.match(nodes.get('#no-space-description').textContent, /満車/);
  assert.equal(run('speechCalls.length'), 1);
  assert.match(run('speechCalls[0]'), /まんしゃ.*こうどうでじゅんばんまちをせず.*つうか/);
});

test('希望車種の空きがない場合、他車種に空きがあれば満車と断定しない', async () => {
  const { run, nodes } = await searchFixture({available:4,availableType:'accessible',requested:'standard'});
  assert.equal(nodes.get('#no-space-content').hidden, false);
  assert.match(nodes.get('#no-space-description').textContent, /普通車.*見つかりません/);
  assert.doesNotMatch(nodes.get('#no-space-description').textContent, /満車/);
  assert.doesNotMatch(run('getCurrentGuidanceMessage()'), /まんしゃ/);
});

test('混雑案内に残り区画数を含め、音声無効時は満車でも自動発話しない', async () => {
  const busy = await searchFixture({available:2,occupied:10});
  assert.equal(busy.run('state.searchOutcome'), 'found');
  assert.equal(busy.nodes.get('#congestion-notice').hidden, false);
  assert.match(busy.nodes.get('#congestion-notice').textContent, /残り2区画/);
  assert.match(busy.run('speechCalls[0]'), /こんざつ.*のこりにくかく/);
  const muted = await searchFixture({voice:false});
  assert.equal(muted.run('speechCalls.length'), 0);
  assert.match(muted.run('getCurrentGuidanceMessage()'), /つうか/);
});

test('状態不明・登録区画ゼロをデモの空き区画へ置き換えず、未確認と表示する', async () => {
  const unknown = await searchFixture({available:2,unknown:true});
  assert.equal(unknown.result.spaceId, null);
  assert.match(unknown.nodes.get('#search-status').textContent, /未確認/);
  const empty = await searchFixture({occupied:0});
  assert.equal(empty.result.spaceId, null);
  assert.equal(empty.run('state.resultSimulation'), false);
  assert.match(empty.nodes.get('#search-status').textContent, /未確認/);
  assert.doesNotMatch(empty.nodes.get('#search-status').textContent, /デモ/);
});

test('端末読み上げにも読み仮名変換を適用し、二重変換せず英語へは適用しない', async () => {
  const {run,context} = app();
  context.FACILITY_CATALOG = [{id:'target_024',name:'マルナカ 芳田店'}];
  let spoken;
  context.SpeechSynthesisUtterance = class {constructor(text){this.text=text;} addEventListener(){} };
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis.getVoices = () => [{name:'Japanese',lang:'ja-JP'}];
  context.window.speechSynthesis.speak = utterance => {spoken=utterance.text;};
  await run("speakTextWhenVoicesReady('マルナカ 芳田店の区画５番。')");
  assert.equal(spoken,'まるなか よしだてんのくかくごばん。');
  assert.equal(run("normalizeJapaneseSpeech(normalizeJapaneseSpeech('空き区画５番。'))"),'あきくかくごばん。');
  assert.equal(run("getFacilitySpokenName('ja-JP')"),'');
  run("state.selectedFacility={id:'target_111',name:'ハンズマン 宇宿店'}");
  assert.equal(run("getFacilitySpokenName('ja-JP')"),'はんずまん うすきてん');
  assert.equal(run("getFacilitySpokenName('en-US')"),'ハンズマン 宇宿店');
  run("state.language='en';state.guidanceVoiceLanguage='en-US'");
  await run("speakTextWhenVoicesReady('Parking space B-05')");
  assert.equal(spoken,'Parking space B-05');
});

test('実際のユーザーレンダラーは全22種類・全駐車線形式と標識を表示し、案内番号を二重表示しない',()=>{const {run,nodes}=app();run(`const fixtureObjects=mapDisplay.types.map((objectType,i)=>({uid:'o'+i,objectType,name:'名称',spaceNumber:'001',spaceGroup:'A',spaceGroupKind:'area',spaceType:'ev',markingStyle:'photoStall',routeNumber:'123',signType:'stop',publicAccess:true,status:'available',x:30*(i%6),y:30*Math.floor(i/6),width:25,height:25}));const parkingFixture=fixtureObjects.find(o=>o.objectType==='parkingSpace');const fixtureLayout={facilityId:'a',objects:fixtureObjects};const recommendedFixture={uid:parkingFixture.uid,id:'A区画 1',sourceObject:parkingFixture};state.guideEntrance=fixtureObjects.find(o=>o.objectType==='buildingEntrance');calculateGuidanceViewport=()=>({x:0,y:0,width:360,height:400,scale:1});renderRegisteredLayout(fixtureLayout,recommendedFixture);`);const map=nodes.get('#parking-map');const objects=map.children.filter(n=>n.dataset.objectType);assert.equal(objects.length,22);const parking=objects.find(n=>n.dataset.objectType==='parkingSpace');assert.equal(walk(parking).filter(n=>n.className==='space-number-mark').length,0);assert.equal(walk(map).filter(n=>n.tagName==='strong'&&n.textContent==='A区画 1').length,1);assert.ok(objects.find(n=>n.dataset.objectType==='building').children.some(n=>n.className==='map-object-label'));assert.equal(objects.find(n=>n.dataset.objectType==='roadSign').children.length,1);run(`fixtureLayout.objects=mapDisplay.markingStyles.map((markingStyle,i)=>({...parkingFixture,uid:'p'+i,markingStyle,spaceNumber:String(i+1)}));state.guideEntrance=null;renderRegisteredLayout(fixtureLayout,null);`);assert.equal(map.children.length,16);for(let i=0;i<16;i++)assert.equal(walk(map.children[i]).filter(n=>n.tagName==='path').length,i===15?0:1);});
test('検索結果・音声・マップの区画番号に同じ列名とゼロを除いた番号を使う',()=>{const {run}=app();run(`const groupedItem={uid:'p',objectType:'parkingSpace',name:'普通車 001',spaceNumber:'001',spaceGroup:'A',spaceGroupKind:'row',status:'available',x:10,y:10,width:25,height:50};const groupedSpace=createLayoutParkingSpaces({objects:[groupedItem]},{id:'a'})[0];`);assert.equal(run('groupedSpace.id'),'A列 1');assert.match(run('getSpokenSpaceId(groupedSpace)'),/えー.*れつ.*いち/);assert.equal(run("getSpokenSpaceId(groupedSpace,'en-US')"),'A列 1');});

function loadFacilityCatalog() {
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../facilities.js'),'utf8'),context);
  return JSON.parse(vm.runInContext('JSON.stringify(FACILITY_CATALOG)',context));
}

test('道の駅日光は過去録画だけでは8区画すべて未確認で案内しない',()=>{
  const nikko={id:'nikko-test-001',name:'道の駅日光',isRecordedExperiment:true,researchSpaceCount:8,requiresLocalCalibration:true};
  const {run,context}=app([nikko]);
  context.nikko=nikko;
  assert.equal(run('getFacilityOccupancy(nikko).level'),'unknown');
  assert.equal(run('prepareSpaces(nikko).spaces.length'),8);
  assert.equal(run('prepareSpaces(nikko).spaces.every(s=>s.occupancyStatus==="unknown"&&s.isOccupied)'),true);
  assert.equal(run('selectRecommendedSpace(prepareSpaces(nikko).spaces,"near","standard")'),null);
  context.window.PARKING_LAYOUTS['nikko-test-001']={
    facilityId:'nikko-test-001',
    objects:[{objectType:'parkingSpace',uid:'space_001',spaceType:'standard',status:'available',x:0,y:0,width:25,height:50}],
  };
  assert.equal(run('prepareSpaces(nikko).isSimulation'),false);
  assert.equal(run('prepareSpaces(nikko).spaces[0].occupancyStatus'),'unknown');
  assert.equal(run('getFacilityOccupancy(nikko).level'),'unknown');
});
test('自宅と日光の現在地は端末内で別々に登録・削除する',()=>{
  const {run,context}=app();
  const data=new Map();
  context.localStorage={
    getItem:(key)=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,value),
    removeItem:(key)=>data.delete(key),
  };
  context.home={id:'home-test-001',requiresLocalCalibration:true};
  context.nikko={id:'nikko-test-001',requiresLocalCalibration:true};
  assert.equal(run('getFacilityCoordinate(nikko)'),null);
  run('state.selectedFacility=home; savePrivateTestCoordinate({latitude:34.5,longitude:133.7,accuracy:10})');
  assert.equal(run('readPrivateTestCoordinate(home).latitude'),34.5);
  assert.equal(run('getFacilityCoordinate(nikko)'),null);
  run('state.selectedFacility=nikko; savePrivateTestCoordinate({latitude:35.2,longitude:134.3,accuracy:20})');
  assert.equal(run('readPrivateTestCoordinate(nikko).latitude'),35.2);
  assert.equal(run('readPrivateTestCoordinate(home).latitude'),34.5);
  assert.notEqual([...data.keys()].find(key=>key.endsWith(':nikko-test-001')),undefined);
  run('clearPrivateTestCoordinate()');
  assert.equal(run('getFacilityCoordinate(nikko)'),null);
  assert.equal(run('getFacilityCoordinate(home).latitude'),34.5);
});

test('ランダムデモは空車・混雑・満車を生成し、区画数・案内対象が状態に一致する',()=>{
  const {run}=app();
  for(const [value,level,count] of [[0,'open',4],[.5,'busy',2],[.99,'full',0]]){
    run(`Math.random=()=>${value}; testSpaces=createDemoParkingSpaces();`);
    assert.equal(run('summarizeOccupancy(testSpaces,true).level'),level);
    assert.equal(run('testSpaces.filter(s=>!s.isOccupied).length'),count);
    assert.equal(run('testSpaces.length'),12);
    assert.equal(run('new Set(testSpaces.map(s=>s.uid)).size'),12);
    assert.equal(run("testSpaces.every(s=>s.occupancyStatus===(s.isOccupied?'occupied':'available'))"),true);
    const recommendation=run("selectRecommendedSpace(testSpaces,'balanced','standard')");
    if(recommendation)assert.equal(recommendation.isOccupied,false);
    if(level==='full')assert.equal(recommendation,null);
  }
});

test('一覧・検索は同じ抽選を保持し、再抽選は選択施設だけを更新する',async()=>{
  const {run,context,nodes}=app();
  context.window.PARKING_REMOTE_CONFIG.enabled=false;
  context.window.setTimeout=fn=>fn();
  run(`state.selectedFacility={id:'a',name:'テスト'};state.currentScreen='result';state.voiceEnabled=false;
    saveSearchConditions=()=>{};renderParkingMap=()=>{};Math.random=()=>0;
    otherFacility={id:'b'};before=JSON.stringify(prepareSpaces(otherFacility).spaces);`);
  assert.equal(run('getFacilityOccupancy(state.selectedFacility).level'),'open');
  run('Math.random=()=>.99');
  await run('runSpaceSearch()');
  assert.equal(run('summarizeOccupancy(state.currentSpaces).level'),'open');
  assert.equal(run('getFacilityOccupancy(state.selectedFacility).level'),'open');
  run('prepareSpaces(state.selectedFacility).spaces.forEach(s=>s.isOccupied=true)');
  assert.equal(run('getFacilityOccupancy(state.selectedFacility).level'),'open');
  await run('runSpaceSearch(null,{refreshSimulation:true})');
  assert.equal(run('state.searchOutcome'),'not-found');
  assert.equal(run('getFacilityOccupancy(state.selectedFacility).level'),'full');
  assert.match(nodes.get('#no-space-description').textContent,/デモ.*満車.*再抽選/);
  assert.equal(run('JSON.stringify(prepareSpaces(otherFacility).spaces)'),run('before'));
  const fresh=app();fresh.run("Math.random=()=>.5");
  assert.equal(fresh.run("getFacilityOccupancy({id:'a'}).level"),'busy');
});

test('再抽選しても登録済みの駐車レイアウトをランダム状態で上書きしない',async()=>{
  const {run,context}=app();
  context.window.PARKING_REMOTE_CONFIG.enabled=false;
  context.window.setTimeout=fn=>fn();
  context.window.PARKING_LAYOUTS.a={facilityId:'a',objects:[{objectType:'parkingSpace',uid:'p',spaceNumber:'1',x:10,y:10,width:25,height:50,spaceType:'standard',status:'available'}]};
  run(`state.selectedFacility={id:'a',name:'登録済み'};state.currentScreen='result';state.voiceEnabled=false;
    saveSearchConditions=()=>{};renderParkingMap=()=>{};Math.random=()=>.99;`);
  await run('runSpaceSearch(null,{refreshSimulation:true})');
  assert.equal(run('state.resultSimulation'),false);
  assert.equal(run('state.currentSpaces[0].isOccupied'),false);
  assert.equal(run('state.demoParkingSpaces.has("a")'),false);
  assert.equal(context.window.PARKING_LAYOUTS.a.objects[0].status,'available');
});

test('福岡県100店舗すべてで250m接近を判定し、精度制限と1回だけの自動案内を守る',async()=>{
  const fukuoka=loadFacilityCatalog().filter(f=>f.prefecture==='福岡県');
  const {run,context}=app(fukuoka);
  run('autoCalls=[];runSpaceSearch=async(_,options)=>autoCalls.push({id:state.selectedFacility.id,options});');
  for(const f of fukuoka){
    context.facility=f;
    run(`state.selectedFacility=facility;state.autoProximityArmed=true;state.autoTriggeredFacilityId=null;
      state.userLocation={latitude:facility.latitude+.01,longitude:facility.longitude,accuracy:20};`);
    const before=run('autoCalls.length');
    await run('checkAutomaticProximitySearch()');
    assert.equal(run('autoCalls.length'),before,`${f.id}: distant`);
    run('state.userLocation.latitude=facility.latitude+.001;state.userLocation.accuracy=81');
    await run('checkAutomaticProximitySearch()');
    assert.equal(run('autoCalls.length'),before,`${f.id}: inaccurate`);
    run('state.userLocation.accuracy=80');
    await run('checkAutomaticProximitySearch()');
    assert.equal(run('autoCalls.length'),before+1,`${f.id}: approach`);
    assert.equal(run('autoCalls.at(-1).id'),f.id);
    assert.equal(run('autoCalls.at(-1).options.autoTriggered'),true);
    await run('checkAutomaticProximitySearch()');
    assert.equal(run('autoCalls.length'),before+1,`${f.id}: duplicate`);
  }
  assert.equal(run('autoCalls.length'),100);
});

test('音声一覧が遅いiPhoneでも案内開始操作と同時に端末音声を呼び出す', async () => {
  const { run, context } = app();
  const spoken = [];
  context.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
    addEventListener() {}
  };
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis.getVoices = () => [];
  context.window.speechSynthesis.speak = (u) => spoken.push(u.text);
  context.wait = () => new Promise(() => {});
  run('waitForSpeechVoices = wait; state.selectedFacility = {id: "a", name: "実験用駐車場"};');
  assert.equal(run('speakAutomaticGuidanceStartMessage({ userGesture: true })'), true);
  assert.equal(spoken.length, 1, '音声一覧の待機を挟まずに発話を要求する');
  assert.match(spoken[0], /じどうであきくかく/);
});
test('待機画面への遷移後は同じ検索IDで位置確認完了を待てる', () => {
  const { run } = app();
  run('state.currentScreen = "condition"; state.selectedFacility = {id:"a"}; showScreen("waiting"); reqId = state.searchRequestId;');
  assert.equal(run('reqId'), 1);
  assert.equal(run('reqId === state.searchRequestId'), true);
});
test('利用者マップの拡大範囲は保存座標の縮尺を変えても同じ見え方を維持する',()=>{const {run}=app();run(`const refObjects=[{uid:'p',objectType:'parkingSpace',x:100,y:100,width:25,height:50},{uid:'e',objectType:'buildingEntrance',x:150,y:60,width:8,height:8}];const refLayout={canvas:{width:1800,height:1200},objects:refObjects};mapViewMode='focus';const refView=calculateGuidanceViewport(refLayout,{sourceObject:refObjects[0]},new Set(mapDisplay.types),refObjects[1]);`);for(const factor of [.1,10]){const ratio=run(`(()=>{const factor=${factor};const scaled=refObjects.map(o=>({...o,x:o.x*factor,y:o.y*factor,width:o.width*factor,height:o.height*factor}));const view=calculateGuidanceViewport({canvas:{width:1800*factor,height:1200*factor},objects:scaled},{sourceObject:scaled[0]},new Set(mapDisplay.types),scaled[1]);return view.scale*factor/refView.scale;})()`);assert.ok(Math.abs(ratio-1)<1e-9);}});

test('全40種類の検索は選んだ種類だけを案内し、専用・消防・カスタムを普通車へ混ぜない',()=>{
 const {run,context}=app();const keys=run('Object.keys(mapDisplay.spacePresets)');
 for(const type of keys){context.requestType=type;const result=run(`selectRecommendedSpace([{id:'chosen',spaceType:requestType,isOccupied:false,distanceScore:5},{id:'wrong',spaceType:'standard',isOccupied:false,distanceScore:1}],'near',requestType)`);if(run('mapDisplay.isGuidableType(requestType)'))assert.equal(result.id,type==='standard'?'wrong':'chosen',type);else assert.equal(result,null,type);}
 assert.equal(run(`selectRecommendedSpace([{id:'bus',spaceType:'bus',isOccupied:false}],'balanced','large')`),null);
 assert.equal(run(`selectRecommendedSpace([{id:'fire',spaceType:'fireAccess',isOccupied:false}],'balanced','standard')`),null);
 assert.equal(run(`getSpaceTypeLabel('bus')`),'バス専用');run(`state.language='en'`);assert.equal(run(`getSpaceTypeLabel('bus')`),'Bus only');
});

test('全言語でネットワーク音声のエラー時は同言語の端末内音声へ一度だけ切り替える',async()=>{
 const {run,context}=app();let spoken=[];
 context.SpeechSynthesisUtterance=class{constructor(text){this.text=text;this.handlers={};}addEventListener(type,fn){this.handlers[type]=fn;}};
 const voices=['ja-JP','en-US','en-GB','zh-CN','ko-KR','es-ES'].flatMap(lang=>[
  {name:'Google '+lang,voiceURI:'remote-'+lang,lang,localService:false},
  {name:'Local '+lang,voiceURI:'local-'+lang,lang,localService:true}]);
 context.window.speechSynthesis.getVoices=()=>voices;context.window.speechSynthesis.speak=u=>spoken.push(u);
 for(const lang of ['ja-JP','en-US','en-GB','zh-CN','ko-KR','es-ES']){
  context.testLocale=lang;run(`state.language=testLocale==='ja-JP'?'ja':'en';state.guidanceVoiceLanguage=testLocale;state.voiceProfiles[testLocale]={voiceURI:'remote-'+testLocale};`);
  spoken=[];await run("speakTextWhenVoicesReady('sample')");assert.equal(spoken[0].voice.localService,false);
  spoken[0].handlers.error({error:'network'});
  assert.equal(spoken.length,2);assert.equal(spoken[1].voice.lang,lang);assert.equal(spoken[1].voice.localService,true);
  spoken[1].handlers.error({error:'synthesis-failed'});assert.equal(spoken.length,2);
  assert.match(run('voiceStatus.textContent'),/sample/);
 }
});
test('オフラインでは選択したネット音声より同言語の端末内音声を優先する',async()=>{
 const {run,context}=app();let spoken;
 context.window.navigator={onLine:false};
 context.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}addEventListener(){}};
 context.window.speechSynthesis.getVoices=()=>[{name:'Google',lang:'en-US',voiceURI:'remote',localService:false},{name:'Samantha Enhanced',lang:'en-US',voiceURI:'local',localService:true}];
 context.window.speechSynthesis.speak=u=>{spoken=u;};
 run("state.language='en';state.guidanceVoiceLanguage='en-US';state.voiceProfiles['en-US']={voiceURI:'remote'}");
 await run("speakTextWhenVoicesReady('sample')");assert.equal(spoken.voice.voiceURI,'local');run('cancelSpeech()');
});

test('選択店舗の入口に一致しない別店舗の入口へ案内を置き換えない',()=>{
 const {run}=app();
 run(`state.selectedDestination={id:'shop',buildingId:'canonical',buildingAliases:['legacy']}`);
 assert.equal(run(`getGuideEntrance({objects:[{objectType:'buildingEntrance',buildingId:'other',x:0,y:0,guideTarget:true}]},{})`),null);
 assert.equal(run(`getGuideEntrance({objects:[{objectType:'buildingEntrance',uid:'legacy-entry',buildingId:'legacy',x:0,y:0}]},{}).uid`),'legacy-entry');
});
test('閉店前の音声はすべての対応言語の案内文に含まれる',()=>{
 const {run,context}=app();
 context.window.ParkingOperations={operating:()=>({closed:false,closingSoon:true,closingKey:'close'})};
 run(`state.selectedFacility={id:'f',name:'Facility'};state.recommendedSpace={id:'1'};state.searchOutcome='found';state.currentSpaces=[]`);
 for(const locale of ['ja-JP','en-US','en-GB','zh-CN','ko-KR','es-ES']){
  context.locale=locale;assert.ok(run('getClosingAnnouncement(locale)').length>0);
  assert.ok(run('getCurrentGuidanceMessage(locale).startsWith(getClosingAnnouncement(locale))'));
  assert.ok(run('getAutomaticGuidanceStartMessage(locale).startsWith(getClosingAnnouncement(locale))'));
 }
});

test('待機中の閉店通知は一度だけで、音声OFF・非表示・別画面では発話しない',()=>{
 const {run,context}=app();
 context.window.ParkingOperations={operating:()=>({closed:false,closingSoon:true,closingKey:'2026-10-26T21:00'})};
 run(`state.selectedFacility={id:'f'};state.currentScreen='waiting';let closingCalls=0;speakText=()=>{closingCalls++;return true;};`);
 assert.equal(run('announceClosingTimeIfNeeded()'),true);assert.equal(run('announceClosingTimeIfNeeded()'),false);assert.equal(run('closingCalls'),1);
 run(`state.selectedDestination={id:'second'};state.voiceEnabled=false;`);assert.equal(run('announceClosingTimeIfNeeded()'),false);
 run('state.voiceEnabled=true;document.hidden=true;');assert.equal(run('announceClosingTimeIfNeeded()'),false);
 run(`document.hidden=false;state.currentScreen='condition'`);assert.equal(run('announceClosingTimeIfNeeded()'),false);
 run(`state.currentScreen='waiting'`);assert.equal(run('announceClosingTimeIfNeeded()'),true);assert.equal(run('closingCalls'),2);
});


test("組み立て方式では保存済みの施設名・固定文を順番に再生し、全文合成を呼ばない", async () => {
  const { run, context } = app();
  const starts = [];
  const requested = [];
  context.navigator = { audioSession: { type: "ambient" } };
  context.window.AudioContext = class {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    createOscillator() {
      return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    }
    createGain() { return { gain: { setValueAtTime() {} }, connect() {} }; }
    createBufferSource() {
      return {
        playbackRate: { setValueAtTime() {} },
        connect() {}, addEventListener() {}, stop() {},
        start(at) { starts.push(at); },
      };
    }
    async decodeAudioData() { return { duration: 0.3 }; }
    async resume() {}
    async close() {}
  };
  context.window.ParkingVoiceAudioCache = {
    async get(part, options) {
      requested.push({ part, cachedOnly: options.cachedOnly === true });
      return { bytes: new ArrayBuffer(300), source: "saved" };
    },
  };
  run("state.cloudVoiceEnabled = true; state.voiceEnabled = true");
  assert.equal(run("speakText('A店へご案内します。', {parts:['A店','へ','ご案内します。']})"), true);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requested.map(item => item.part), ["A店", "へ", "ご案内します。"]);
  assert.equal(requested.every(item => item.cachedOnly), true);
  assert.equal(starts.length, 3);
  assert.ok(starts[0] < starts[1] && starts[1] < starts[2]);
  run("cancelSpeech()");
});


test("未保存の組み立て音声は外部APIを呼ばずに同じ案内文を端末音声で再生する", async () => {
  const {run,context}=app();
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../voice-guide-playback.js"),"utf8"),context);
  let externalCalls=0;
  context.fetch=async()=>{ externalCalls+=1; throw new Error("external TTS must not be called"); };
  context.navigator={audioSession:{type:"ambient"}, onLine:false};
  const utterances=[];
  class Speech {
    constructor(text) { this.text=text; this.handlers={}; }
    addEventListener(name,fn) {this.handlers[name]=fn;}
  }
  context.SpeechSynthesisUtterance=Speech;
  context.window.SpeechSynthesisUtterance=Speech;
  context.window.speechSynthesis.getVoices=()=>[
    {name:"Google 日本語",lang:"ja-JP",localService:true,voiceURI:"voice:test"},
  ];
  context.window.speechSynthesis.cancel=()=>{};
  context.window.speechSynthesis.speak=u=>{
    utterances.push(u.text);
    Promise.resolve().then(()=>{u.handlers.start?.();u.handlers.end?.();});
  };
  context.window.AudioContext=class {
    constructor(){this.destination={};this.currentTime=0;this.state="running";}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},start(){},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){}},connect(){}};}
    createBufferSource(){return {connect(){},start(){},stop(){},addEventListener(){}};}
    decodeAudioData(){return Promise.resolve({duration:1});}
    resume(){return Promise.resolve();}
    close(){return Promise.resolve();}
  };
  context.window.ParkingVoiceAudioCache={
    async get(_message,options){
      assert.equal(options.cachedOnly,true);
      throw new Error("Audio clip is not prepared");
    },
  };
  run("state.cloudVoiceEnabled=true;state.voiceEnabled=true;");
  const intro="まもなく目的地です。ご希望の駐車枠をご案内します。";
  const space="Aエリアの12番です。";
  const caution="現地の標識や係員の案内を優先し、駐車場内は徐行してください。";
  const message=intro+"繰り返します。"+space+space+caution+caution+caution;
  const parts=[intro,"繰り返します。",space,space,caution,caution,caution];
  assert.equal(run("speakText("+JSON.stringify(message)+",{parts:"+JSON.stringify(parts)+"})"),true);
  await new Promise(resolve=>setTimeout(resolve, 2600));
  const expected=run("normalizeJapaneseSpeech("+JSON.stringify(message)+")");
  assert.equal(utterances.join(""),expected);
  assert.equal(externalCalls,0);
  assert.ok(utterances.length>=2,"chunked sentence assembly");
});


test('施設選択時の共通音声先読みは重複を除き3件ずつ取得し、合成APIを呼ばない', async () => {
  const { run, context } = app();
  const received = [];
  context.window.ParkingVoiceAudioCache = {
    get(message, options) {
      received.push({ message, options });
      return Promise.resolve({ source: "saved", bytes: new ArrayBuffer(300) });
    },
  };
  run('state.cloudVoiceEnabled = true; state.selectedFacility = { id: "test", name: "試験店舗" };');
  run('startScript = () => ({parts:["共通の文。","試験店舗","共通の文。"]});');
  run('makePreparedScript = id => ({parts:[id, "共通の文。"]});');
  run('normalizeJapaneseSpeech = value => value;');
  run("preloadPreparedGuidanceClips()");
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received.map(x => x.message), [
    "共通の文。", "試験店舗", "approaching", "retry_started",
    "space_none", "retry_none",
  ]);
  assert.ok(received.every(x => x.options.cachedOnly === true && x.options.remote === true));
  run("state.cloudVoiceEnabled = false; preloadPreparedGuidanceClips();");
  assert.equal(received.length, 6, "無効設定なら先読みしない");
});

test('施設の登録済み駐車枠番号と到着時の固定音声を先読みする', async () => {
  const {run, context} = app();
  const received = [];
  context.window.ParkingVoiceAudioCache = {
    get(message, options) {
      received.push({message, options});
      return Promise.resolve({source: "saved", bytes: new ArrayBuffer(500)});
    },
  };
  context.window.ParkingVoiceGuideScripts = {
    build(id) {
      return {parts: [{role:"fixed",text: "固定:" + id + "。"},
        {role:"駐車枠",text:"いち"}, {role:"fixed",text:"番です。"}]};
    },
  };
  run(`state.cloudVoiceEnabled=true;
    state.selectedFacility={id:'lot', name:'試験施設'};
    startScript=()=>({parts:["案内開始。"]});
    makePreparedScript=id=>({parts:["案内:"+id+"。"]});
    getFacilityLayout=()=>({objects:[{objectType:"parkingSpace",spaceNumber:"001"},
      {objectType:"parkingSpace",spaceNumber:"002"}]});
    createLayoutParkingSpaces=()=>[
      {id:"1",sourceObject:{spaceNumber:"001"}},
      {id:"2",sourceObject:{spaceNumber:"002"}},
      {id:"2",sourceObject:{spaceNumber:"002"}}
    ];
    getSpokenSpaceId=space=>space.id==="1"?"いち":"に";
    normalizeJapaneseSpeech=x=>x;`);
  run("preloadPreparedGuidanceClips()");
  for(let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve));
  const spoken=received.map(x=>x.message);
  assert.ok(spoken.includes("いち"));
  assert.ok(spoken.includes("に"));
  assert.equal(spoken.filter(x=>x==="に").length,1);
  assert.ok(spoken.includes("固定:space_found。"));
  assert.ok(spoken.includes("固定:retry_found。"));
  assert.ok(spoken.includes("番です。"));
  assert.ok(received.every(x=>x.options.remote && x.options.cachedOnly));
});


test("駐車場所の読みが駐車場の部分置換で壊れない", () => {
  const { run } = app();
  const sentence = run('normalizeJapaneseSpeech("お客様の駐車場所は、A列の12番です。")');
  assert.match(sentence, /お客様のちゅうしゃばしょは、/);
  assert.doesNotMatch(sentence, /ちゅうしゃじょう所/);
});

test("保存済み音声部品は最大6本の並列デコードで読み、順序と駐車枠2回を保つ", async () => {
  const { run, context } = app();
  let active = 0, peak = 0;
  const starts = [];
  context.navigator = { audioSession: {type:"ambient"} };
  context.window.AudioContext = class {
    constructor() { this.destination={};this.currentTime=0;this.state="running"; }
    createOscillator() { return {frequency:{setValueAtTime(){}},connect(){},start(){},stop(){}}; }
    createGain() { return {gain:{setValueAtTime(){}},connect(){}}; }
    createBufferSource() {
      return { playbackRate:{setValueAtTime(){}},connect(){},addEventListener(){},
        start(at){starts.push(at);},stop(){} };
    }
    decodeAudioData() {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise(resolve => setImmediate(() => {
        active -= 1;
        resolve({duration:0.24});
      }));
    }
    resume() {return Promise.resolve();}
    close() {return Promise.resolve();}
  };
  const fetched = [];
  context.window.ParkingVoiceAudioCache = {
    get: async (piece, options) => {
      assert.equal(options.cachedOnly,true);
      fetched.push(piece);
      return {bytes:new ArrayBuffer(400),source:"saved"};
    },
  };
  run("state.cloudVoiceEnabled=true;state.voiceEnabled=true;");
  const space="A列12番";
  const parts=["まもなく目的地です。","ご案内する駐車枠は、",space,"番です。",
    "繰り返します。",space,"番です。","安全運転でお進みください。"];
  const message=parts.join("");
  assert.equal(run("speakText("+JSON.stringify(message)+",{parts:"+JSON.stringify(parts)+"})"),true);
  for(let i=0;i<10;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(peak,6);
  assert.equal(starts.length,parts.length);
  assert.ok(starts.every((at,i)=>i===0 || at>=starts[i-1]));
  const spokenSpace = run("normalizeJapaneseSpeech("+JSON.stringify(space)+")");
  assert.equal(fetched.filter(x=>x===spokenSpace).length,1,"正規化した同じ番号のMP3は一度だけ読み取る");
});


test('YOLOの新しい2回の占有判定後だけ、自分の車か質問する', () => {
  const {run,context,nodes}=app();
  let row={status:'occupied',source:'yolo',checked_at:new Date(Date.now()-1000).toISOString()};
  context.window.ParkingLiveStatus={snapshot:()=>({
    published:true,error:false,rows:new Map([['stall-1',row]])
  }),stop(){}};
  run("state.currentScreen='result';state.searchOutcome='found';state.resultLive=true;state.voiceEnabled=false;");
  run("state.selectedFacility={id:'home-test-001',name:'実験用駐車場'};");
  run("state.recommendedSpace={uid:'stall-1',id:'A列 12',spaceType:'standard'};");
  run("startArrivalCheck(state.selectedFacility,state.recommendedSpace,true);state.arrivalCheck.startedAt=Date.now()-5000;");
  run("updateParkingArrivalPanel()");
  assert.equal(run('state.arrivalCheck.hitCount'),1);
  assert.equal(run('state.arrivalCheck.confirmed'),false);
  run('updateParkingArrivalPanel()');
  assert.equal(run('state.arrivalCheck.hitCount'),1,'同じフレームは重複カウントしない');
  row={...row,checked_at:new Date().toISOString()};
  run('state.arrivalCheck.occupiedSince=Date.now()-2500;updateParkingArrivalPanel()');
  assert.equal(run('state.arrivalCheck.confirmed'),true);
  assert.equal(nodes.get('#parking-arrival-actions').hidden,false);
  assert.match(nodes.get('#parking-arrival-status').textContent,/ご自身の車ですか/);
});

test('録画映像や古いYOLO判定では本人確認を表示しない',()=>{
  const {run,context}=app();
  let source='recorded_video_demo',time=new Date().toISOString();
  context.window.ParkingLiveStatus={snapshot:()=>({
    published:true,error:false,
    rows:new Map([['p',{status:'occupied',source,checked_at:time}]])
  })};
  run("state.currentScreen='result';state.searchOutcome='found';state.resultLive=true;");
  run("state.selectedFacility={id:'home-test-001'};state.recommendedSpace={uid:'p',id:'1'};");
  run("startArrivalCheck(state.selectedFacility,state.recommendedSpace,true);state.arrivalCheck.startedAt=Date.now()-5000;");
  run('updateParkingArrivalPanel()');
  assert.equal(run('state.arrivalCheck.hitCount'),0);
  source='yolo';
  time=new Date(Date.now()-30000).toISOString();
  run('updateParkingArrivalPanel()');
  assert.equal(run('state.arrivalCheck.confirmed'),false);
  run("startArrivalCheck({id:'home-video-demo-001',isRecordedExperiment:true},{uid:'p',id:'1'},true)");
  assert.equal(run('state.arrivalCheck'),null,'録画デモは現地の駐車完了としない');
});

test('自分の車なら案内を停止し、駐車番号と地図を出庫まで保持する',()=>{
  const {run,nodes,context}=app();
  let stopped=0;
  context.window.ParkingLiveStatus={stop(){stopped++;}};
  run("state.currentScreen='result';state.searchOutcome='found';state.resultLive=true;state.voiceEnabled=false;");
  run("state.selectedFacility={id:'home-test-001',name:'実験用駐車場'};");
  run("state.recommendedSpace={uid:'p',id:'A列 12',isOccupied:true,spaceType:'standard'};");
  run("state.currentSpaces=[state.recommendedSpace];state.currentLayout=null;");
  // DOMの簡易モックはinnerHTMLやquerySelectorを再現しないため、地図の再描画は既存のレンダラーテストで担保。
  run("renderParkingMap=()=>{};");
  run("state.arrivalCheck={facilityId:'home-test-001',uid:'p',confirmed:true};");
  assert.equal(run('confirmOwnParking()'),true);
  assert.equal(run('state.currentScreen'),'parked');
  assert.equal(run('state.parkedSpace.id'),'A列 12');
  assert.equal(nodes.get('#parked-space-number').textContent,'A列 12');
  assert.equal(nodes.get('#parked-facility-name').textContent,'実験用駐車場');
  assert.ok(nodes.get('#parked-map-slot').children.includes(nodes.get('#parking-map-section')));
  assert.ok(stopped>0);
  assert.equal(run('departParkedLocation()'),true);
  assert.equal(run('state.currentScreen'),'facility');
  assert.equal(run('state.parkedSpace'),null);
  assert.ok(nodes.get('#result-map-slot').children.includes(nodes.get('#parking-map-section')));
});

test('他の車ならその区画を指定して別の空き枠を自動探索する',()=>{
  const {run}=app();
  run("state.currentScreen='result';state.searchOutcome='found';");
  run("state.selectedFacility={id:'home-test-001',name:'実験用駐車場'};");
  run("state.recommendedSpace={uid:'occupied-stall',id:'4'};");
  run("state.arrivalCheck={facilityId:'home-test-001',uid:'occupied-stall',confirmed:true};");
  run("var capturedReroute=null;runSpaceSearch=(priority,options)=>{capturedReroute={priority,options};return Promise.resolve();};");
  assert.equal(run('rejectOtherCar()'),true);
  assert.equal(run('capturedReroute.options.excludedSpaceUid'),'occupied-stall');
  assert.equal(run('capturedReroute.options.fromRetry'),true);
  assert.equal(run('state.arrivalCheck'),null);
  assert.equal(run('state.currentScreen'),'result');
});

test('他車の区画は誤って空き判定に戻っても検索候補から除外する',async()=>{
  const {run,context}=app();
  context.window.ParkingLiveStatus={
    refresh:async()=>({published:true}),snapshot:()=>({published:true,rows:new Map()}),
    watch(){},stop(){}
  };
  run("state.selectedFacility={id:'test',name:'Test Parking'};state.currentScreen='result';state.voiceEnabled=false;");
  run("loadRemoteParkingLayouts=async()=>{};saveSearchConditions=()=>{};");
  run("beginLiveUpdates=()=>{};updateSearchResultNotice=()=>{};renderParkingMap=()=>{};");
  run("prepareSpaces=()=>({isLive:true,isSimulation:false,layout:null,entrance:null,spaces:[{uid:'old',id:'4',spaceType:'standard',occupancyStatus:'available',isOccupied:false,distanceScore:1},{uid:'new',id:'5',spaceType:'standard',occupancyStatus:'available',isOccupied:false,distanceScore:2}]});");
  const result=await run("runSpaceSearch(null,{fromRetry:true,excludedSpaceUid:'old'})");
  assert.equal(result.spaceId,'5');
  assert.equal(run('state.recommendedSpace.uid'),'new');
});


test('一度本人確認が表示されたら一時的なカメラ通信断でも回答を保持する',()=>{
  const {run,context,nodes}=app();
  context.window.ParkingLiveStatus={snapshot:()=>({published:true,error:true,rows:new Map()})};
  run("state.currentScreen='result';state.searchOutcome='found';state.resultLive=true;");
  run("state.selectedFacility={id:'home-test-001',name:'実験用'};");
  run("state.recommendedSpace={uid:'p',id:'4'};");
  run("state.arrivalCheck={facilityId:'home-test-001',uid:'p',confirmed:true};");
  run('updateParkingArrivalPanel()');
  assert.equal(run('state.arrivalCheck.confirmed'),true);
  assert.equal(nodes.get('#parking-arrival-confirm').disabled,false);
  assert.equal(nodes.get('#parking-arrival-other').disabled,false);
  assert.equal(nodes.get('#parking-arrival-actions').hidden,false);
});

test('検知されていない区画で駐車位置を確定することはできない',()=>{
  const {run}=app();
  run("state.currentScreen='result';state.searchOutcome='found';");
  run("state.selectedFacility={id:'home-test-001'};state.recommendedSpace={uid:'p',id:'4'};");
  run("state.arrivalCheck={facilityId:'home-test-001',uid:'p',confirmed:false};");
  assert.equal(run('confirmOwnParking()'),false);
  assert.equal(run('state.currentScreen'),'result');
  assert.equal(run('state.parkedSpace'),null);
});


test('駐車位置を端末内だけに保存し、再読込後も番号とマップへ復元できる',()=>{
  const catalog=[{id:'home-test-001',name:'実験用駐車場',layoutId:'home-test-001'}];
  const data=new Map();
  const localStorage={
    setItem(k,v){data.set(k,v);},getItem(k){return data.get(k)||null;},
    removeItem(k){data.delete(k);}
  };
  const first=app(catalog);
  first.context.localStorage=localStorage;
  first.run("state.selectedFacility=FACILITIES.find(x=>x.id==='home-test-001');");
  first.run("state.currentLayout={facilityId:'home-test-001',objects:[{objectType:'parkingSpace',uid:'p',spaceNumber:'012',status:'occupied',x:10,y:15,width:24,height:48}]};");
  first.run("saveParkedSession({uid:'p',id:'A列 12'})");
  assert.equal(JSON.parse(data.get('parkingGuideParkedSessionV1')).id,'A列 12');
  const second=app(catalog);
  second.context.localStorage=localStorage;
  second.run("renderParkingMap=()=>{};");
  assert.equal(second.run('restoreParkedSession()'),true);
  assert.equal(second.run('state.currentScreen'),'parked');
  assert.equal(second.run('state.parkedSpace.id'),'A列 12');
  assert.equal(second.nodes.get('#parked-space-number').textContent,'A列 12');
  assert.ok(second.nodes.get('#parked-map-slot').children.includes(second.nodes.get('#parking-map-section')));
  second.run('endGuidance()');
  assert.equal(second.run('state.currentScreen'),'facility');
  assert.equal(data.has('parkingGuideParkedSessionV1'),false,'出庫で端末保存を削除する');
});

test('駐車位置データが破損していてもホーム画面の初期表示を妨げない',()=>{
  const {run,context}=app();
  context.localStorage={getItem(){return '{broken json';}};
  assert.equal(run('restoreParkedSession()'),false);
  assert.equal(run('state.currentScreen'),'facility');
});


test("iPhoneの端末音声では文章を一度に発話し、1文目だけで終了しない", () => {
  const {run,context}=app();
  context.navigator={userAgent:"Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Safari/604.1"};
  const spoken=[];
  context.SpeechSynthesisUtterance=class {
    constructor(text){this.text=text;this.handlers={};}
    addEventListener(k,fn){this.handlers[k]=fn;}
  };
  context.window.SpeechSynthesisUtterance=context.SpeechSynthesisUtterance;
  context.window.speechSynthesis.getVoices=()=>[{name:"iPhone 日本語",lang:"ja-JP",localService:true}];
  context.window.speechSynthesis.speak=u=>spoken.push(u);
  run("state.cloudVoiceEnabled=false;state.voiceEnabled=true;");
  const text="ご案内する駐車枠です。繰り返します。A列の12番です。";
  context.textToSpeak=text;
  const started=run("speakText(textToSpeak,{parts:['ご案内する駐車枠です。','繰り返します。','A列の12番です。']})");
  assert.equal(started,true);
  assert.equal(spoken.length,1,"iOS should use one long utterance instead of separate sentences");
  assert.ok(spoken[0].text.includes("繰り返します"));
  assert.ok(spoken[0].text.includes("ばんです"));
  spoken[0].handlers.end();
  assert.equal(spoken.length,1);
  assert.equal(run("activeDeviceSpeechUtterance"),null);
});

test("保存済み4部品を1本の音源へ連結し、先頭の音声だけで終了しない",async()=>{
  const {run,context}=app();
  const started=[],sources=[];
  context.navigator={audioSession:{type:"ambient"}};
  context.window.speechSynthesis.getVoices=()=>[];
  context.window.speechSynthesis.speak=()=>{throw new Error("saved clips should not use device TTS");};
  const audioBuffer=(length=800)=>{
    const data=[new Float32Array(length).fill(.2)];
    return {numberOfChannels:1,length,sampleRate:8000,duration:length/8000,
      getChannelData(c){return data[c];}};
  };
  context.window.AudioContext=class {
    constructor(){this.destination={};this.currentTime=0;this.sampleRate=8000;this.state="running";}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},start(){},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){}},connect(){} };}
    decodeAudioData(){return Promise.resolve(audioBuffer());}
    createBuffer(channels,length,rate){
      assert.equal(rate,8000);
      const data=Array.from({length:channels},()=>new Float32Array(length));
      return {numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,
        getChannelData(c){return data[c];}};
    }
    createBufferSource(){
      const source={connect(){},playbackRate:{setValueAtTime(){}},
        addEventListener(type,fn){if(type==="ended")this.onEnd=fn;},
        start(at){started.push(at);sources.push(this);},stop(){}};
      return source;
    }
    resume(){return Promise.resolve();}
    close(){return Promise.resolve();}
  };
  context.window.ParkingVoiceAudioCache={
    get:async()=>({bytes:new ArrayBuffer(10),source:"saved"})
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../voice-continuous-playback.js"),"utf8"),context);
  run("state.cloudVoiceEnabled=true;state.voiceEnabled=true;");
  const parts=["案内します。","A列12番です。","繰り返します。","A列12番です。"];
  context.partsToRead=parts;
  assert.equal(run("speakText(partsToRead.join(''),{parts:partsToRead})"),true);
  for(let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started.length,1,"multiple MP3s must be scheduled as a single AudioBufferSource");
  assert.ok(sources[0].buffer.duration>.4,"one output contains all four clips");
  sources[0].onEnd();
  assert.equal(run("activeSpeechAudioRoute"),null);
});

test("iPhone画面復帰で一時停止したWeb Audioのみでもresumeする",async()=>{
  const {run,context}=app();
  let resumed=0;
  context.document.hidden=false;
  context.window.speechSynthesis.paused=false;
  context.navigator={audioSession:{type:"ambient"}};
  run("state.voiceEnabled=true;activeSpeechAudioRoute={context:{state:'suspended',resume(){return Promise.resolve();}}};");
  context.activeSpeechAudioRoute=null;
  run("resumePausedSpeechOnReturn()");
  assert.equal(run("Boolean(activeSpeechAudioRoute)"),true);
});
