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
      if (/録画YOLO|Recorded YOLO/i.test(source)) {
        return t("録画映像の情報です。現在の空き状況ではありません。", "Recorded footage; not current availability.");
      }
      if (/音声テスト・模擬|Voice test.*simulat/i.test(source)) {
        return t("音声確認中（空き状況は参考情報です）", "Voice preview (sample availability)");
      }
      if (/公開OFF|not published to users/i.test(source)) {
        return t("空き状況を確認できません。", "Parking availability is unavailable.");
      }
      if (/研究用として|this prototype randomly/i.test(source)) {
        return t("案内先を表示しています。", "Showing your parking space.");
      }
      if (/実際の空き情報ではありません|not live availability/i.test(source)) {
        return source.replace(/（実際の空き情報ではありません）/g, "（参考情報）")
          .replace(/\(not live availability\)/gi, "(sample data)");
      }
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
      if (/通信を確認できません|connection unavailable|status unavailable/i.test(source)) {
        return t("録画映像：通信を確認できません", "Recorded footage: connection unavailable");
      }
      if (/共有停止中|sharing is off/i.test(source)) {
        return t("録画映像：情報の更新を待っています", "Recorded footage: awaiting updates");
      }
      if (/未確認|unavailable|fresh results/i.test(source)) {
        return t("録画映像：新しい情報がありません", "Recorded footage: no recent updates");
      }
      if (/連携中|connected/i.test(source)) {
        return t("録画映像を再生中（現在の空きではありません）",
          "Playing recorded footage (not current availability)");
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
    const normalize = () => {
      const before = node.textContent || "";
      const after = formatStatus(before, kind);
      if (after !== before) node.textContent = after;
    };
    const observer = new MutationObserver(normalize);
    observer.observe(node, { childList: true, characterData: true, subtree: true });
    normalize();
  }

  function tidyFacilities() {
    const list = $("#facility-list");
    if (!list) return;
    list.querySelectorAll(".facility-action small").forEach((node) => {
      const after = formatStatus(node.textContent, "facility-source");
      if (after !== node.textContent) node.textContent = after;
    });
    list.querySelectorAll(".facility-status").forEach((node) => {
      // 施設名（実験用駐車場など）は維持し、開発用の説明だけ省略する。
      if (/研究|実験|模擬|YOLO|試作|プロトタイプ|音声テスト|録画実演|デモ/i.test(node.textContent || "")) {
        node.hidden = true;
      }
    });
  }

  function setupAudioCard(card) {
    // 読み上げ全文は「音声テスト用駐車場」でだけ確認する。
    // 通常の案内には再生状況と、停車中に使う聞き直しボタンだけ残す。
    const transcript = card.querySelector(".guidance-audio-message");
    transcript?.remove();
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

  const footer = $(".site-footer");
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
  document.querySelectorAll(".recorded-demo-link-status").forEach((panel) => {
    const normalize = () => {
      const value = panel.textContent;
      const next = formatStatus(value, "recorded");
      if (value !== next) panel.textContent = next;
    };
    new MutationObserver(normalize).observe(panel, { childList: true, characterData: true, subtree: true });
    normalize();
  });

  const screens = [...document.querySelectorAll("[data-screen]")];
  const updateScreen = () => {
    const current = screens.find((screen) => !screen.hidden)?.dataset.screen || "facility";
    document.body.dataset.guidanceScreen = current;
    // 音声確認用以外では全文の書き起こしを表示しない。
    document.querySelectorAll("#waiting-screen .guidance-audio-message, #result-screen .guidance-audio-message")
      .forEach((node) => node.remove());
  };
  screens.forEach((screen) => {
    new MutationObserver(updateScreen).observe(screen, { attributes: true, attributeFilter: ["hidden"] });
  });
  updateScreen();

  function updateLanguage() {
    document.title = t("駐車場空き区画案内", "Parking Space Guide");
    if (footer) {
      const intro = footer.querySelector(":scope > p");
      if (intro) intro.textContent = t(
        "駐車時は周囲の安全と現地の表示を優先してください。",
        "Follow on-site signs and prioritize safety when parking."
      );
      const summary = footer.querySelector(".app-about summary");
      if (summary) summary.textContent = t("ご利用上の注意・アプリについて", "Important information about this app");
    }
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