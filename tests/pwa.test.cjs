const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const scope = 'https://example.test/parking-guide-user/';

function worker({ saved, keys = [], failInstall = false } = {}) {
  const handlers = {};
  const added = [], deleted = [], fetched = [];
  let claimed = false, skipped = false;
  const cache = {
    async addAll(requests) { if (failInstall) throw new Error('missing asset'); added.push(...requests); },
    async match(request) { return saved; },
  };
  const context = vm.createContext({ URL, Request,
    self: { registration: { scope }, clients: { async claim() { claimed = true; } },
      async skipWaiting() { skipped = true; }, addEventListener(type, fn) { handlers[type] = fn; } },
    caches: { async open() { return cache; }, async keys() { return keys; }, async delete(key) { deleted.push(key); } },
    async fetch(request) { fetched.push(request); return 'network'; },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), context);
  function life(type, extra = {}) { let pending; handlers[type]({ ...extra, waitUntil(p) { pending = p; } }); return pending; }
  function request(url, mode = 'cors', method = 'GET') {
    let response;
    handlers.fetch({ request: { url, mode, method }, respondWith(p) { response = p; } });
    return response;
  }
  return { context, life, request, added, deleted, fetched, claimed: () => claimed, skipped: () => skipped };
}

test('初回はHTMLとその参照ファイルを全て保存し、勝手に更新版へ切り替えない', async () => {
  const w = worker(); await w.life('install');
  const urls = new Set(w.added.map((request) => request.url));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)) {
    const url = new URL(match[1], scope);
    assert.ok(urls.has(url.href), `保存対象に無い: ${match[1]}`);
    assert.ok(fs.existsSync(path.join(root, decodeURIComponent(url.pathname.slice(new URL(scope).pathname.length)))));
  }
  assert.equal(w.skipped(), false);
  assert.equal(w.added.every((request) => request.cache === 'reload'), true);
});

test('初回保存に失敗した場合はインストールを成功扱いしない', async () => {
  await assert.rejects(worker({ failInstall: true }).life('install'), /missing asset/);
});

test('削除するのはこのアプリの旧キャッシュだけ', async () => {
  const prefix = `parking-guide-user:${scope}:`;
  const current = vm.runInContext('CACHE_NAME', worker().context);
  const w = worker({ keys: [prefix+'old', current, 'admin-cache', 'parking-guide-user:https://example.test/another/:old'] });
  await w.life('activate');
  assert.deepEqual(w.deleted, [prefix+'old']);
  assert.equal(w.claimed(), true);
});

test('オフライン時もトップ画面・クエリー付きの起動・指定済みスクリプトを開ける', async () => {
  const w = worker({ saved: 'offline shell' });
  assert.equal(await w.request(scope, 'navigate'), 'offline shell');
  assert.equal(await w.request(scope+'index.html?from=home', 'navigate'), 'offline shell');
  assert.equal(await w.request(scope+'app.js?v=20261010-voice-diagnosis'), 'offline shell');
  assert.equal(w.fetched.length, 0);
});

test('管理API・外部音声・他アプリ・POST・未知URLには介入しない', () => {
  const w = worker({ saved: 'shell' });
  for (const url of ['https://project.supabase.co/rest/v1/parking_layouts', 'https://api.tts.quest/v3/voicevox/synthesis', 'https://example.test/parking-guide-admin/', scope+'unknown.js', scope+'unknown.html', scope+'app.js?future=1']) {
    assert.equal(w.request(url, url.endsWith('.html') ? 'navigate' : 'cors'), undefined);
  }
  assert.equal(w.request(scope, 'navigate', 'POST'), undefined);
});

test('端末がキャッシュを消した場合は通常の通信に戻る', async () => {
  const w = worker(); assert.equal(await w.request(scope, 'navigate'), 'network');
  assert.equal(w.fetched.length, 1);
});

test('更新適用は明示したメッセージだけで実行する', async () => {
  const w = worker(); await w.life('message', { data: { type: 'other' } });
  assert.equal(w.skipped(), false);
  await w.life('message', { data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(w.skipped(), true);
});

test('manifestの起動範囲とPNGアイコンがサブディレクトリ配信に対応する', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const field of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[field], scope).href, scope);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const data = fs.readFileSync(path.join(root, icon.src));
    assert.equal(data.subarray(1,4).toString(), 'PNG');
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(data.readUInt32BE(16), size);
    assert.equal(data.readUInt32BE(20), size);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

async function ui({ offline = false, secure = true, waiting = false, standalone = false } = {}) {
  const nodes = new Map();
  const listeners = {}, swListeners = {};
  let reloads = 0, posted;
  const registration = { active: {}, waiting: waiting ? { postMessage(message) { posted = message; } } : null,
    addEventListener() {}, async update() {} };
  const document = { documentElement: { lang: 'ja' }, addEventListener() {},
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, { hidden: false, textContent: '', addEventListener(type, fn) { this[type] = fn; } }); return nodes.get(selector); } };
  const context = vm.createContext({ document, navigator: { onLine: !offline,
    serviceWorker: { async register() { return registration; }, ready: Promise.resolve(registration), addEventListener(type, fn) { swListeners[type] = fn; } } },
    window: { isSecureContext: secure, matchMedia() { return { matches: standalone, addEventListener() {} }; },
      addEventListener(type, fn) { listeners[type] = fn; }, location: { reload() { reloads++; } } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'pwa.js'), 'utf8'), context);
  await Promise.resolve(); await Promise.resolve();
  return { nodes, context, document, listeners, swListeners, registration, reloads: () => reloads, posted: () => posted };
}

test('通信切断・再接続と英語表示を画面に反映する', async () => {
  const u = await ui({ offline: true });
  assert.equal(u.nodes.get('#pwa-offline-status').hidden, false);
  assert.match(u.nodes.get('#pwa-offline-status').textContent, /最新の管理データは取得できません/);
  u.document.documentElement.lang = 'en'; u.listeners['parking:languagechange']();
  assert.match(u.nodes.get('#pwa-offline-status').textContent, /You are offline/);
  u.context.navigator.onLine = true; u.listeners.online();
  assert.equal(u.nodes.get('#pwa-offline-status').hidden, true);
});

test('非対応環境はオフライン保存できたと表示しない', async () => {
  const u = await ui({ secure: false });
  assert.match(u.nodes.get('#pwa-install-status').textContent, /保存を利用できません/);
});

test('更新を検知しても自動再読み込みせず、押した画面だけを一度再読み込みする', async () => {
  const u = await ui({ waiting: true });
  assert.equal(u.nodes.get('#pwa-update-panel').hidden, false);
  u.swListeners.controllerchange(); assert.equal(u.reloads(), 0);
  u.nodes.get('#pwa-update-button').click();
  assert.equal(u.posted().type, 'ACTIVATE_UPDATE');
  u.swListeners.controllerchange(); u.swListeners.controllerchange();
  assert.equal(u.reloads(), 1);
});

test('ホーム画面起動と追加可能なブラウザーを区別する', async () => {
  const installed = await ui({ standalone: true });
  assert.match(installed.nodes.get('#pwa-title').textContent, /ホーム画面から起動/);
  assert.equal(installed.nodes.get('#pwa-install-instructions').hidden, true);
  const u = await ui();
  assert.equal(u.nodes.get('#pwa-install-button').hidden, true);
  let shown = 0;
  u.listeners.beforeinstallprompt({ preventDefault() {}, async prompt() { shown++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  assert.equal(u.nodes.get('#pwa-install-button').hidden, false);
  await u.nodes.get('#pwa-install-button').click();
  assert.equal(shown, 1);
  assert.equal(u.nodes.get('#pwa-install-button').hidden, true);
});
