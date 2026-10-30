"use strict";

/* 録画YOLO実演の接続状態。実カメラの現在の空きと絶対に混同しない。 */
(() => {
  const FACILITY = "home-video-demo-001";
  const sections = ["condition-screen", "result-screen"];
  const panels = sections.map((id) => {
    const screen = document.getElementById(id);
    const heading = screen?.querySelector(".screen-heading");
    if (!heading) return null;
    const panel = document.createElement("p");
    panel.className = "recorded-demo-link-status";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.hidden = true;
    heading.insertAdjacentElement("afterend", panel);
    return { screen, panel };
  }).filter(Boolean);

  const localize = (ja, en) => document.documentElement.lang === "en" ? en : ja;
  let busy = false;
  let stamp = 0;

  async function refresh(force = false) {
    const isSelected = typeof state !== "undefined"
      && state.selectedFacility?.id === FACILITY;
    const visible = panels.filter(({ screen, panel }) => {
      const show = isSelected && !screen.hidden;
      panel.hidden = !show;
      return show;
    });
    if (!visible.length || !window.ParkingLiveStatus || document.hidden) return;
    if (busy || (!force && Date.now() - stamp < 2800)) return;
    busy = true;
    stamp = Date.now();
    try {
      const result = await window.ParkingLiveStatus.refresh(FACILITY);
      let message;
      if (result.error) {
        message = localize(
          "録画YOLOとの通信を確認できません。以前の判定は空きとして利用しません。",
          "Recorded YOLO connection unavailable. Previous spaces are not considered free.",
        );
      } else if (!result.published) {
        message = localize(
          "録画YOLO：共有停止中。録画用PCで共有を開始すると判定が表示されます。",
          "Recorded YOLO: sharing is off. Start replay sharing from the research PC.",
        );
      } else {
        const now = Date.now();
        const rows = [...result.rows.values()];
        const fresh = rows.filter((row) => {
          const time = Date.parse(row.checked_at || "");
          return row.source === "recorded_video_demo"
            && Number.isFinite(time) && time <= now + 5000
            && now - time >= -5000 && now - time <= 20000;
        });
        message = fresh.length
          ? localize(
              "録画YOLO連携中：" + fresh.length + "区画の判定を受信。過去の録画であり現在の空きではありません。",
              "Recorded YOLO connected: " + fresh.length + " spaces. This is old footage, not live parking.",
            )
          : localize(
              "録画の共有設定はONですが、新しい判定は未確認です。古い空き情報は使いません。",
              "Replay sharing is enabled, but fresh results are unavailable.",
            );
      }
      visible.forEach(({ panel }) => { panel.textContent = message; });
    } catch {
      visible.forEach(({ panel }) => {
        panel.textContent = localize(
          "録画YOLOの状況を確認できません。", "Recorded YOLO status unavailable.",
        );
      });
    } finally {
      busy = false;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh(true);
  });
  document.addEventListener("click", () => { void refresh(true); });
  setInterval(() => { void refresh(); }, 3000);
  void refresh(true);
})();
