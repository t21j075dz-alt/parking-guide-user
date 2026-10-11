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

test('音声ファイル方式は初期状態では無効で、同意前に外部APIへアクセスしない', () => {
  const { run } = app();
  assert.equal(run('state.cloudVoiceEnabled'), false);
  assert.equal(run("isTrustedVoiceAudioUrl('https://evil.test/sample.mp3')"), false);
  assert.equal(run("isTrustedVoiceAudioUrl('https://audio2.tts.quest/v1/data/a12b3c/audio.mp3')"), true);
  assert.equal(run("isTrustedVoiceAudioUrl('https://audio2.tts.quest.evil.test/v1/data/a12b3c/audio.mp3')"), false);
});

test('同意後は日本語案内をWeb Audioへ流し、通常の端末読み上げを使わない', async () => {
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
  context.fetch = async (url) => {
    if (url.startsWith('https://api.tts.quest/')) {
      submittedText = new URL(url).searchParams.get('text');
      return { ok: true, json: async () => ({
        success: true,
        audioStatusUrl: 'https://audio2.tts.quest/v1/data/a12b3c/status.json',
        mp3DownloadUrl: 'https://audio2.tts.quest/v1/data/a12b3c/audio.mp3',
      }) };
    }
    if (url.endsWith('status.json')) return { ok: true, json: async () => ({ isAudioReady: true }) };
    if (url.endsWith('audio.mp3')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    throw new Error('unexpected URL ' + url);
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

test('外部VOICEVOX接続エラーが画面に出て、端末の音声へ戻る', async () => {
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
  context.fetch = async () => ({ ok: false, status: 429 });
  run('state.cloudVoiceEnabled = true');
  assert.equal(run("speakText('診断音声', {preview: true})"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(nodes.get('#cloud-voice-diagnostic').textContent, /429/);
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

test('全212施設に独立した日本語読み仮名があり、難読名を正しい読みで保持する', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../facilities.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../speech-readings.js'), 'utf8'), context);
  assert.equal(vm.runInContext('Object.keys(window.PARKING_SPEECH_READINGS).length', context), 212);
  assert.equal(vm.runInContext('FACILITY_CATALOG.every(f => /^[ぁ-ゖー、 ]+$/.test(window.PARKING_SPEECH_READINGS[f.id]))', context), true);
  for (const [id, reading] of Object.entries({target_024:'まるなか よしだてん',target_034:'みすたーまっくす はちほんまつてん',target_073:'みちのえき そのぎのしょう',target_098:'まるきょう みなはるてん',target_107:'とらいある みやこのじょうとほくてん',target_111:'はんずまん うすきてん',target_118:'とらいある いずみこがねてん'})) {
    assert.equal(context.window.PARKING_SPEECH_READINGS[id], reading);
  }
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

test('実際のユーザーレンダラーは全21種類・全駐車線形式と標識を表示し、案内番号を二重表示しない',()=>{const {run,nodes}=app();run(`const fixtureObjects=mapDisplay.types.map((objectType,i)=>({uid:'o'+i,objectType,name:'名称',spaceNumber:'001',spaceGroup:'A',spaceGroupKind:'area',spaceType:'ev',markingStyle:'photoStall',routeNumber:'123',signType:'stop',publicAccess:true,status:'available',x:30*(i%6),y:30*Math.floor(i/6),width:25,height:25}));const parkingFixture=fixtureObjects.find(o=>o.objectType==='parkingSpace');const fixtureLayout={facilityId:'a',objects:fixtureObjects};const recommendedFixture={uid:parkingFixture.uid,id:'A区画 1',sourceObject:parkingFixture};state.guideEntrance=fixtureObjects.find(o=>o.objectType==='buildingEntrance');calculateGuidanceViewport=()=>({x:0,y:0,width:360,height:400,scale:1});renderRegisteredLayout(fixtureLayout,recommendedFixture);`);const map=nodes.get('#parking-map');const objects=map.children.filter(n=>n.dataset.objectType);assert.equal(objects.length,21);const parking=objects.find(n=>n.dataset.objectType==='parkingSpace');assert.equal(walk(parking).filter(n=>n.className==='space-number-mark').length,0);assert.equal(walk(map).filter(n=>n.tagName==='strong'&&n.textContent==='A区画 1').length,1);assert.ok(objects.find(n=>n.dataset.objectType==='building').children.some(n=>n.className==='map-object-label'));assert.equal(objects.find(n=>n.dataset.objectType==='roadSign').children.length,1);run(`fixtureLayout.objects=mapDisplay.markingStyles.map((markingStyle,i)=>({...parkingFixture,uid:'p'+i,markingStyle,spaceNumber:String(i+1)}));state.guideEntrance=null;renderRegisteredLayout(fixtureLayout,null);`);assert.equal(map.children.length,12);for(let i=0;i<12;i++)assert.equal(walk(map.children[i]).filter(n=>n.tagName==='path').length,i===11?0:1);});
test('検索結果・音声・マップの区画番号に同じ列名とゼロを除いた番号を使う',()=>{const {run}=app();run(`const groupedItem={uid:'p',objectType:'parkingSpace',name:'普通車 001',spaceNumber:'001',spaceGroup:'A',spaceGroupKind:'row',status:'available',x:10,y:10,width:25,height:50};const groupedSpace=createLayoutParkingSpaces({objects:[groupedItem]},{id:'a'})[0];`);assert.equal(run('groupedSpace.id'),'A列 1');assert.match(run('getSpokenSpaceId(groupedSpace)'),/えー.*れつ.*いち/);assert.equal(run("getSpokenSpaceId(groupedSpace,'en-US')"),'A列 1');});

function loadFacilityCatalog() {
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../facilities.js'),'utf8'),context);
  return JSON.parse(vm.runInContext('JSON.stringify(FACILITY_CATALOG)',context));
}

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
