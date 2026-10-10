/*
 * PWAの追加案内と更新操作。施設検索や音声案内には介入しない。
 * iOSの追加はSafariの共有メニューを使う。対応端末だけ追加ボタンを表示する。
 */
(() => {
  const help = document.querySelector("#pwa-install-help");
  const title = document.querySelector("#pwa-title");
  const instructions = document.querySelector("#pwa-install-instructions");
  const androidInstructions = document.querySelector("#pwa-android-instructions");
  const installButton = document.querySelector("#pwa-install-button");
  const installStatus = document.querySelector("#pwa-install-status");
  const offlineStatus = document.querySelector("#pwa-offline-status");
  const updatePanel = document.querySelector("#pwa-update-panel");
  const updateStatus = document.querySelector("#pwa-update-status");
  const updateButton = document.querySelector("#pwa-update-button");
  const displayMode = window.matchMedia("(display-mode: standalone)");
  let installPrompt = null;
  let registration = null;
  let reloadRequested = false;
  let registrationState = "pending";
  const english = () => document.documentElement.lang === "en";
  const label = (ja, en) => english() ? en : ja;

  function render() {
    const standalone = displayMode.matches || navigator.standalone === true;
    title.textContent = standalone
      ? label("ホーム画面から起動しています", "Opened from the Home Screen")
      : label("ホーム画面に追加して使う", "Add to your Home Screen");
    instructions.textContent = label(
      "iPhone・iPad：Safariでこのページを開き、共有メニューから「ホーム画面に追加」を選びます。「Webアプリとして開く」が表示された場合はオンにして追加してください。",
      "iPhone / iPad: Open this page in Safari, use Share and choose Add to Home Screen. Turn on Open as Web App if shown, then add it.",
    );
    androidInstructions.textContent = label(
      "Android：Chromeのメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。",
      "Android: Choose Install app or Add to Home screen in the Chrome menu.",
    );
    instructions.hidden = standalone;
    androidInstructions.hidden = standalone;
    installButton.textContent = label("アプリを追加", "Install app");
    installButton.hidden = standalone || !installPrompt;
    installStatus.textContent = registrationState === "ready"
      ? label("基本画面を保存しました。通信できないときも、この端末で開けます。", "The basic screens are saved and can open offline on this device.")
      : registrationState === "unavailable"
        ? label("この環境では基本画面の保存を利用できません。通信できる状態で使用してください。", "Offline storage is unavailable here. Use the app with an internet connection.")
        : label("基本画面の保存を準備しています。初回は通信できる状態で開いてください。", "Preparing offline storage. Open the app online the first time.");
    offlineStatus.hidden = navigator.onLine !== false;
    offlineStatus.textContent = label(
      "オフラインです。最新の管理データは取得できません。同梱データ・取得済みデータまたは研究用シミュレーションを表示します。外部音声は利用できません。",
      "You are offline. The latest managed data cannot be fetched. Bundled or previously loaded data, or research simulations, will be shown. External speech is unavailable.",
    );
    updatePanel.hidden = !registration?.waiting || reloadRequested;
    updateStatus.textContent = label("新しいバージョンがあります。停車中に更新してください。", "An update is available. Update while parked.");
    updateButton.textContent = label("更新して再読み込み", "Update and reload");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    render();
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    render();
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // 拒否・取り消し・ブラウザー差異では、共有メニューの手順を残す。
    }
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    help.open = false;
    render();
  });
  displayMode.addEventListener?.("change", render);
  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  window.addEventListener("parking:languagechange", render);

  updateButton.addEventListener("click", () => {
    if (!registration?.waiting) return;
    // クリックした画面だけを再読み込みする。他の端末・タブの案内は中断しない。
    reloadRequested = true;
    registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    render();
  });

  async function register() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      registrationState = "unavailable";
      render();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadRequested) {
        reloadRequested = false;
        window.location.reload();
      }
    });
    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./", updateViaCache: "none",
      });
      function watchInstalling(worker) {
        worker?.addEventListener("statechange", () => {
          if (worker.state === "redundant" && !registration.active) registrationState = "unavailable";
          render();
        });
      }
      registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
      // registerが返る前にインストールが始まっていた場合も失敗を確認する。
      watchInstalling(registration.installing);
      render();
      await navigator.serviceWorker.ready;
      registrationState = "ready";
      render();
      // 長く開いた画面でも、復帰時に更新を確認する。更新適用は利用者の操作を待つ。
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && navigator.onLine !== false) {
          registration.update().catch(() => {});
        }
      });
    } catch {
      registrationState = "unavailable";
      render();
    }
  }

  render();
  register();
})();
