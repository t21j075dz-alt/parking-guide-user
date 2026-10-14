/*
 * 利用者アプリの画面と同梱データだけを保存する。
 * 管理データ・位置情報・外部音声はキャッシュしない。
 * 配信ファイルを変更するときはVERSIONとSHELL_FILESを一緒に更新する。
 */
const VERSION = "20261013-editor-1";
// 同じgithub.io上の管理アプリや別のパスのキャッシュを削除しない。
const CACHE_PREFIX = `parking-guide-user:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=20261011-launch-splash",
  "./map-display.css?v=20261013-editor",
  "./map-display.js?v=20261013-editor",
  "./location-safety.js",
  "./facilities.js?v=20261011-fukuoka-100",
  "./sync-config.js",
  "./parking-layouts.js",
  "./speech-readings.js?v=20261011-fukuoka-100",
  "./app.js?v=20261013-editor",
  "./pwa.js?v=20261010-pwa",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];
const SHELL_URLS = new Set(SHELL_FILES.map((file) => new URL(file, self.registration.scope).href));

self.addEventListener("install", (event) => {
  // 全ファイルが揃った版だけを使う。既存画面は操作中に強制更新しない。
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    SHELL_FILES.map((file) => new Request(new URL(file, self.registration.scope), { cache: "reload" })),
  )));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  // トップ画面だけをオフラインで再表示する。未登録のURLやAPIを画面へ置換しない。
  const isEntry = request.mode === "navigate"
    && (url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`);
  if (!isEntry && !SHELL_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(isEntry ? new URL("./", scope).href : request);
    if (saved) return saved;
    // OSが保存データを消した場合は通常の通信に戻す。
    return fetch(request);
  })());
});
