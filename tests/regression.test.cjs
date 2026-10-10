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
  const context = vm.createContext({ document, console, setTimeout, clearTimeout, AbortSignal, FACILITY_CATALOG: [],
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
