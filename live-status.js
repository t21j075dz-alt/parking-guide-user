"use strict";

/*
 * カメラが判定した駐車枠の最新状態だけを受け取る。
 * - 動画、車両ID、個人情報は取得しない。
 * - RLSで公開を許可された施設のみ匿名取得できる。
 * - 判定から15秒を過ぎたら「未確認」。保存済みの「空き」に戻さない。
 * - WebSocketは補助。圏外や切断時でも3秒ごとに確認する。
 */
(() => {
  const config = window.PARKING_REMOTE_CONFIG ?? {};
  const base = String(config.supabaseUrl ?? "").replace(/\/$/, "");
  const key = String(config.publishableKey ?? "");
  const enabled = config.enabled === true && /^https:\/\//.test(base) && key.length > 10;
  const STALE_MS = 15000;
  const LIVE_STATUSES = new Set(["available", "occupied", "blocked", "unknown"]);
  const facilities = new Map();
  let watchedFacility = null;
  let timer = null;
  let channel = null;
  let client = null;

  function getRows(facilityId) {
    return facilities.get(facilityId) ?? null;
  }
  function isFresh(row) {
    const stamp = Date.parse(row?.checked_at ?? "");
    const age = Date.now() - stamp;
    return Number.isFinite(stamp) && age >= -60000 && age <= STALE_MS;
  }
  function hasFresh(facilityId) {
    return [...(getRows(facilityId)?.values() ?? [])].some(isFresh);
  }
  function hasAny(facilityId) {
    return facilities.has(facilityId) && (getRows(facilityId)?.size ?? 0) > 0;
  }
  function apply(spaces, facilityId) {
    const rows = getRows(facilityId);
    if (!rows || !rows.size) return spaces;
    return spaces.map((space) => {
      const row = rows.get(space.uid);
      if (!row) {
        // 一部区画だけカメラ監視する施設では未監視を空き扱いしない。
        return { ...space, occupancyStatus: "unknown", isOccupied: true };
      }
      const status = isFresh(row) ? row.status : "unknown";
      return { ...space, occupancyStatus: status, isOccupied: status !== "available" };
    });
  }
  function notify(facilityId) {
    window.dispatchEvent(new CustomEvent("parking:livechange", { detail: { facilityId } }));
  }
  async function refresh(facilityId) {
    if (!enabled || !facilityId) return;
    const id = String(facilityId);
    try {
      const response = await fetch(
        base + "/rest/v1/parking_live_status?facility_id=eq."
        + encodeURIComponent(id) + "&select=space_uid,status,checked_at",
        { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      // まだデータがない施設は従来の保存済みレイアウトを使う。
      if (!rows.length && !facilities.has(id)) return;
      const newRows = new Map(rows.filter((r) =>
        r && typeof r.space_uid === "string" && LIVE_STATUSES.has(r.status),
      ).map((r) => [r.space_uid, r]));
      const previous = facilities.get(id);
      const signature = JSON.stringify([...newRows.values()].map((r) =>
        [r.space_uid, isFresh(r) ? r.status : "unknown"],
      ).sort());
      const previousSignature = JSON.stringify([...(previous?.values() ?? [])].map((r) =>
        [r.space_uid, isFresh(r) ? r.status : "unknown"],
      ).sort());
      facilities.set(id, newRows);
      if (signature !== previousSignature) notify(id);
    } catch {
      // 最終受信時刻で判定期限を管理。圏外時も古い「空き」を信用しない。
      const old = getRows(id);
      if (old?.size) notify(id);
    }
  }
  async function attachRealtime(facilityId) {
    if (!enabled) return;
    try {
      // バージョンを固定。外部ライブラリが使えなくてもポーリングで継続。
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.76.0");
      if (watchedFacility !== facilityId) return;
      client = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
      channel = client.channel("parking-live-" + facilityId)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "parking_live_status",
          filter: "facility_id=eq." + facilityId,
        }, () => { void refresh(facilityId); })
        .subscribe();
    } catch {
      // 通信制限やCDN障害の場合は3秒ごとの確認を継続。
    }
  }
  function watch(facilityId) {
    const id = facilityId ? String(facilityId) : null;
    if (id === watchedFacility) return;
    if (timer) clearInterval(timer);
    timer = null;
    if (client && channel) void client.removeChannel(channel);
    channel = null;
    client = null;
    watchedFacility = id;
    if (!id || !enabled) return;
    void refresh(id);
    timer = window.setInterval(() => { void refresh(id); }, 3000);
    void attachRealtime(id);
  }
  window.PARKING_LIVE = Object.freeze({ refresh, watch, apply, hasFresh, hasAny });
})();
