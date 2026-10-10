const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function app() {
  const nodes = new Map();
  function element() {
    return { value: '', checked: false, textContent: '', hidden: false, dataset: {},
      classList: { toggle() {} }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {},
      querySelector() { return null; }, replaceChildren() {}, reset() {} };
  }
  const document = { documentElement: { lang: 'ja' }, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }, querySelectorAll() { return []; } };
  const context = vm.createContext({ document, console, setTimeout, clearTimeout, AbortSignal, AbortController, URL, FACILITY_CATALOG: [],
    window: { PARKING_LAYOUTS: {}, PARKING_REMOTE_CONFIG: { enabled: true, supabaseUrl: 'https://example.test', publishableKey: 'sb_publishable_test' },
      addEventListener() {}, setTimeout, scrollTo() {}, history: { pushState() {} },
      speechSynthesis: { cancel() {}, speak() {} } },
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
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
    facilityId: 'a', objects: [{ uid: 'p', name: '001', objectType: 'parkingSpace', x: 0, y: 0, width: 6, height: 12 }],
  } }] });
  run(`state.selectedFacility = { id: 'a', name: 'test' }; state.currentScreen = 'result';
    state.voiceEnabled = false; saveSearchConditions = () => {}; renderParkingMap = () => {};`);
  await run('runSpaceSearch()');
  assert.match(nodes.get('#space-description').textContent, /入口が未登録/);
});

test('AudioSession対応ブラウザーでは音楽との混合再生を指定する', async () => {
  const { run, context } = app();
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
  assert.match(history[1].utterance.text, /駐車区画/);
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
