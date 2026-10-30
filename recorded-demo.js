"use strict";
// この画面は録画の過去データだけを再生する。ライブテーブルや通常の案内には触れない。
(() => {
  const VALID = ["unknown", "available", "occupied", "blocked"];
  const NAMES = ["未確認", "空き", "駐車中", "障害物あり"];
  const MAX_EVENTS = 4000;
  const RECORDING_FACILITIES = Object.freeze({
    "home-test-001": "実験用駐車場（自宅駐車場リアルタイム用）",
    "home-video-demo-001": "実験用駐車場（自宅駐車場録画用）",
    "nikko-test-001": "道の駅日光（日光街道ニコニコ本陣）",
  });
  const qs = selector => document.querySelector(selector);
  let payload, current = 0, previousTick = 0, timer = null;

  function fail(message) {
    const error = qs("#error");
    error.textContent = message;
    error.hidden = false;
  }
  function fromHash() {
    if (!location.hash.startsWith("#recorded=") || location.hash.length > 120000) {
      throw new Error("有効な録画デモのリンクが指定されていません。");
    }
    let data;
    try {
      data = JSON.parse(decodeURIComponent(location.hash.slice("#recorded=".length)));
    } catch {
      throw new Error("リンク内の録画データを読み取れません。");
    }
    if (data?.version !== 1 ||
        !Object.prototype.hasOwnProperty.call(RECORDING_FACILITIES, data.facility_id) ||
        typeof data.duration !== "number" || !Number.isFinite(data.duration) ||
        data.duration <= 0 || data.duration > 86400 ||
        !Array.isArray(data.spaces) || !data.spaces.length || data.spaces.length > 100 ||
        !data.spaces.every(s => typeof s === "string" && /^space_[A-Za-z0-9_-]{1,40}$/.test(s)) ||
        new Set(data.spaces).size !== data.spaces.length ||
        !Array.isArray(data.events) || data.events.length > MAX_EVENTS) {
      throw new Error("録画の施設ID・区画・記録形式が正しくありません。");
    }
    let previous = -1;
    for (const event of data.events) {
      if (!Array.isArray(event) || event.length !== 3 ||
          !Number.isFinite(event[0]) || event[0] < previous || event[0] > data.duration ||
          !Number.isInteger(event[1]) || event[1] < 0 || event[1] >= data.spaces.length ||
          !Number.isInteger(event[2]) || event[2] < 0 || event[2] >= VALID.length) {
        throw new Error("録画の判定記録が不正です。");
      }
      previous = event[0];
    }
    return data;
  }
  function timecode(seconds) {
    const total = Math.floor(seconds);
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }
  function render() {
    const codes = Array(payload.spaces.length).fill(0);
    for (const [at, space, code] of payload.events) {
      if (at > current) break;
      codes[space] = code;
    }
    const list = qs("#spaces");
    list.replaceChildren();
    const counts = [0, 0, 0, 0];
    payload.spaces.forEach((uid, i) => {
      const code = codes[i];
      counts[code] += 1;
      const item = document.createElement("div");
      item.className = "space " + VALID[code];
      const heading = document.createElement("b");
      heading.textContent = uid;
      const label = document.createElement("span");
      label.textContent = NAMES[code];
      item.append(heading, label);
      list.append(item);
    });
    qs("#totals").textContent = "空き " + counts[1] + "区画 ／ 駐車中 " +
      counts[2] + "区画 ／ 障害物 " + counts[3] + "区画 ／ 未確認 " + counts[0] + "区画";
    qs("#seek").value = String(Math.round(current / payload.duration * 1000));
    qs("#time-display").textContent = timecode(current) + " / " + timecode(payload.duration);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    qs("#play").textContent = "再生する ▶";
  }
  function tick() {
    const now = performance.now();
    current = Math.min(payload.duration, current + (now - previousTick) / 1000 * Number(qs("#speed").value));
    previousTick = now;
    render();
    if (current >= payload.duration) stop();
  }
  function start() {
    if (timer) { stop(); return; }
    if (current >= payload.duration) current = 0;
    previousTick = performance.now();
    timer = setInterval(tick, 100);
    qs("#play").textContent = "一時停止 ⏸";
  }
  try {
    payload = fromHash();
    qs("#summary").textContent = "施設：" + RECORDING_FACILITIES[payload.facility_id] +
      " (" + payload.facility_id + ")｜記録 " +
      payload.spaces.length + "区画｜長さ " + timecode(payload.duration) +
      "｜過去の録画デモ（ライブではありません）";
    qs("#controls").hidden = false;
    qs("#results").hidden = false;
    qs("#play").addEventListener("click", start);
    qs("#seek").addEventListener("input", event => {
      current = Number(event.target.value) / 1000 * payload.duration;
      previousTick = performance.now();
      render();
    });
    window.addEventListener("pagehide", stop);
    render();
  } catch (err) {
    fail(err.message || "録画デモを表示できません。");
  }
})();
