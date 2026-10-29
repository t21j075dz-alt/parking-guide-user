"use strict";

/*
 * カメラで確認した区画情報だけを取得する小さな通信部。
 * - 公開設定がONの施設だけ読み取る。
 * - 20秒以上更新のない値は「確認できない」にする。
 * - 通信に失敗しても古いデータを空きとして使わない。
 * - 3秒ごとに確認する。映像・車両ID・駐車時間は利用者へ送信しない。
 */
window.ParkingLiveStatus = (() => {
  const STALE_MS = 20000;
  const POLL_MS = 3000;
  const stored = new Map();
  let timer = null;
  let generation = 0;
  let activeId = null;
  let onUpdate = null;
  let inFlight = false;

  function settings() {
    const config = window.PARKING_REMOTE_CONFIG || {};
    const url = String(config.supabaseUrl || "").replace(/\/$/, "");
    const key = String(config.publishableKey || "");
    return config.enabled && /^https:\/\//.test(url) && key.length > 10 ? { url, key } : null;
  }

  async function requestJson(url, key) {
    const response = await fetch(url, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function snapshot(facilityId) {
    return stored.get(facilityId) || { published: false, rows: new Map(), error: false };
  }

  // 読み込み失敗時は必ず公開情報を無効にして、古い「空き」を出さない。
  async function refresh(facilityId) {
    const config = settings();
    if (!facilityId || !config) return snapshot(facilityId);
    const id = encodeURIComponent(facilityId);
    const visibilityUrl = `${config.url}/rest/v1/parking_live_visibility?facility_id=eq.${id}&is_published=eq.true&select=facility_id&limit=1`;
    try {
      const visibility = await requestJson(visibilityUrl, config.key);
      if (!Array.isArray(visibility) || !visibility.length) {
        const result = { published: false, rows: new Map(), error: false };
        stored.set(facilityId, result);
        return result;
      }
      const rows = await requestJson(
        `${config.url}/rest/v1/parking_live_status?facility_id=eq.${id}&select=space_uid,status,confidence,source,checked_at`,
        config.key,
      );
      if (!Array.isArray(rows)) throw new Error("Unexpected response");
      const result = {
        published: true,
        rows: new Map(rows.filter(row => typeof row.space_uid === "string").map(row => [row.space_uid, row])),
        error: false,
      };
      stored.set(facilityId, result);
      return result;
    } catch {
      // ネットワーク断でも「過去に空いていた」を根拠に案内しない。
      const result = { published: true, rows: new Map(), error: true };
      stored.set(facilityId, result);
      return result;
    }
  }

  function apply(facilityId, spaces) {
    const current = snapshot(facilityId);
    // 自宅のライブ実験施設では、未公開中でもレイアウト保存時の
    // 古い「available」を現在の空きとして使わない。
    // 他の手動運用施設や録画デモの動作は変更しない。
    if (!current.published) {
      if (facilityId !== "home-test-001" || !settings()) return spaces;
      return spaces.map(space => ({
        ...space,
        occupancyStatus: "unknown",
        isOccupied: true,
        liveCheckedAt: null,
      }));
    }
    const now = Date.now();
    return spaces.map((space) => {
      const row = current.rows.get(space.uid);
      const checkedAt = Date.parse(row?.checked_at || "");
      const fresh = Number.isFinite(checkedAt) && checkedAt <= now + 5000
        && now - checkedAt <= STALE_MS && now - checkedAt >= -5000;
      const correctSource = facilityId !== "home-video-demo-001"
        || row?.source === "recorded_video_demo";
      const status = fresh && correctSource && ["available", "occupied", "blocked", "unknown"].includes(row.status)
        ? row.status : "unknown";
      return { ...space, occupancyStatus: status, isOccupied: status !== "available", liveCheckedAt: fresh ? row.checked_at : null };
    });
  }

  function stop() {
    generation += 1;
    clearInterval(timer);
    timer = null;
    activeId = null;
    onUpdate = null;
  }

  // 施設や画面を切り替えたら旧施設の更新は停止する。
  function watch(facilityId, callback) {
    stop();
    if (!facilityId || typeof callback !== "function" || !settings()) return;
    activeId = facilityId;
    onUpdate = callback;
    const myGeneration = generation;
    const tick = async () => {
      if (inFlight || document.hidden || myGeneration !== generation) return;
      inFlight = true;
      try {
        await refresh(facilityId);
        if (myGeneration === generation && activeId === facilityId) onUpdate(snapshot(facilityId));
      } finally {
        inFlight = false;
      }
    };
    timer = setInterval(() => { void tick(); }, POLL_MS);
  }

  window.addEventListener("pageshow", () => {
    if (activeId && onUpdate && !document.hidden) {
      // 復帰直後は最大3秒後に現在の状態へ追いつく。
      const id = activeId;
      const cb = onUpdate;
      void refresh(id).then(() => { if (activeId === id && onUpdate === cb) cb(snapshot(id)); });
    }
  });

  return Object.freeze({ refresh, apply, snapshot, watch, stop, STALE_MS, POLL_MS });
})();
