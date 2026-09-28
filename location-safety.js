"use strict";

/* =========================================================
   駐車場空き区画案内：位置情報・操作時の安全確認
   位置情報はメモリー内だけで使用し、保存・送信しない。

   【安全設計上の前提】
   - GPSだけでは運転者と同乗者を判別できない。
   - 速度だけで即断せず、複数サンプルと継続時間で移動状態を判定する。
   - 移動中と判断した後は、GPSが途切れても確認要求を自動解除しない。
   - 安全確認で止めた操作は、確認後に自動再実行しない。
   - タブ非表示時は測位を一時停止し、表示復帰後に必要なら再開する。
   ========================================================= */

(() => {
  /* =========================================================
     判定設定・DOM参照・取得状態
     ========================================================= */

  /* 判定値は実機で調整する。GPSだけでは運転者かどうかは判断できない。 */
  const CONFIG = Object.freeze({
    /* 速度の単位：m/s。 */
    movingSpeed: 5 / 3.6,
    stoppedSpeed: 2 / 3.6,
    /* 時間の単位：ms。 */
    movingDuration: 4000,
    stoppedDuration: 15000,
    /* 位置精度の単位：m。 */
    maximumAccuracy: 35,
    /* 時間の単位：ms。 */
    maximumPositionAge: 20000,
    maximumSampleGap: 15000,
    historyDuration: 60000,
    passengerDuration: 5 * 60 * 1000,
    retryDelay: 10000,
  });

  const elements = {
    start: document.getElementById("location-button"),
    stop: document.getElementById("location-stop-button"),
    locationStatus: document.getElementById("location-status"),
    locationDetails: document.getElementById("location-details"),
    motionStatus: document.getElementById("motion-status"),
    dialog: document.getElementById("driving-dialog"),
    question: document.getElementById("driving-question"),
    driver: document.getElementById("confirm-driver-button"),
    passenger: document.getElementById("confirm-passenger-button"),
    close: document.getElementById("close-driving-dialog-button"),
    lockPanel: document.getElementById("driving-lock-panel"),
    resume: document.getElementById("resume-after-stop-button"),
    lockStatus: document.getElementById("driving-lock-status"),
  };

  function lt(ja, en) {
    return document.documentElement.lang?.toLowerCase().startsWith("en") ? en : ja;
  }

    const state = {
    enabled: false,
    watchId: null,
    generation: 0,
    retryId: null,
    timerId: null,
    location: null,
    lastTimestamp: null,
    history: [],
    motion: "unknown",
    candidate: null,
    candidateSince: null,
    candidateCount: 0,
    needsConfirmation: false,
    passengerUntil: 0,
    driverLocked: false,
    latestMovingTimestamp: null,
    previousFocus: null,
    suppressClickUntil: 0,
  };
  const controlSnapshots = new Map();

  /* =========================================================
     取得状態と安全確認の表示
     ========================================================= */

  /** 表示内容が変わったときだけ、テキストを更新する。 */
  function setText(element, value) {
    if (element && element.textContent !== value) {
      element.textContent = value;
    }
  }

  /** 新しい位置情報または位置情報の解除を、画面制御に通知する。 */
  function dispatchLocation(location) {
    state.location = location;
    window.dispatchEvent(new CustomEvent("parking:locationchange", {
      detail: { location },
    }));
  }

  /** 利用できなくなった位置情報と精度表示を消去する。 */
  function clearLocation() {
    if (state.location !== null) {
      dispatchLocation(null);
    }
    setText(elements.locationDetails, "");
  }

  /** 測位履歴を破棄する。既に必要になった安全確認は解除しない。 */
  function resetSamples() {
    state.history = [];
    state.lastTimestamp = null;
    state.candidate = null;
    state.candidateSince = null;
    state.candidateCount = 0;
    state.motion = "unknown";
    state.latestMovingTimestamp = null;
  }

  /** 新鮮な測位結果で移動が継続しているか確認する。 */
  function isCurrentlyMoving() {
    const freshMovingState = state.motion === "moving" && state.location !== null
      && Date.now() - state.location.timestamp <= CONFIG.maximumPositionAge;
    return freshMovingState || (state.latestMovingTimestamp !== null
      && Date.now() - state.latestMovingTimestamp <= CONFIG.maximumPositionAge);
  }

  /** 移動状態、確認期限、停止後の再開条件を画面に反映する。 */
  function updateSafetyStatus() {
    const passenger = state.passengerUntil > Date.now();
    let message = lt(
      "移動状態：位置情報の取得を開始してください。",
      "Movement: start location tracking to check your status.",
    );
    if (state.driverLocked) {
      message = lt(
        "運転中：画面操作を停止しています。",
        "Driving detected: screen controls are locked.",
      );
    } else if (passenger) {
      message = lt(
        "同乗者・運転者以外として操作できます。確認は最大5分間有効です。",
        "Passenger mode is active. Confirmation remains valid for up to 5 minutes.",
      );
    } else if (state.motion === "moving") {
      message = lt(
        "移動を検知しました。操作すると運転中か確認します。",
        "Movement detected. The app will confirm whether you are driving before allowing controls.",
      );
    } else if (state.motion === "stationary") {
      message = lt(
        "移動状態：停止相当の状態を検知しています。",
        "Movement: a stationary state is being detected.",
      );
    } else if (state.needsConfirmation) {
      message = lt(
        "移動状態を確認できません。次の操作で安全確認を行います。",
        "Movement status is uncertain. A safety confirmation will appear on the next operation.",
      );
    } else if (state.enabled) {
      message = lt(
        "移動状態：判定中です。運転中は操作しないでください。",
        "Movement: checking. Do not operate the screen while driving.",
      );
    }
    setText(elements.motionStatus, message);

    if (elements.resume) {
      elements.resume.disabled = isCurrentlyMoving();
    }
    if (isCurrentlyMoving()) {
      setText(elements.lockStatus, lt(
        "GPSで移動を検知しています。安全な場所に停車してから再開してください。",
        "GPS indicates that you are moving. Stop in a safe place before resuming.",
      ));
    } else if (state.motion === "stationary") {
      setText(elements.lockStatus, lt(
        "停止相当の状態を検知しました。安全な場所に停車していることを確認して再開してください。",
        "A stationary state was detected. Confirm that you are safely stopped before resuming.",
      ));
    } else {
      setText(elements.lockStatus, lt(
        "GPSで停止を確認できません。安全な場所に停車していることを自分で確認できた場合だけ再開してください。",
        "GPS cannot confirm that you are stopped. Resume only after confirming that you are safely parked.",
      ));
    }
  }

  /** 位置情報の開始・停止ボタンを取得状態に合わせる。 */
  function updateButtons() {
    if (elements.start) {
      elements.start.hidden = state.enabled;
    }
    if (elements.stop) {
      elements.stop.hidden = !state.enabled;
    }
  }

  /* =========================================================
     位置情報の継続取得と移動判定
     ========================================================= */

  /** 古いコールバックも無効化し、位置情報の監視と再試行を解除する。 */
  function cancelWatch() {
    state.generation += 1;
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    if (state.retryId !== null) {
      window.clearTimeout(state.retryId);
      state.retryId = null;
    }
  }

  /** 位置情報の鮮度を監視するタイマーを解除する。 */
  function stopTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  /** 利用者の停止操作または継続できないエラーで取得を終了する。 */
  function stop(message = null) {
    message ??= lt("位置情報の取得を停止しました。", "Location tracking stopped.");
    state.enabled = false;
    cancelWatch();
    stopTimer();
    clearLocation();
    resetSamples();
    state.passengerUntil = 0;
    /* GPS停止は、移動が終わったという根拠にはしない。 */
    setText(elements.locationStatus, message);
    updateButtons();
    updateSafetyStatus();
  }

  /** 古い位置情報と期限が切れた同乗者確認を無効にする。 */
  function checkFreshness() {
    if (state.location && Date.now() - state.location.timestamp > CONFIG.maximumPositionAge) {
      clearLocation();
      resetSamples();
      state.passengerUntil = 0;
      setText(elements.locationStatus, lt("位置情報の更新が途切れています。再取得を待っています。", "Location updates were interrupted. Waiting to reacquire your position."));
    }
    if (state.passengerUntil && state.passengerUntil <= Date.now()) {
      state.passengerUntil = 0;
    }
    updateSafetyStatus();
  }

  /** 2点間の直線距離をメートル単位で計算する。 */
  function distanceMeters(first, second) {
    const radians = Math.PI / 180;
    const latitudeDifference = (second.latitude - first.latitude) * radians;
    const longitudeDifference = (second.longitude - first.longitude) * radians;
    const value = Math.sin(latitudeDifference / 2) ** 2
      + Math.cos(first.latitude * radians) * Math.cos(second.latitude * radians)
      * Math.sin(longitudeDifference / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
  }

  /** 精度・取得間隔・速度から、今回の測位を分類する。 */
  function classifySample(sample, previous) {
    if (!previous || sample.accuracy > CONFIG.maximumAccuracy
      || previous.accuracy > CONFIG.maximumAccuracy) {
      return "unknown";
    }
    const elapsed = sample.timestamp - previous.timestamp;
    if (elapsed < 500 || elapsed > CONFIG.maximumSampleGap) {
      return "unknown";
    }

    /* speed は m/s。null・負数・非数値を「停止」と扱わない。 */
    if (Number.isFinite(sample.speed) && sample.speed >= 0) {
      if (sample.speed >= CONFIG.movingSpeed) {
        return "moving";
      }
      if (sample.speed <= CONFIG.stoppedSpeed) {
        return "stationary";
      }
      return "unknown";
    }

    /* 速度未提供の端末では、誤差範囲を引いた移動量で移動を確認する。
       停止確認には誤差範囲を加え、精度不足による早すぎる解除を避ける。 */
    const anchor = state.history.find((entry) =>
      sample.timestamp - entry.timestamp >= 4000
      && entry.accuracy <= CONFIG.maximumAccuracy);
    if (!anchor) {
      return "unknown";
    }
    const seconds = (sample.timestamp - anchor.timestamp) / 1000;
    const distance = distanceMeters(anchor, sample);
    const uncertainty = anchor.accuracy + sample.accuracy;
    if (Math.max(0, distance - uncertainty) / seconds >= CONFIG.movingSpeed) {
      return "moving";
    }
    if (seconds >= 15 && (distance + uncertainty) / seconds <= CONFIG.stoppedSpeed) {
      return "stationary";
    }
    return "unknown";
  }

  /** 複数回の測位で移動・停止の継続を確認し、単発の誤差を除外する。 */
  function updateMotion(sample) {
    const previous = state.history[state.history.length - 1];
    /* 高頻度の測位は位置表示だけ更新し、判定用の取得間隔を確保する。 */
    if (previous && sample.timestamp - previous.timestamp < 500) {
      return;
    }
    if (previous && sample.timestamp - previous.timestamp > CONFIG.maximumSampleGap) {
      state.history = [];
      state.candidate = null;
      state.candidateSince = null;
      state.candidateCount = 0;
    }
    state.history = state.history.filter((entry) =>
      sample.timestamp - entry.timestamp <= CONFIG.historyDuration);
    const classification = classifySample(sample, previous);
    state.history.push(sample);

    if (classification === "moving") {
      state.latestMovingTimestamp = sample.timestamp;
    }

    if (classification === "unknown") {
      state.candidate = null;
      state.candidateSince = null;
      state.candidateCount = 0;
      state.motion = "unknown";
      updateSafetyStatus();
      return;
    }
    if (state.candidate !== classification) {
      state.candidate = classification;
      state.candidateSince = sample.timestamp;
      state.candidateCount = 0;
    }
    state.candidateCount += 1;
    const requiredDuration = classification === "moving"
      ? CONFIG.movingDuration : CONFIG.stoppedDuration;
    if (state.candidateCount >= 2 && sample.timestamp - state.candidateSince >= requiredDuration) {
      state.motion = classification;
      if (classification === "moving") {
        state.needsConfirmation = true;
      } else {
        state.needsConfirmation = false;
        state.passengerUntil = 0;
        state.latestMovingTimestamp = null;
      }
    }
    updateSafetyStatus();
  }

  /** 新鮮で有効な位置情報だけを画面と移動判定に渡す。 */
  function receivePosition(position, generation) {
    if (!state.enabled || document.hidden || generation !== state.generation) {
      return;
    }
    const coordinates = position.coords;
    const timestamp = position.timestamp;
    const age = Date.now() - timestamp;
    if (!coordinates || !Number.isFinite(coordinates.latitude)
      || Math.abs(coordinates.latitude) > 90 || !Number.isFinite(coordinates.longitude)
      || Math.abs(coordinates.longitude) > 180 || !Number.isFinite(coordinates.accuracy)
      || coordinates.accuracy < 0 || !Number.isFinite(timestamp)
      || age < -5000 || age > CONFIG.maximumPositionAge) {
      resetSamples();
      setText(elements.locationStatus, lt("有効な位置情報を待っています。", "Waiting for a valid location fix."));
      updateSafetyStatus();
      return;
    }
    if (state.lastTimestamp !== null && timestamp <= state.lastTimestamp) {
      return;
    }
    state.lastTimestamp = timestamp;
    const location = {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracy: coordinates.accuracy,
      timestamp,
    };
    dispatchLocation(location);
    setText(elements.locationStatus, coordinates.accuracy <= CONFIG.maximumAccuracy
      ? lt(
          "位置情報を取得中です。画面表示中は継続して更新します。",
          "Location is active and will continue updating while this page is visible.",
        )
      : lt(
          "位置情報の精度が低いため、移動状態を確認できません。",
          "Location accuracy is too low to confirm movement status.",
        ));
    const locale = document.documentElement.lang?.startsWith("en") ? "en-US" : "ja-JP";
    const updatedAt = new Date(timestamp).toLocaleTimeString(locale);
    setText(elements.locationDetails, lt(
      `測位精度：約${Math.round(coordinates.accuracy)}m / 更新：${updatedAt}`,
      `Accuracy: about ${Math.round(coordinates.accuracy)} m / Updated: ${updatedAt}`,
    ));
    updateMotion({ ...location, speed: coordinates.speed });
  }

  /** 許可拒否は取得を終了し、一時的な測位エラーは再試行する。 */
  function receiveError(error, generation) {
    if (!state.enabled || document.hidden || generation !== state.generation) {
      return;
    }
    if (error.code === 1) {
      stop(lt("位置情報の利用が許可されていません。ブラウザーの設定で許可してから再開してください。", "Location access is not allowed. Enable it in your browser settings and try again."));
      return;
    }
    clearLocation();
    resetSamples();
    state.passengerUntil = 0;
    setText(elements.locationStatus, error.code === 3
      ? lt("位置情報の取得に時間がかかっています。自動で再試行します。", "Location is taking longer than expected. Retrying automatically.")
      : lt("現在の位置情報を取得できません。自動で再試行します。", "Unable to get your current location. Retrying automatically."));
    updateSafetyStatus();
    cancelWatch();
    state.retryId = window.setTimeout(() => {
      state.retryId = null;
      if (state.enabled && !document.hidden) {
        beginWatch();
      }
    }, CONFIG.retryDelay);
  }

  /** 画面表示中に位置情報の継続取得を1件だけ開始する。 */
  function beginWatch() {
    if (!state.enabled || document.hidden || state.watchId !== null) {
      return;
    }
    cancelWatch();
    const generation = state.generation;
    setText(elements.locationStatus, lt("位置情報を取得しています…", "Getting your location…"));
    try {
      const watchId = navigator.geolocation.watchPosition(
        (position) => receivePosition(position, generation),
        (error) => receiveError(error, generation),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
      /* 同期エラーを返す代替実装でも、取り残された監視を作らない。 */
      if (generation === state.generation) {
        state.watchId = watchId;
      } else {
        navigator.geolocation.clearWatch(watchId);
      }
    } catch {
      stop(lt("位置情報を開始できません。HTTPS接続とブラウザーの許可設定を確認してください。", "Unable to start location tracking. Check HTTPS and your browser permissions."));
    }
    if (state.enabled && state.timerId === null) {
      state.timerId = window.setInterval(checkFreshness, 2000);
    }
  }

  /** 利用者の開始操作を受けて、取得可能な環境で監視を有効にする。 */
  function start() {
    if (state.enabled) {
      return;
    }
    if (!window.isSecureContext) {
      stop(lt("位置情報を利用するにはHTTPS（開発時はlocalhost）で開いてください。", "Location requires HTTPS (or localhost during development)."));
      return;
    }
    if (!("geolocation" in navigator)) {
      stop(lt("このブラウザーは位置情報の取得に対応していません。", "This browser does not support geolocation."));
      return;
    }
    state.enabled = true;
    state.passengerUntil = 0;
    resetSamples();
    updateButtons();
    updateSafetyStatus();
    if (document.hidden) {
      setText(elements.locationStatus, lt("画面を表示すると位置情報の取得を開始します。", "Location tracking will start when the page becomes visible."));
      return;
    }
    beginWatch();
  }

  /** 画面を離れたら取得を一時停止し、同乗者確認を無効にする。 */
  function suspend() {
    if (!state.enabled) {
      return;
    }
    cancelWatch();
    stopTimer();
    clearLocation();
    resetSamples();
    state.passengerUntil = 0;
    setText(elements.locationStatus, lt("画面が非表示のため、位置情報の取得を一時停止しています。", "Location tracking is paused while the page is hidden."));
    updateSafetyStatus();
  }

  /** 利用者が取得を停止していなければ、画面復帰時に監視を再開する。 */
  function resume() {
    if (state.enabled && !document.hidden) {
      beginWatch();
    }
  }

  /* =========================================================
     運転確認と操作の制限
     ========================================================= */

  /** 元のフォーカスを記録し、運転確認または運転中の案内を開く。 */
  function openSafetyDialog() {
    const dialog = elements.dialog;
    if (!dialog || dialog.open) {
      return;
    }
    state.previousFocus = document.activeElement;
    elements.question.hidden = state.driverLocked;
    elements.lockPanel.hidden = !state.driverLocked;
    if (elements.close) {
      elements.close.hidden = state.driverLocked;
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
      dialog.setAttribute("aria-modal", "true");
    }
    updateSafetyStatus();
    const focusTarget = state.driverLocked ? elements.lockStatus : elements.driver;
    focusTarget?.focus();
  }

  /** 確認画面を閉じてフォーカスを戻す。遮断した操作は再実行しない。 */
  function closeSafetyDialog() {
    if (typeof elements.dialog?.close === "function") {
      elements.dialog.close();
    } else {
      elements.dialog?.removeAttribute("open");
    }
    if (state.previousFocus?.isConnected) {
      state.previousFocus.focus({ preventScroll: true });
    }
    state.previousFocus = null;
  }

  /** 画面操作前に安全確認が必要かどうかを返す。 */
  function guardOperation() {
    checkFreshness();
    if (state.driverLocked || elements.dialog?.open) {
      openSafetyDialog();
      return false;
    }
    if (state.needsConfirmation && state.passengerUntil <= Date.now()) {
      openSafetyDialog();
      return false;
    }
    return true;
  }

  /** ネイティブ選択画面が先に値を変更した場合に備え、直前の入力値を記録する。 */
  function rememberControlValues() {
    controlSnapshots.clear();
    document.querySelectorAll("input, select, textarea").forEach((control) => {
      controlSnapshots.set(control, {
        value: control.value,
        checked: control.checked,
        selectedValues: control instanceof HTMLSelectElement
          ? Array.from(control.selectedOptions, (option) => option.value) : null,
      });
    });
  }

  /** 遮断した操作で変わった入力値と、同じラジオボタングループの値を戻す。 */
  function restoreControlValue(target) {
    if (!(target instanceof Element) || !controlSnapshots.has(target)) {
      return;
    }
    controlSnapshots.forEach((snapshot, control) => {
      const sameRadioGroup = target instanceof HTMLInputElement && target.type === "radio"
        && target.name !== "" && control instanceof HTMLInputElement && control.type === "radio"
        && control.name === target.name && control.form === target.form;
      if (control !== target && !sameRadioGroup) {
        return;
      }
      if (control instanceof HTMLSelectElement) {
        Array.from(control.options).forEach((option) => {
          option.selected = snapshot.selectedValues.includes(option.value);
        });
      } else if (control.type !== "file") {
        control.value = snapshot.value;
      }
      if (control instanceof HTMLInputElement && ["radio", "checkbox"].includes(control.type)) {
        control.checked = snapshot.checked;
      }
    });
  }

  /** アプリ側の処理より先に操作を遮断し、必要な場合に運転確認を開く。 */
  function interceptOperation(event) {
    const target = event.target;
    if (elements.dialog?.open && target instanceof Node
      && target !== elements.dialog && elements.dialog.contains(target)) {
      return;
    }
    if (event.type === "keydown" && ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) {
      return;
    }
    const suppressClick = event.type === "click" && Date.now() < state.suppressClickUntil;
    if (suppressClick || !guardOperation()) {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
      if (["input", "change", "click"].includes(event.type)) {
        restoreControlValue(target);
      }
      if (event.type === "pointerdown" || event.type === "touchstart") {
        state.suppressClickUntil = Date.now() + 1000;
      }
      return;
    }
    if (["pointerdown", "touchstart", "keydown", "beforeinput", "input", "change", "click"].includes(event.type)) {
      rememberControlValues();
    }
  }

  /* =========================================================
     操作イベントと初期化
     ========================================================= */

  elements.start?.addEventListener("click", start);
  elements.stop?.addEventListener("click", () => stop());
  elements.passenger?.addEventListener("click", () => {
    if (state.driverLocked) {
      return;
    }
    state.passengerUntil = Date.now() + CONFIG.passengerDuration;
    closeSafetyDialog();
    updateSafetyStatus();
  });
  elements.driver?.addEventListener("click", () => {
    state.driverLocked = true;
    state.passengerUntil = 0;
    elements.question.hidden = true;
    elements.lockPanel.hidden = false;
    if (elements.close) {
      elements.close.hidden = true;
    }
    updateSafetyStatus();
    elements.lockStatus?.focus();
  });
  elements.resume?.addEventListener("click", () => {
    checkFreshness();
    if (isCurrentlyMoving()) {
      return;
    }
    state.driverLocked = false;
    state.needsConfirmation = false;
    state.passengerUntil = 0;
    resetSamples();
    closeSafetyDialog();
    updateSafetyStatus();
  });
  elements.close?.addEventListener("click", () => {
    if (!state.driverLocked) {
      closeSafetyDialog();
    }
  });
  elements.dialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!state.driverLocked) {
      closeSafetyDialog();
    }
  });
  elements.dialog?.addEventListener("close", () => {
    if (state.driverLocked) {
      openSafetyDialog();
    }
  });

  /* captureでアプリ側のハンドラーより先に判定し、スクロールも抑止する。 */
  ["pointerdown", "touchstart", "touchmove", "click", "keydown", "wheel", "submit", "beforeinput", "input", "change"].forEach((type) => {
    window.addEventListener(type, interceptOperation, { capture: true, passive: false });
  });
  window.addEventListener("parking:languagechange", () => {
    updateSafetyStatus();
    if (state.location) {
      const locale = document.documentElement.lang?.startsWith("en") ? "en-US" : "ja-JP";
      const updatedAt = new Date(state.location.timestamp).toLocaleTimeString(locale);
      setText(elements.locationStatus, state.location.accuracy <= CONFIG.maximumAccuracy
        ? lt(
            "位置情報を取得中です。画面表示中は継続して更新します。",
            "Location is active and will continue updating while this page is visible.",
          )
        : lt(
            "位置情報の精度が低いため、移動状態を確認できません。",
            "Location accuracy is too low to confirm movement status.",
          ));
      setText(elements.locationDetails, lt(
        `測位精度：約${Math.round(state.location.accuracy)}m / 更新：${updatedAt}`,
        `Accuracy: about ${Math.round(state.location.accuracy)} m / Updated: ${updatedAt}`,
      ));
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      suspend();
    } else {
      resume();
    }
  });
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  document.addEventListener("DOMContentLoaded", rememberControlValues, { once: true });
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Element && event.target.matches("input, select, textarea")
      && !state.driverLocked && (!state.needsConfirmation || state.passengerUntil > Date.now())) {
      rememberControlValues();
    }
  });
  window.parkingSafety = Object.freeze({ start, stop, guardOperation });
  rememberControlValues();
  updateButtons();
  updateSafetyStatus();
})();