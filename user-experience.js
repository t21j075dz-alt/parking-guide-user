"use strict";

/**
 * 利用者画面の表示整理。
 * 既存の検索・音声・安全制御・地図の処理には手を加えず、
 * 情報の並びと文章の見せ方だけを整える。
 */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const english = () => document.documentElement.lang === "en";
  const t = (ja, en) => english() ? en : ja;
  const hide = (selector) => { const node = $(selector); if (node) node.hidden = true; };

  // 録画・シミュレーションを現在の空き情報と誤認しないよう、出所を短く明示する。
  function formatStatus(value, kind) {
    const source = String(value || "").trim();
    if (!source) return source;
    const en = english();
    if (kind === "facility-source") {
      if (/録画|Recorded/i.test(source)) return t("録画", "Recorded");
      if (/デモ|Demo/i.test(source)) return t("参考情報", "Sample data");
      if (/登録データ|Saved data/i.test(source)) return t("登録情報", "Saved data");
      return source;
    }
    if (kind === "result-status") {
      // 古い画面や保存状態から出た説明も、現在の状況と誤解されない短文に統一する。
      if (/録画YOLO|Recorded YOLO|録画映像を逐次|YOLO replay/i.test(source))
        return t("録画の結果です。現在の空き状況は未確認です。",
          "Recorded results. Current availability is unknown.");
      if (/音声テスト・模擬|Voice test.*simulat/i.test(source))
        return t("音声確認用です。実際の空き状況ではありません。",
          "Voice preview. This is not current availability.");
      if (/公開OFF|not published to users|カメラ空き情報|administrator app/i.test(source))
        return t("現在の空き状況を確認できません。",
          "Current availability cannot be checked.");
      if (/研究用として|this prototype randomly/i.test(source))
        return t("参考情報を表示しています。現地でご確認ください。",
          "Showing sample data. Check on-site.");
      return source;
    }
    if (kind === "no-space") {
      if (/管理者アプリ|YOLOの判定結果|Camera status sharing is disabled/i.test(source)) {
        return t("現在の空き状況を確認できません。時間をおいて再度ご確認ください。",
          "Current availability is unavailable. Please try again later.");
      }
      if (/録画の研究用|recorded research facility/i.test(source)) {
        return t("録画映像では、現在の空き状況を確認できません。",
          "Recorded footage cannot confirm current availability.");
      }
      if (/現地で空車確認|camera calibration/i.test(source)) {
        return t("確認できない区画があります。現地の表示をご確認ください。",
          "Some spaces are unverified. Follow on-site signs.");
      }
      if (/デモでは満車|The demo parking lot is full/i.test(source)) {
        return t("参考情報では満車です。再探索すると情報が更新されます。",
          "Sample data shows full occupancy. Try searching again.");
      }
      return source;
    }
    if (kind === "recorded") {
      if (/通信|connection unavailable|status unavailable/i.test(source))
        return t("録画を確認できません。現在の空きは未確認です。",
          "Recording unavailable. Current availability is unknown.");
      if (/共有停止|sharing is off/i.test(source))
        return t("録画の更新を待っています。現在の空きは未確認です。",
          "Waiting for recorded data. Current availability is unknown.");
      if (/未確認|unavailable|fresh results/i.test(source))
        return t("録画の情報を確認中です。現在の空きは未確認です。",
          "Checking recorded data. Current availability is unknown.");
      if (/連携中|connected/i.test(source))
        return t("録画データを表示中です。現在の空きではありません。",
          "Showing recorded data, not current availability.");
      return source;
    }
    if (kind === "pwa") {
      if (/研究用シミュレーション|research simulations|管理データ|managed data/i.test(source)) {
        return t("オフラインです。最新の空き状況を確認できません。", 
          "You are offline. Current parking availability cannot be confirmed.");
      }
      return source;
    }
    if (kind === "location") {
      return en
        ? source.replace(/test location/gi, "saved location").replace(/test point/gi, "saved location")
        : source.replace(/テスト地点/g, "登録地点").replace(/実験地点/g, "登録地点");
    }
    if (kind === "voice-test") {
      return source.replace(/（模擬）/g, "").replace(/（研究用）/g, "")
        .replace(/\(simulated\)/gi, "").replace(/\(research\)/gi, "").trim();
    }
    if (kind === "space-description") {
      return source.replace(/\s*[·・]\s*デモ/g, "").replace(/\s*[·・]\s*Demo/gi, "");
    }
    return source;
  }

  // 頻繁に更新される文言だけを監視。車両判定や通信処理には介入しない。
  function watchText(selector, kind) {
    const node = $(selector);
    if (!node) return;
      const before = node.textContent || "";
      const after = formatStatus(before, kind);
      if (after !== before) node.textContent = after;
    const observer = new MutationObserver(normalize);
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  }

  function tidyFacilities() {
    const list = $("#facility-list");
    if (!list) return;
    list.querySelectorAll(".facility-action small").forEach((node) => {
      const after = formatStatus(node.textContent, "facility-source");
      if (after !== node.textContent) node.textContent = after;
    });
    list.querySelectorAll(".facility-status").forEach((node) => {
      // 案内に必要な注意まで非表示にせず、技術的な説明だけ平易にする。
      if (/YOLO|プロトタイプ|録画実演|研究用として/i.test(node.textContent || "")) {
        node.textContent = t("参考情報です。現在の空きは現地でご確認ください。",
          "Sample information. Check current availability on-site.");
      }
    });
  }

  function setupAudioCard(card) {
    // 案内文は常時表示し、聞き直す操作だけを折りたたむ。

    const replay = card.querySelector(".guidance-audio-replay");
    if (!replay) return;
    let details = card.querySelector(".guidance-replay-details");
    if (!details) {
      details = document.createElement("details");
      details.className = "guidance-replay-details";
      const summary = document.createElement("summary");
      summary.textContent = t("音声の聞き直し", "Replay guidance");
      details.append(summary);
      card.append(details);
    }
    replay.textContent = t("案内をもう一度聞く", "Play guidance again");
    details.append(replay);
    const note = document.createElement("p");
    note.className = "guidance-replay-note";
    note.textContent = t("停車してから操作してください。", "Only use while safely parked.");
    details.append(note);
  }

  // 施設選択・条件選択・待機・結果・駐車完了・音声確認の見出しを共通化する。
  const pageHeadings = [
    ["#facility-title", "行き先を選ぶ", "Choose a destination"],
    ["#condition-title", "駐車区画の条件を選ぶ", "Choose a parking space"],
    ["#waiting-title", "施設に近づくと案内します", "Guidance starts near your destination"],
    ["#parked-title", "駐車位置を保存しました", "Parking location saved"],
    ["#voice-test-title", "音声案内の確認", "Voice guidance preview"],
    ["#voice-test-complete-title", "音声の確認が終わりました", "Voice preview complete"],
  ];
  const applyHeadings = () => pageHeadings.forEach(([selector, ja, en]) => {
    const heading = $(selector);
    if (heading) heading.textContent = t(ja, en);
  applyHeadings();

  // 写真は確認したいときだけ開く。撮影画像の取得や安全判定は変更しない。
  const cameraPanel = $("#facility-camera");
  if (cameraPanel && !cameraPanel.parentElement?.classList.contains("optional-photo-details")) {
    const details = document.createElement("details");
    details.className = "optional-photo-details";
    const summary = document.createElement("summary");
    summary.textContent = t("駐車場の写真を見る", "View parking photos");
    cameraPanel.before(details);
    details.append(summary, cameraPanel);
  }

  const footer = $(".site-footer");
  const controls = $(".display-controls");
  if (controls) {
    const menu = document.createElement("details");
    menu.className = "display-menu";
    const summary = document.createElement("summary");
    summary.textContent = t("表示設定", "Display settings");
    controls.replaceWith(menu);
    menu.append(summary, controls);
  }
  if (footer) {
    const location = $(".location-panel");
    if (location) {
      const settings = document.createElement("details");
      settings.className = "location-settings";
      const summary = document.createElement("summary");
      summary.textContent = t("現在地・位置情報の設定", "Location settings");
      settings.append(summary, location);
      footer.append(settings);
    }
    const key = $(".availability-key");
    if (key) footer.querySelector(".app-about")?.append(key);
  }

  if (footer) {
    const footerIntro = footer.querySelector(":scope > p");
    if (footerIntro) footerIntro.textContent = t(
      "駐車時は周囲の安全と現地の表示を優先してください。",
      "Follow on-site signs and prioritize safety when parking."
    );
    const about = footer.querySelector(".app-about");
    if (about) {
      const summary = about.querySelector("summary");
      if (summary) summary.textContent = t("ご利用上の注意・アプリについて", "Important information about this app");
    }
    // インストール手順・更新情報は案内画面の上部に常駐させない。
    const pwa = $(".pwa-panel");
    if (pwa) footer.append(pwa);
  }

  $(".launch-note")?.remove();
  $(".research-note")?.remove();
  hide("#random-guidance-note");
  hide("#waiting-google-maps-note");
  hide("#voice-test-screen .safety-note");
  // 「再探索」が古い結果を更新する操作だと分かるようにする。
  ["#retry-button", "#no-space-retry"].forEach((selector) => {
    const button = $(selector);
    if (button) button.textContent = t("もう一度探す", "Search again");
  });
  const findNow = $("#search-now-button");
  if (findNow) findNow.textContent = t("今すぐ空きを探す", "Find parking now");

  const positionPanel = $("#private-test-location-panel");
  if (positionPanel) {
    const heading = $("#private-test-location-title");
    if (heading) heading.textContent = t("登録地点", "Saved location");
    const explainer = positionPanel.querySelector("p:not([id])");
    if (explainer) explainer.textContent = t(
      "この端末の現在地を、案内に使用する地点として登録できます。",
      "Save your current location as the destination for this device."
    );
    const save = $("#save-private-test-location-button");
    if (save) save.textContent = t("現在地を登録", "Save current location");
    const clear = $("#clear-private-test-location-button");
    if (clear) clear.textContent = t("登録地点を削除", "Remove saved location");
  }

  const arrivalNote = $("#parking-arrival-panel .muted");
  if (arrivalNote) arrivalNote.textContent = t(
    "車両を確認できたら、安全に停車してからお答えください。",
    "If a vehicle is detected, stop safely before confirming."
  );

  const title = $("#result-title");
  if (title) title.textContent = t("駐車区画のご案内", "Parking guidance");
  const result = $("#result-content");
  const hero = $("#result-screen .result-summary");
  if (result && hero) {
    result.prepend(hero);
    // 番号の前に音声カードが並ばないよう、結果内の番号直後へ移す。
    const audioCard = $("#result-screen > .guidance-audio-card");
    if (audioCard) hero.insertAdjacentElement("afterend", audioCard);
    // 停車検知は音声設定より優先し、区画番号の直後に表示する。
    const arrivalPanel = $("#parking-arrival-panel");
    if (arrivalPanel) hero.insertAdjacentElement("afterend", arrivalPanel);
    hero.classList.add("guidance-hero");
    const label = hero.querySelector(".result-label");
    if (label) label.textContent = t("ご案内する駐車区画", "Your parking space");
  }

  document.querySelectorAll("#waiting-screen .guidance-audio-card, #result-screen .guidance-audio-card")
    .forEach(setupAudioCard);

  const advancedCategory = $('#voice-test-category option[value="advanced"]');
  if (advancedCategory) advancedCategory.textContent = t("入口・経路案内", "Entrance and route guidance");
  const testGroup = $("#voice-test-group");
  if (testGroup) testGroup.textContent = t("音声案内の確認", "Guidance preview");
  const launchNote = $("#voice-test-launch > p:not([id])");
  if (launchNote) launchNote.textContent = t(
    "案内が終わると次の音声へ自動で進みます。",
    "The next voice sample plays automatically."
  );
  hide("#voice-test-launch > p.muted");

  // 開発環境の説明を一般向けのエラー表現に統一する。
  [
    ["#search-status", "result-status"],
    ["#no-space-description", "no-space"],
    ["#space-description", "space-description"],
    ["#private-test-location-status", "location"],
    ["#voice-test-group", "voice-test"],
    ["#pwa-offline-status", "pwa"],
  ].forEach(([selector, kind]) => watchText(selector, kind));
  const list = $("#facility-list");
  if (list) {
    new MutationObserver(tidyFacilities).observe(list, { childList: true, subtree: true });
    tidyFacilities();
  }
    const normalize = () => {
    };
    normalize();
  });

  const screens = [...document.querySelectorAll("[data-screen]")];
  const updateScreen = () => {
    const current = screens.find((screen) => !screen.hidden)?.dataset.screen || "facility";
    document.body.dataset.guidanceScreen = current;

  };
  screens.forEach((screen) => {
    new MutationObserver(updateScreen).observe(screen, { attributes: true, attributeFilter: ["hidden"] });
  });
  updateScreen();

  function updateLanguage() {
    document.title = t("駐車場空き区画案内", "Parking Space Guide");
    applyHeadings();
    const photoSummary = $(".optional-photo-details > summary");
    if (photoSummary) photoSummary.textContent = t("駐車場の写真を見る", "View parking photos");
    ["#retry-button", "#no-space-retry"].forEach((selector) => {
      const button = $(selector);
      if (button) button.textContent = t("もう一度探す", "Search again");
    });
    const findNow = $("#search-now-button");
    if (findNow) findNow.textContent = t("今すぐ空きを探す", "Find parking now");
    if (footer) {
      const intro = footer.querySelector(":scope > p");
      if (intro) intro.textContent = t(
        "駐車時は周囲の安全と現地の表示を優先してください。",
        "Follow on-site signs and prioritize safety when parking."
      );
      const summary = footer.querySelector(".app-about summary");
      if (summary) summary.textContent = t("ご利用上の注意・アプリについて", "Important information about this app");
    }
    const displaySummary = $(".display-menu > summary");
    if (displaySummary) displaySummary.textContent = t("表示設定", "Display settings");
    const locationSummary = $(".location-settings > summary");
    if (locationSummary) locationSummary.textContent = t("現在地・位置情報の設定", "Location settings");
    if (title) title.textContent = t("駐車区画のご案内", "Parking guidance");
    if (hero) {
      const label = hero.querySelector(".result-label");
      if (label) label.textContent = t("ご案内する駐車区画", "Your parking space");
    }
    document.querySelectorAll(".guidance-replay-details").forEach((details) => {
      details.querySelector("summary").textContent = t("音声の聞き直し", "Replay guidance");
      const replay = details.querySelector("button");
      if (replay) replay.textContent = t("案内をもう一度聞く", "Play guidance again");
      const note = details.querySelector(".guidance-replay-note");
      if (note) note.textContent = t("停車してから操作してください。", "Only use while safely parked.");
    });
    if (advancedCategory) advancedCategory.textContent = t("入口・経路案内", "Entrance and route guidance");
    if (positionPanel) {
      const heading = $("#private-test-location-title");
      if (heading) heading.textContent = t("登録地点", "Saved location");
    }
    tidyFacilities();
  }
  window.addEventListener("parking:languagechange", updateLanguage);
  updateLanguage();
})();