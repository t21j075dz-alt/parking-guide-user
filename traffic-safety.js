"use strict";
/**
 * 現地で確認済みの交通案内 + カメラによる歩行者/自転車の増加警告。
 * stale/未公開/録画/未検出を「安全」とみなさない。個人画像やIDは取得しない。
 */
window.ParkingTrafficSafety = (() => {
  const idPrefix = "parking-traffic-safety-";
  const eligibleScreens = new Set(["condition", "waiting", "result"]);
  const liveScreens = new Set(["waiting", "result"]);
  const spokenStatic = new Set();
  let live = { pedestrian: false, bicycle: false, known: false };
  let spokenHazard = { key: "", at: 0 };
  let lastContextKey = "";
  let requestNumber = 0;

  function context() {
    return window.ParkingTrafficSafetyContext?.() || {};
  }
  function currentAdvisories(ctx = context()) {
    const facility = ctx.facility;
    if (!facility) return [];
    const layoutId = facility.layoutId || facility.id;
    const layout = window.PARKING_LAYOUTS?.[layoutId];
    if (!layout || layout.facilityId !== layoutId) return [];
    const items = Array.isArray(layout.safetyAdvisories) ? layout.safetyAdvisories : [];
    return items.filter(item =>
      item && item.enabled === true && item.verified === true
      && typeof item.message === "string" && item.message.trim().length > 0
      && item.message.trim().length <= 180
      && (!item.destinationId || item.destinationId === ctx.destinationId)
    ).slice(0, 12);
  }
  function takeStaticWarnings(stage) {
    const ctx = context();
    if (!ctx.facility || ctx.voiceEnabled !== true || !eligibleScreens.has(ctx.screen)) return [];
    const warnings = currentAdvisories(ctx).filter(item =>
      (item.stage === "onsite" ? "onsite" : "approach") === stage);
    const unique = [];
    for (const item of warnings) {
      const token = [ctx.facility.id, ctx.destinationId, stage, item.id, item.message].join("|");
      if (spokenStatic.has(token)) continue;
      spokenStatic.add(token);
      unique.push(item.message.trim());
    }
    return unique;
  }
  function createPanel(screen, type) {
    const screenElement = document.getElementById(screen + "-screen");
    if (!screenElement) return null;
    let element = document.getElementById(idPrefix + screen + "-" + type);
    if (element) return element;
    element = document.createElement("aside");
    element.id = idPrefix + screen + "-" + type;
    element.className = "traffic-safety-notice";
    element.hidden = true;
    element.setAttribute("role", "note");
    if (type === "live") element.setAttribute("aria-live", "polite");
    const heading = document.createElement("strong");
    heading.className = "traffic-safety-notice-title";
    heading.textContent = type === "live" ? "周囲の安全にご注意ください" : "来店時の注意";
    const messages = document.createElement("ul");
    messages.className = "traffic-safety-notice-list";
    element.append(heading, messages);
    const anchor = screenElement.querySelector(".screen-heading") || screenElement.firstElementChild;
    if (anchor) anchor.after(element); else screenElement.prepend(element);
    return element;
  }
  function setMessages(node, messages) {
    if (!node) return;
    node.hidden = !messages.length;
    const list = node.querySelector(".traffic-safety-notice-list");
    if (!list) return;
    list.replaceChildren(...messages.map(message => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    }));
  }
  function liveMessages() {
    if (!live.known) return [];
    if (live.pedestrian && live.bicycle) return [
      "歩行者と自転車が多くなっています。徐行し、周囲をご確認ください。",
    ];
    if (live.pedestrian) return [
      "歩行者が多くなっています。徐行し、周囲をご確認ください。",
    ];
    if (live.bicycle) return [
      "自転車が多くなっています。徐行し、周囲をご確認ください。",
    ];
    return [];
  }
  function render() {
    const ctx = context();
    const key = [ctx.facility?.id || "", ctx.destinationId].join("|");
    if (key !== lastContextKey) {
      lastContextKey = key;
      live = { pedestrian:false, bicycle:false, known:false };
      spokenHazard = { key:"", at:0 };
      requestNumber += 1; // 施設切替前の非同期応答を破棄
      // 音声案内を開始する直前の施設変更にのみ未読扱いへ戻す。
      spokenStatic.clear();
    }
    for (const screen of eligibleScreens) {
      const info = createPanel(screen, "static");
      const staticMessages = screen === "result"
        ? currentAdvisories(ctx).map(a => a.message.trim())
        : currentAdvisories(ctx).filter(a => a.stage !== "onsite").map(a => a.message.trim());
      setMessages(info, [...new Set(staticMessages)]);
      if (liveScreens.has(screen)) {
        const dynamic = createPanel(screen, "live");
        setMessages(dynamic, ctx.screen === screen ? liveMessages() : []);
      }
    }
  }
  function toHazards(rows, now = Date.now()) {
    if (!Array.isArray(rows)) return { known:false, pedestrian:false, bicycle:false };
    const current = rows.filter(row => {
      const ms = Date.parse(row?.checked_at || "");
      return Number.isFinite(ms) && ms <= now + 5000 && now - ms >= -5000
        && now - ms <= 20000;
    });
    // 監視範囲に関係するカメラに警告が出た場合のみ、集計をONにする。
    return {
      known: current.length > 0,
      pedestrian: current.some(row => row.pedestrian_warning === true),
      bicycle: current.some(row => row.bicycle_warning === true),
    };
  }
  function maybeSpeak() {
    const ctx = context();
    if (!liveScreens.has(ctx.screen) || !ctx.voiceEnabled || ctx.speaking || document.hidden) return;
    const messages = liveMessages();
    const message = messages[0];
    if (!message) return;
    const key = [ctx.facility?.id, live.pedestrian, live.bicycle].join("|");
    const now = Date.now();
    if (spokenHazard.key === key && now - spokenHazard.at < 120000) return;
    if (ctx.speak?.(message)) spokenHazard = { key, at: now };
  }
  async function fetchLive() {
    const ctx = context();
    const cfg = window.PARKING_REMOTE_CONFIG || {};
    if (!ctx.facility?.id || !liveScreens.has(ctx.screen)
        || cfg.enabled !== true || !/^https:\/\//.test(cfg.supabaseUrl || "")
        || !cfg.publishableKey) {
      live = { known:false, pedestrian:false, bicycle:false };
      render();
      return;
    }
    const facilityId = ctx.facility.id;
    const generation = ++requestNumber;
    try {
      const url = String(cfg.supabaseUrl).replace(/\/$/, "")
        + "/rest/v1/parking_safety_live?facility_id=eq."
        + encodeURIComponent(facilityId)
        + "&select=checked_at,pedestrian_warning,bicycle_warning";
      const response = await fetch(url, {
        headers: { apikey:cfg.publishableKey },
        cache:"no-store", signal:AbortSignal.timeout(8500),
      });
      if (generation !== requestNumber || context().facility?.id !== facilityId) return;
      if (!response.ok) throw Error("safety status unavailable");
      live = toHazards(await response.json());
    } catch {
      if (generation !== requestNumber) return;
      live = { known:false, pedestrian:false, bicycle:false };
    }
    render();
    maybeSpeak();
  }
  function refresh() {
    render();
    void fetchLive();
  }
  // ナビゲーションと施設選択はアプリ本体から通知される。
  // 通信がなくても現地確認済みの静的注意は引き続き表示する。
  const initialize = () => {
    render();
    refresh();
    window.setInterval(() => {
      if (!document.hidden && liveScreens.has(context().screen)) void fetchLive();
    }, 10000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
  return Object.freeze({ refresh, render, takeStaticWarnings, currentAdvisories, toHazards });
})();
