"use strict";

/* =========================================================
   【利用者アプリのデータフロー】

   facilities.js
      ↓ 施設一覧
   利用者が施設・条件を選択
      ↓
   Supabase設定あり：最新レイアウトを取得
   設定なし／通信失敗：parking-layouts.js を使用
      ↓
   parkingSpace と buildingEntrance を使って案内候補を選択
      ↓
   区画マップ・詳細案内へ表示

   実店舗のリアルタイム空き情報はまだ取得していない。
   管理レイアウトがない施設だけ研究用シミュレーションへフォールバックする。
   ========================================================= */

/* =========================================================
   駐車場空き区画案内：画面制御

   研究対象施設は facilities.js、駐車場レイアウトは
   parking-layouts.js から読み込む。位置情報と運転確認は
   location-safety.js が担当する。
   ========================================================= */

const DEMO_FACILITY = Object.freeze({
  id: "ous-main-gate-experiment",
  name: "実験用駐車場（岡山理科大学正門）",
  prefecture: "岡山県",
  municipality: "岡山市",
  address: "岡山県岡山市北区理大町1-1 岡山理科大学正門",
  category: "experiment",
  latitude: 34.6998,
  longitude: 133.9280,
  demoDistance: 0.8,
  layoutId: "ous-main-gate-experiment",
  targetBuildingId: null,
  isDemo: true,
});

const ACTIVE_FACILITY_CATALOG = FACILITY_CATALOG.filter(
  (facility) => Boolean(facility.sampleRole) || facility.id === "home-test-001",
);
const FACILITIES = Object.freeze([DEMO_FACILITY, ...ACTIVE_FACILITY_CATALOG]);

const CATEGORY_LABELS = Object.freeze({
  supermarket: "スーパー・食品店",
  "home-center": "ホームセンター",
  "discount-store": "ディスカウントストア",
  drugstore: "ドラッグストア",
  restaurant: "ファミレス・飲食店",
  "roadside-station": "道の駅",
  "shopping-center": "複合商業施設",
  experiment: "実験用駐車場",
});

const CATEGORY_LABELS_EN = Object.freeze({
  supermarket: "Supermarket / grocery",
  "home-center": "Home center",
  "discount-store": "Discount store",
  drugstore: "Drugstore",
  restaurant: "Family restaurant / dining",
  "roadside-station": "Roadside station",
  "shopping-center": "Shopping complex",
  experiment: "Test parking lot",
});

function getCategoryLabel(category) {
  return (isEnglish() ? CATEGORY_LABELS_EN : CATEGORY_LABELS)[category] ?? category;
}

function getFacilityDisplayName(facility) {
  return facility?.displayName || facility?.name || "";
}

function getSelectedDestinationName() {
  return state.selectedDestination?.name ?? null;
}

const PRIORITY_LABELS = Object.freeze({
  balanced: "おまかせ",
  near: "入口に近い",
  wide: "幅にゆとりがある",
});

const SPACE_TYPE_LABELS = Object.freeze({
  standard: "普通車",
  compact: "軽自動車",
  accessible: "車いす使用者用",
  ev: "EV充電",
});

const SPACE_TYPE_LABELS_EN = Object.freeze({
  standard: "Standard",
  compact: "Kei car",
  accessible: "Accessible",
  ev: "EV charging",
});

const PRIORITY_LABELS_EN = Object.freeze({
  balanced: "Recommended",
  near: "Near entrance",
  wide: "More space",
});

/*
 * 固有名詞は元データを保持し、UI文言だけ日本語／英語を切り替える。
 * 静的HTMLは日本語文言を英訳辞書で置換する。
 */
const STATIC_JA_EN = Object.freeze({
  "本文へ移動": "Skip to main content",
  "駐車場空き区画案内": "Parking Space Guide",
  "施設": "Facility",
  "条件": "Options",
  "区画": "Space",
  "案内": "Guide",
  "卒業研究用の試作です。実店舗の空き情報は取得していません。駐車区画の検索結果は、管理データ未登録の施設ではシミュレーションを表示します。":
    "Graduation research prototype. Live parking occupancy is not currently collected. Facilities without registered layout data use simulated results.",
  "現在地": "Current location",
  "まだ取得していません": "Location not started",
  "現在地の取得中に移動状態を確認します。": "Movement status is checked while location is active.",
  "現在地を取得": "Start location",
  "取得を停止": "Stop location",
  "位置情報について": "About location data",
  "現在地は距離表示と移動状態の確認に使用します。位置情報はこのページ内で処理し、保存・送信しません。":
    "Location is used for distance display and movement checks. It is processed on this page and is not stored or transmitted.",
  "ブラウザー版のため、画面を閉じた後やバックグラウンドでの常時取得は行いません。":
    "Because this is a browser app, location is not continuously tracked after the page is closed or while it is suspended in the background.",
  "利用する施設を選択": "Select a facility",
  "中国地方・九州地方の研究対象施設と、岡山理科大学の実験用駐車場を掲載しています。":
    "Research facilities in the Chugoku and Kyushu regions and the Okayama University of Science test parking lot are listed.",
  "絞り込み": "Filters",
  "都道府県": "Prefecture",
  "カテゴリ": "Category",
  "すべての都道府県": "All prefectures",
  "すべてのカテゴリ": "All categories",
  "距離順に更新": "Sort by distance",
  "条件を解除": "Clear filters",
  "条件に一致する施設がありません。": "No facilities match the selected filters.",
  "← 施設選択へ戻る": "← Back to facilities",
  "駐車区画の条件": "Parking options",
  "目的店舗": "Destination store",
  "この敷地内で行きたい店舗を選択してください。": "Choose the store you want to visit within this site.",
  "行き先": "Destination",
  "目的店舗を選択": "Select a destination store",
  "利用する駐車区画": "Parking space type",
  "普通車": "Standard vehicle",
  "普通車用の空き区画から案内": "Guide to an available standard space",
  "軽自動車": "Kei car",
  "「軽」の区画から案内": "Guide to an available kei-car space",
  "車いす使用者用": "Accessible",
  "「♿」の区画から案内": "Guide to an accessible parking space",
  "EV充電を利用": "Use EV charging",
  "EV用の区画から案内": "Guide to an available EV charging space",
  "優先する条件": "Preference",
  "おまかせ": "Recommended",
  "入口までの距離と停めやすさをもとに選択": "Choose using entrance distance and ease of parking",
  "入口に近い": "Near entrance",
  "案内対象の建物入口に近い区画を優先": "Prefer spaces near the target entrance",
  "幅にゆとりがある": "More space",
  "幅の広い区画を優先": "Prefer wider spaces",
  "施設へ近づいたら自動表示": "Show automatically near the facility",
  "この条件を保存すると、位置情報を使って選択施設への接近を確認します。約250m以内に入ると空き区画を自動検索して表示します。":
    "After starting automatic guidance, your location is checked. An available space is shown automatically when you are within about 250 m of the selected facility.",
  "まだ自動案内を開始していません。": "Automatic guidance has not started.",
  "音声案内を使用": "Use voice guidance",
  "案内先が決まったときに端末の音声で読み上げます。": "Read the selected parking space aloud when guidance is ready.",
  "音声": "Voice",
  "自動（聞き取りやすい音声）": "Automatic (clear voice)",
  "音声を試す": "Preview voice",
  "この条件で自動案内を開始": "Start automatic guidance",
  "今すぐ空き区画を確認": "Check available space now",
  "マルナカ 中井町店では現在、条件に合う空き区画から研究用にランダムで1区画を案内します。":
    "For Marunaka Nakaicho, this prototype currently selects one matching available space at random.",
  "自宅テスト地点": "Home test location",
  "正確な自宅位置は公開データに保存しません。自宅にいるときに現在地をこの端末だけへ登録してください。":
    "Your exact home location is not stored in public data. While at the test location, save the current position only on this device.",
  "テスト地点はまだ登録されていません。": "The test location has not been saved on this device.",
  "現在地をテスト地点として登録": "Save current location as test point",
  "登録地点を削除": "Delete saved test point",
  "← 条件選択へ戻る": "← Back to options",
  "待機": "Waiting",
  "自動案内中": "Automatic guidance active",
  "目的施設への接近を待っています": "Waiting to approach the destination",
  "約250m以内に入ると、空き区画を自動で検索して表示します。":
    "When you come within about 250 m, an available parking space will be searched and displayed automatically.",
  "目的施設": "Destination facility",
  "住所": "Address",
  "利用する区画": "Parking space type",
  "優先条件": "Preference",
  "位置情報を確認しています…": "Checking your location…",
  "Google Mapsで目的施設を開く": "Open destination in Google Maps",
  "自宅テスト用では、端末内に登録した座標をGoogle Mapsへ渡します。":
    "For the home test facility, the coordinate stored on this device is passed to Google Maps.",
  "走行中は画面を操作せず、自動案内が開始されるまでそのままお待ちください。":
    "Do not operate the screen while driving. Wait for guidance to start automatically.",
  "案内を終了": "End guidance",
  "案内先の駐車区画": "Recommended parking space",
  "案内先": "Destination",
  "選択条件": "Selected option",
  "駐車場マップ": "Parking map",
  "空き": "Available",
  "使用中": "Occupied",
  "建物入口": "Building entrance",
  "区画までの案内を見る": "View parking guidance",
  "音声で案内": "Voice guidance",
  "空き状況を更新": "Refresh availability",
  "← 区画表示へ戻る": "← Back to parking space",
  "駐車区画までの案内": "Parking guidance",
  "現地の標識・一方通行・歩行者を優先してください。": "Follow on-site signs, one-way restrictions, and give priority to pedestrians.",
  "駐車場内へ進む": "Enter the parking area",
  "現地の入口・進行方向を確認してください。": "Check the entrance and traffic direction on site.",
  "案内先区画へ進む": "Proceed to the selected space",
  "管理画面で経路データを登録すると、ここを実際の案内経路に置き換えられます。":
    "When route data is registered in the admin app, this can be replaced with actual route guidance.",
  "案内先に到着": "Arrive at the selected space",
  "路面の区画番号と画面表示を確認してください。": "Confirm the pavement marking and the space shown on screen.",
  "安全上の注意": "Safety notice",
  "運転者は走行中に画面を操作しないでください。": "Drivers must not operate the screen while driving.",
  "最初の画面へ戻る": "Back to start",
  "運転中ですか？": "Are you driving?",
  "移動を検知しました。GPSだけでは運転者と同乗者を区別できないため、操作する方の状況を確認します。":
    "Movement was detected. GPS alone cannot tell whether you are the driver or passenger, so please confirm your situation.",
  "はい、運転中です": "Yes, I am driving",
  "いいえ、運転していません": "No, I am not driving",
  "操作をやめる": "Cancel",
  "運転中の操作は同乗者に依頼するか、安全な場所に停車してから行ってください。":
    "Ask a passenger to operate the app, or stop in a safe place before using it.",
  "安全な場所に停車するまで操作できません。": "Controls are locked until you stop in a safe place.",
  "安全な場所に停車したので再開する": "I have stopped safely",
  "岡山理科大学 工学部 情報工学科 卒業研究": "Okayama University of Science — Graduation Research",
  "試作システムのため、実際の駐車案内には使用できません。":
    "Prototype system. Do not rely on it for real-world parking guidance.",
  "日本語はGoogle 日本語を固定で使用します。English表示では英語・中国語・韓国語・スペイン語の音声案内を選べます。":
    "Japanese uses Google Japanese by default. In English view, voice guidance can be selected in English, Chinese, Korean, or Spanish.",
  "日本語：Google 日本語（固定）": "Japanese: Google Japanese (fixed)",
  "音声案内言語": "Voice guidance language",
  "音声を試す": "Test voice",
  "言語を選ぶと、その言語の音声を自動で試聴します。対応音声が端末にない場合は画面に表示します。":
    "Selecting a language automatically plays a voice sample. If the voice is unavailable on the device, the app shows that on screen."
});

const STATIC_EN_JA = Object.freeze(
  Object.fromEntries(Object.entries(STATIC_JA_EN).map(([ja, en]) => [en, ja])),
);

function isEnglish() {
  return state.language === "en";
}

function ui(ja, en) {
  return isEnglish() ? en : ja;
}

function getSpaceTypeLabel(type) {
  return (isEnglish() ? SPACE_TYPE_LABELS_EN : SPACE_TYPE_LABELS)[type] ?? type;
}

function getPriorityLabel(priority) {
  return (isEnglish() ? PRIORITY_LABELS_EN : PRIORITY_LABELS)[priority] ?? priority;
}

function translateStaticPage() {
  const map = isEnglish() ? STATIC_JA_EN : STATIC_EN_JA;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    const raw = node.nodeValue ?? "";
    const trimmed = raw.trim();
    const replacement = map[trimmed];
    if (!replacement) return;
    node.nodeValue = raw.replace(trimmed, replacement);
  });

  document.documentElement.lang = isEnglish() ? "en" : "ja";
  document.title = ui(
    "駐車場空き区画案内｜卒業研究",
    "Parking Space Guide | Graduation Research",
  );

  languageButton.textContent = isEnglish() ? "日本語" : "English";
  languageButton.setAttribute(
    "aria-label",
    ui("表示言語を英語へ切り替える", "Switch display language to Japanese"),
  );
}

function applyLanguage(language) {
  state.language = language === "en" ? "en" : "ja";
  translateStaticPage();
  applyTheme(document.documentElement.dataset.theme ?? "light");
  applyTextSizeLabel();
  initializeFilters();
  renderFacilities();
  updateProximityStatus();
  if (state.selectedFacility) {
    selectedFacilityName.textContent = getFacilityDisplayName(state.selectedFacility);
    updateDestinationPanel();
    updateRandomGuidanceNote();
    updatePrivateTestLocationPanel();
    updateWaitingScreen();
  }
  if (state.recommendedSpace) {
    const random = RANDOM_GUIDANCE_FACILITY_IDS.has(state.selectedFacility?.id);
    priorityBadge.textContent = random
      ? `${getSpaceTypeLabel(state.requestedSpaceType)} / ${ui("ランダム", "Random")}`
      : `${getSpaceTypeLabel(state.requestedSpaceType)} / ${getPriorityLabel(state.selectedPriority)}`;
    if (Number.isFinite(state.recommendedSpace.entranceDistanceMeters)) {
      spaceDescription.textContent = ui(
        `建物入口まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m`,
        `About ${Math.round(state.recommendedSpace.entranceDistanceMeters)} m to the entrance`,
      );
    }
    searchStatus.textContent = random
      ? ui(
          `${getFacilityDisplayName(state.selectedFacility)}では研究用として、条件に合う空き区画からランダムに案内しています。`,
          `For ${getFacilityDisplayName(state.selectedFacility)}, this prototype randomly selects one matching available space.`,
        )
      : ui("案内先を表示しています。", "Showing the selected parking space.");
    updatedTime.textContent = new Intl.DateTimeFormat(isEnglish() ? "en-US" : "ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    if (state.currentSpaces.length) {
      renderParkingMap(state.currentSpaces, state.recommendedSpace, state.currentLayout);
    }
  }
  updateVoiceModeUi();
  window.dispatchEvent(new CustomEvent("parking:languagechange", {
    detail: { language: state.language },
  }));
  try {
    localStorage.setItem("parkingGuideLanguage", state.language);
    localStorage.setItem("parkingGuideGuidanceVoiceLanguage", state.guidanceVoiceLanguage);
  } catch {
    /* 保存できない環境でも現在の言語は維持する。 */
  }
}

function restoreLanguage() {
  let saved = "ja";
  try {
    saved = localStorage.getItem("parkingGuideLanguage") ?? "ja";
  } catch {
    saved = "ja";
  }
  try {
    const savedLanguage = localStorage.getItem("parkingGuideGuidanceVoiceLanguage");
    const supportedGuidanceLanguages = new Set([
      "en-US",
      "en-GB",
      "zh-CN",
      "ko-KR",
      "es-ES",
    ]);
    state.guidanceVoiceLanguage = supportedGuidanceLanguages.has(savedLanguage)
      ? savedLanguage
      : "en-US";
    localStorage.removeItem("parkingGuideVoiceURI");
  } catch {
    state.guidanceVoiceLanguage = "en-US";
  }
  applyLanguage(saved);
}

/* 選択施設からこの距離以内へ入ると、自動で案内先を表示する。 */
const AUTO_GUIDANCE_DISTANCE_KM = 0.25;
const AUTO_GUIDANCE_MAX_ACCURACY_METERS = 80;
const PRIVATE_TEST_FACILITY_ID = "home-test-001";
const PRIVATE_TEST_COORDINATE_STORAGE_KEY = "parkingGuidePrivateTestCoordinatesV1";
const RANDOM_GUIDANCE_FACILITY_IDS = new Set(["target_021", PRIVATE_TEST_FACILITY_ID]);

const SCREEN_ORDER = Object.freeze(["facility", "condition", "waiting", "result"]);

const state = {
  currentScreen: "facility",
  language: "ja",
  voiceEnabled: true,
  guidanceVoiceLanguage: "en-US",
  lastSearchWasAuto: false,
  selectedFacility: null,
  selectedDestination: null,
  resolvedFacilityCoordinates: new Map(),
  resolvingFacilityCoordinates: new Map(),
  selectedPriority: "balanced",
  requestedSpaceType: "standard",
  autoProximityArmed: false,
  autoTriggeredFacilityId: null,
  proximitySearchRunning: false,
  pendingPrivateTestCalibration: false,
  recommendedSpace: null,
  currentSpaces: [],
  currentLayout: null,
  guideEntrance: null,
  userLocation: null,
  searchSequence: 0,
  searchRequestId: 0,
  filters: { prefecture: "", category: "" },
  sortByDistance: false,
};

/* =========================================================
   DOM参照
   ========================================================= */

const facilityList = document.querySelector("#facility-list");
const filterForm = document.querySelector("#facility-filter-form");
const prefectureFilter = document.querySelector("#prefecture-filter");
const categoryFilter = document.querySelector("#category-filter");
const resetFiltersButton = document.querySelector("#reset-filters-button");
const sortDistanceButton = document.querySelector("#sort-distance-button");
const facilityCount = document.querySelector("#facility-count");
const facilityEmpty = document.querySelector("#facility-empty");
const textSizeButton = document.querySelector("#text-size-button");
const themeButton = document.querySelector("#theme-button");
const languageButton = document.querySelector("#language-button");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const conditionForm = document.querySelector("#condition-form");
const searchNowButton = document.querySelector("#search-now-button");
const voiceEnabledInput = document.querySelector("#voice-enabled");
const voiceModeLabel = document.querySelector("#voice-mode-label");
const englishVoiceRow = document.querySelector("#english-voice-row");
const guidanceVoiceInputs = [...document.querySelectorAll('input[name="guidanceVoiceLanguage"]')];
const voicePreviewButton = document.querySelector("#voice-preview-button");
const voiceStatus = document.querySelector("#voice-status");
const randomGuidanceNote = document.querySelector("#random-guidance-note");
const privateTestLocationPanel = document.querySelector("#private-test-location-panel");
const privateTestLocationStatus = document.querySelector("#private-test-location-status");
const savePrivateTestLocationButton = document.querySelector("#save-private-test-location-button");
const clearPrivateTestLocationButton = document.querySelector("#clear-private-test-location-button");
const proximityStatus = document.querySelector("#proximity-status");
const selectedFacilityName = document.querySelector("#selected-facility-name");
const destinationFieldset = document.querySelector("#destination-fieldset");
const destinationSelect = document.querySelector("#destination-select");
const waitingFacilityName = document.querySelector("#waiting-facility-name");
const waitingFacilityAddress = document.querySelector("#waiting-facility-address");
const waitingSpaceType = document.querySelector("#waiting-space-type");
const waitingPriority = document.querySelector("#waiting-priority");
const waitingDestinationRow = document.querySelector("#waiting-destination-row");
const waitingDestinationName = document.querySelector("#waiting-destination-name");
const waitingProximityStatus = document.querySelector("#waiting-proximity-status");
const waitingGoogleMapsLink = document.querySelector("#waiting-google-maps-link");
const waitingGoogleMapsNote = document.querySelector("#waiting-google-maps-note");
const searchStatus = document.querySelector("#search-status");
const resultContent = document.querySelector("#result-content");
const spaceNumber = document.querySelector("#space-number");
const spaceDescription = document.querySelector("#space-description");
const priorityBadge = document.querySelector("#priority-badge");
const parkingMap = document.querySelector("#parking-map");
const parkingMapTitle = document.querySelector("#parking-map-title");
const mapViewControls = document.querySelector("#map-view-controls");
const mapFocusButton = document.querySelector("#map-focus-button");
const mapOverviewButton = document.querySelector("#map-overview-button");
// 表示倍率は利用者側だけの状態。保存された配置データには書き込まない。
let mapViewMode = "focus";
let renderedMap = null;
const updatedTime = document.querySelector("#updated-time");
const voiceGuideButton = document.querySelector("#voice-guide-button");
const retryButton = document.querySelector("#retry-button");
const endGuidanceButton = document.querySelector("#end-guidance-button");

/* =========================================================
   施設一覧・絞り込み・距離
   ========================================================= */

/** 選択肢を作り直し、指定した値を反映する。 */
function setSelectOptions(select, items, defaultLabel, selectedValue = "") {
  select.replaceChildren(new Option(defaultLabel, ""));
  items.forEach(([value, label]) => select.add(new Option(label, value)));
  select.value = selectedValue;
}

/** 空値を除き、施設データの値を日本語順で返す。 */
function getDistinctValues(facilities, key) {
  return [...new Set(facilities.map((facility) => facility[key]).filter(Boolean))].sort(
    (first, second) => first.localeCompare(second, "ja"),
  );
}

/** 研究対象施設から絞り込み項目を作る。 */
function initializeFilters() {
  setSelectOptions(
    prefectureFilter,
    getDistinctValues(FACILITIES, "prefecture").map((value) => [value, value]),
    ui("すべての都道府県", "All prefectures"),
    state.filters.prefecture,
  );
  setSelectOptions(
    categoryFilter,
    Object.entries(isEnglish() ? CATEGORY_LABELS_EN : CATEGORY_LABELS),
    ui("すべてのカテゴリ", "All categories"),
    state.filters.category,
  );
}

/** 現在の絞り込み条件に一致する施設を返す。 */
function getFilteredFacilities() {
  return FACILITIES.filter((facility) =>
    Object.entries(state.filters).every(
      ([key, value]) => !value || facility[key] === value,
    ),
  );
}

/** 緯度経度から直線距離をkmで求める。 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const toRadians = (degree) => (degree * Math.PI) / 180;
  const latitudeDifference = toRadians(lat2 - lat1);
  const longitudeDifference = toRadians(lon2 - lon1);
  const startLatitude = toRadians(lat1);
  const endLatitude = toRadians(lat2);

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;

  const clampedA = Math.min(1, Math.max(0, a));
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

/** 自宅テスト用の正確な座標は、このブラウザー端末内だけに保持する。 */
function readPrivateTestCoordinate() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRIVATE_TEST_COORDINATE_STORAGE_KEY) ?? "null");
    if (!saved || !Number.isFinite(saved.latitude) || !Number.isFinite(saved.longitude)) {
      return null;
    }
    return {
      latitude: saved.latitude,
      longitude: saved.longitude,
      accuracy: Number.isFinite(saved.accuracy) ? saved.accuracy : null,
      savedAt: saved.savedAt ?? null,
      source: "端末内テスト地点",
    };
  } catch {
    return null;
  }
}

/** 現在のGPS位置を公開せず端末内だけへ保存する。 */
function savePrivateTestCoordinate(location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return false;
  }
  try {
    localStorage.setItem(PRIVATE_TEST_COORDINATE_STORAGE_KEY, JSON.stringify({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

function clearPrivateTestCoordinate() {
  try {
    localStorage.removeItem(PRIVATE_TEST_COORDINATE_STORAGE_KEY);
  } catch {
    /* 保存領域を利用できない環境では何もしない。 */
  }
}

/** 自宅テスト用の端末内登録状態を条件画面へ反映する。 */
function updatePrivateTestLocationPanel() {
  const isPrivateTest = state.selectedFacility?.id === PRIVATE_TEST_FACILITY_ID;
  if (privateTestLocationPanel) privateTestLocationPanel.hidden = !isPrivateTest;
  if (!isPrivateTest || !privateTestLocationStatus) return;

  const saved = readPrivateTestCoordinate();
  if (!saved) {
    privateTestLocationStatus.textContent = ui(
      state.pendingPrivateTestCalibration
        ? "位置情報を取得中です。取得できしだい、この端末へテスト地点を登録します。"
        : "テスト地点はまだ登録されていません。",
      state.pendingPrivateTestCalibration
        ? "Getting your location. The test point will be saved on this device when a valid position is available."
        : "The test location has not been saved on this device.",
    );
    return;
  }

  const accuracyText = Number.isFinite(saved.accuracy)
    ? ui(` / 登録時精度 約${Math.round(saved.accuracy)}m`, ` / accuracy about ${Math.round(saved.accuracy)} m`)
    : "";
  privateTestLocationStatus.textContent = ui(
    `テスト地点をこの端末に登録済みです${accuracyText}。正確な座標は外部へ送信しません。`,
    `Test point saved on this device${accuracyText}. The exact coordinate is not uploaded.`,
  );
}

/**
 * 固定座標がない新規候補は、管理画面と同じ国土地理院住所検索で補完する。
 * 取得値はページ内メモリだけに保持し、施設マスター自体は書き換えない。
 */
async function ensureFacilityCoordinate(facility) {
  if (!facility || facility.id === PRIVATE_TEST_FACILITY_ID || facility.requiresLocalCalibration) {
    return getFacilityCoordinate(facility);
  }

  const existing = getFacilityCoordinate(facility);
  if (existing) return existing;

  if (state.resolvingFacilityCoordinates.has(facility.id)) {
    return state.resolvingFacilityCoordinates.get(facility.id);
  }

  const address = String(facility.address ?? "").trim();
  if (facility.locationVerified !== true || !address) {
    return null;
  }

  const task = (async () => {
    try {
      const response = await fetch(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;

      const data = await response.json();
      const candidates = Array.isArray(data) ? data : (data.features ?? []);
      const coordinates = candidates[0]?.geometry?.coordinates;
      const longitude = Number(coordinates?.[0]);
      const latitude = Number(coordinates?.[1]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const resolved = {
        latitude,
        longitude,
        source: "確認済み住所から国土地理院住所検索",
      };
      state.resolvedFacilityCoordinates.set(facility.id, resolved);
      updateFacilityDistances();
      if (state.selectedFacility?.id === facility.id) {
        updateProximityStatus();
        if (state.currentScreen === "waiting") updateWaitingScreen();
      }
      return resolved;
    } catch {
      return null;
    } finally {
      state.resolvingFacilityCoordinates.delete(facility.id);
    }
  })();

  state.resolvingFacilityCoordinates.set(facility.id, task);
  return task;
}

/**
 * 施設の代表座標を取得する。
 *
 * 優先順位：
 * 1. 公式MAP等から固定登録した施設座標
 * 2. 管理画面で確認済み住所から決定し、layout.backgroundへ保存した中心座標
 *
 * 店舗名だけを検索した曖昧な座標は使わない。
 */
function getFacilityCoordinate(facility) {
  if (facility?.id === PRIVATE_TEST_FACILITY_ID || facility?.requiresLocalCalibration) {
    const privateCoordinate = readPrivateTestCoordinate();
    if (privateCoordinate) return privateCoordinate;
  }

  const resolvedCoordinate = facility?.id
    ? state.resolvedFacilityCoordinates.get(facility.id)
    : null;
  if (resolvedCoordinate) {
    return resolvedCoordinate;
  }

  if (Number.isFinite(facility?.latitude) && Number.isFinite(facility?.longitude)) {
    return {
      latitude: facility.latitude,
      longitude: facility.longitude,
      source: facility.coordinateSource ?? "施設マスター",
    };
  }

  const layout = getFacilityLayout(facility);
  const background = layout?.background;
  if (
    background &&
    ["verified-coordinate", "verified-address", "manual-adjustment", "manual-coordinate"].includes(
      background.locatedBy,
    ) &&
    Number.isFinite(background.centerLat) &&
    Number.isFinite(background.centerLng)
  ) {
    return {
      latitude: background.centerLat,
      longitude: background.centerLng,
      source: background.coordinateSource ?? "管理レイアウト",
    };
  }

  return null;
}

/** 現在地と確認済み施設座標がそろっている場合だけ直線距離を返す。 */
function getFacilityDistance(facility) {
  if (!state.userLocation) {
    return facility.isDemo ? facility.demoDistance : null;
  }

  const coordinate = getFacilityCoordinate(facility);
  if (!coordinate) {
    return null;
  }

  return calculateDistanceKm(
    state.userLocation.latitude,
    state.userLocation.longitude,
    coordinate.latitude,
    coordinate.longitude,
  );
}

/** 施設カード内の距離表示を更新する。 */
function updateFacilityDistance(button, facility) {
  const distance = getFacilityDistance(facility);
  const distanceElement = button.querySelector(".facility-distance");

  if (distance === null) {
    distanceElement.textContent = getFacilityCoordinate(facility)
      ? ui("現在地を取得すると直線距離を表示", "Start location to show straight-line distance")
      : facility.id === PRIVATE_TEST_FACILITY_ID
        ? ui("選択後にテスト地点を端末内へ登録", "Select this facility, then save the test point on this device")
        : facility.locationVerified
          ? ui("住所確認済み・管理マップ位置の確定待ち", "Address verified; map coordinate pending")
          : ui("位置情報は管理データから追加予定", "Location data will be added later");
  } else {
    distanceElement.textContent = facility.isDemo && !state.userLocation
      ? ui(`参考距離 約${distance.toFixed(1)} km`, `Reference distance about ${distance.toFixed(1)} km`)
      : ui(`現在地から直線 約${distance.toFixed(1)} km`, `About ${distance.toFixed(1)} km straight-line from your location`);
  }

  button.setAttribute(
    "aria-label",
    `${getFacilityDisplayName(facility)}、${getCategoryLabel(facility.category)}、${distanceElement.textContent}`,
  );
}

/** 施設一覧を表示する。 */
function renderFacilities() {
  const filtered = getFilteredFacilities();
  const sorted = [...filtered];

  if (state.sortByDistance) {
    sorted.sort((first, second) => {
      const firstDistance = getFacilityDistance(first);
      const secondDistance = getFacilityDistance(second);
      return (firstDistance ?? Infinity) - (secondDistance ?? Infinity);
    });
  }

  facilityList.replaceChildren();
  facilityCount.textContent = isEnglish() ? `${sorted.length} facilities` : `${sorted.length}件`;
  facilityEmpty.hidden = sorted.length > 0;

  sorted.forEach((facility) => {
    const article = document.createElement("article");
    article.className = "facility-row";

    const button = document.createElement("button");
    button.className = "facility-button";
    button.type = "button";
    button.dataset.facilityId = facility.id;

    const main = document.createElement("span");
    main.className = "facility-main";

    const name = document.createElement("span");
    name.className = "facility-name";
    name.textContent = getFacilityDisplayName(facility);

    const meta = document.createElement("span");
    meta.className = "facility-meta";
    meta.textContent = [
      facility.prefecture,
      facility.municipality,
      getCategoryLabel(facility.category),
      facility.operatingStatus === "opening-scheduled" ? "開店予定" : "",
    ]
      .filter(Boolean)
      .join(" / ");

    const distance = document.createElement("span");
    distance.className = "facility-distance";

    const action = document.createElement("span");
    action.className = "facility-action";

    if (facility.operatingStatus === "opening-scheduled") {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      action.textContent = facility.plannedOpen === "2026-11" ? "2026年11月開業予定" : "開業予定";
    } else {
      action.textContent = ui("選択", "Select");
    }

    main.append(name, meta);
    if (facility.statusNote) {
      const status = document.createElement("span");
      status.className = "facility-status";
      status.textContent = facility.statusNote;
      main.append(status);
    }
    main.append(distance);
    button.append(main, action);
    article.append(button);
    facilityList.append(article);
    updateFacilityDistance(button, facility);
  });
}

/** GPS更新時は並び順を変えず、距離表示だけを更新する。 */
function updateFacilityDistances() {
  facilityList.querySelectorAll("[data-facility-id]").forEach((button) => {
    const facility = FACILITIES.find((item) => item.id === button.dataset.facilityId);
    if (facility) {
      updateFacilityDistance(button, facility);
    }
  });
}



/* =========================================================
   管理画面からのクラウドレイアウト取得
   ========================================================= */

// クラウドで削除された施設を過去の通信結果から復活させないよう、同梱分を分離する。
const bundledParkingLayouts = window.PARKING_LAYOUTS ?? {};
let remoteLayoutRequestId = 0;

/** Supabaseに保存された最新レイアウトを読み込み、同梱データより優先する。 */
async function loadRemoteParkingLayouts() {
  const config = window.PARKING_REMOTE_CONFIG ?? {};
  const url = String(config.supabaseUrl ?? "").replace(/\/$/, "");
  const publishableKey = String(config.publishableKey ?? "");
  if (config.enabled !== true || !/^https:\/\//.test(url) || publishableKey.length <= 10) {
    return;
  }

  const requestId = ++remoteLayoutRequestId;
  try {
    const response = await fetch(`${url}/rest/v1/parking_layouts?select=facility_id,layout_data,updated_at`, {
      headers: {
        apikey: publishableKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return;
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || requestId !== remoteLayoutRequestId) return;
    const layouts = { ...bundledParkingLayouts };
    rows.forEach((row) => {
      if (row?.facility_id && row.layout_data?.facilityId === row.facility_id
          && Array.isArray(row.layout_data.objects)
          && row.layout_data.objects.every((item) => item && typeof item === "object")) {
        layouts[row.facility_id] = row.layout_data;
      }
    });
    window.PARKING_LAYOUTS = layouts;
  } catch {
    /* 通信できない場合は同梱の parking-layouts.js を使う。 */
  }
}


/* =========================================================
   管理用Webアプリのレイアウトデータ連携
   ========================================================= */

/**
 * 管理画面と同じ店舗識別キーを生成する。
 * 店舗差し替え後にSupabaseや静的JSへ旧店舗レイアウトが残っていても、
 * 新店舗へ誤表示しないために使用する。
 */
function getFacilityIdentityKeyForUser(facility) {
  if (!facility) {
    return null;
  }
  return [
    facility.id,
    facility.name,
    facility.address ?? "",
    facility.facilityRevision ?? 1,
  ].join("|");
}

/** facilityId に対応する駐車場レイアウトを返す。 */
function getFacilityLayout(facility) {
  if (!facility || !window.PARKING_LAYOUTS) {
    return null;
  }
  const layout = window.PARKING_LAYOUTS[facility.layoutId ?? facility.id];
  if (!layout || layout.facilityId !== facility.id || !Array.isArray(layout.objects)) {
    return null;
  }

  /*
   * revision 2以上は対象店舗そのものを置換したID。
   * identityKeyが一致しない旧店舗レイアウトは使用しない。
   */
  if (Number(facility.facilityRevision) >= 2
      && layout.facilityIdentityKey !== getFacilityIdentityKeyForUser(facility)) {
    return null;
  }

  return layout;
}

/** 案内基準に使用できる建物出入口を取得する。 */
function getGuideEntrance(layout, facility) {
  if (!layout) return null;

  const entrances = layout.objects.filter((object) =>
    object.objectType === "buildingEntrance" &&
    object.publicAccess !== false &&
    Number.isFinite(object.x) &&
    Number.isFinite(object.y),
  );

  const targetBuildingId =
    state.selectedDestination?.buildingId ?? facility?.targetBuildingId ?? null;

  if (targetBuildingId) {
    const matching = entrances.filter(
      (entrance) => entrance.buildingId === targetBuildingId,
    );
    return matching.find((entrance) => entrance.guideTarget === true)
      ?? matching[0]
      ?? entrances.find((entrance) => entrance.guideTarget === true)
      ?? null;
  }

  return entrances.find((entrance) => entrance.guideTarget === true)
    ?? entrances[0]
    ?? null;
}

/** レイアウト上の2点間距離を計算する。 */
function calculateLayoutDistance(space, entrance, layout) {
  if (!space || !entrance) {
    return { score: Infinity, meters: null };
  }

  const centerX = space.x + (Number(space.width) || 0) / 2;
  const centerY = space.y + (Number(space.height) || 0) / 2;
  const pixels = Math.hypot(centerX - entrance.x, centerY - entrance.y);
  const scale = layout?.canvas?.scaleMetersPerPixel;

  return {
    score: pixels,
    meters: Number.isFinite(scale) && scale > 0 ? pixels * scale : null,
  };
}

/** 管理画面から登録された駐車区画を検索用データへ変換する。 */
function createLayoutParkingSpaces(layout, facility) {
  const entrance = getGuideEntrance(layout, facility);

  return layout.objects
    .filter((object) => object.objectType === "parkingSpace")
    .filter((object) => Number.isFinite(object.x) && Number.isFinite(object.y))
    .map((object, index) => {
      const distance = calculateLayoutDistance(object, entrance, layout);
      const status = object.status ?? "available";
      const width = Number(object.width) || 0;
      const height = Number(object.height) || 0;

      return {
        id: object.name || object.spaceNumber || object.uid || `区画${index + 1}`,
        uid: object.uid || `space_${index + 1}`,
        number: index + 1,
        isOccupied: status === "occupied" || status === "unavailable",
        isWide: object.spaceType === "accessible" || width > height * 0.65,
        spaceType: object.spaceType ?? "standard",
        entranceDistanceMeters: distance.meters,
        distanceScore: distance.score,
        sourceObject: object,
      };
    });
}

/** レイアウト未登録時に動作確認用の12区画を作る。 */
function createDemoParkingSpaces(searchSequence = state.searchSequence) {
  const baseOccupied = [2, 5, 8, 11];
  const shiftedOccupied = baseOccupied.map(
    (number) => ((number + searchSequence - 1) % 12) + 1,
  );
  const typeByNumber = new Map([
    [1, "accessible"],
    [3, "compact"],
    [4, "ev"],
    [7, "accessible"],
    [9, "compact"],
    [10, "ev"],
  ]);

  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    const distanceMeters = Math.max(20, 82 - number * 5);
    const spaceType = typeByNumber.get(number) ?? "standard";
    return {
      id: `B-${String(number).padStart(2, "0")}`,
      uid: `demo_b_${String(number).padStart(2, "0")}`,
      number,
      isOccupied: shiftedOccupied.includes(number),
      isWide: spaceType === "accessible",
      spaceType,
      entranceDistanceMeters: distanceMeters,
      distanceScore: distanceMeters,
      sourceObject: null,
    };
  });
}

/** 希望条件に合う空き区画を1件選ぶ。 */
function selectRecommendedSpace(spaces, priority, requestedSpaceType = "standard", randomize = false) {
  const availableSpaces = spaces.filter((space) =>
    !space.isOccupied && space.spaceType === requestedSpaceType,
  );
  if (availableSpaces.length === 0) {
    return null;
  }

  if (randomize) {
    return availableSpaces[Math.floor(Math.random() * availableSpaces.length)];
  }

  if (priority === "near") {
    return [...availableSpaces].sort(
      (first, second) => first.distanceScore - second.distanceScore,
    )[0];
  }

  if (priority === "wide") {
    return availableSpaces.find((space) => space.isWide) ?? availableSpaces[0];
  }

  const nearSpaces = [...availableSpaces].sort(
    (first, second) => first.distanceScore - second.distanceScore,
  );
  return nearSpaces.find((space) => space.isWide) ?? nearSpaces[0];
}

/** オブジェクトの描画サイズを管理画面と同じ保存値から取得する。 */
function getLayoutObjectSize(object) {
  const fallbackSizes = {
    buildingEntrance: [22, 22],
    parkingEntrance: [26, 26],
    noEntry: [26, 26],
    evCharger: [22, 22],
  };
  const fallback = fallbackSizes[object.objectType] ?? [70, 70];
  return {
    width: Number(object.width) > 0 ? Number(object.width) : fallback[0],
    height: Number(object.height) > 0 ? Number(object.height) : fallback[1],
  };
}

/** 管理画面と同じ中心回転を考慮した外接矩形を返す。 */
function getRotatedObjectBounds(object) {
  const { width, height } = getLayoutObjectSize(object);
  const x = Number(object.x) || 0;
  const y = Number(object.y) || 0;
  const angle = (Number(object.rotation) || 0) * Math.PI / 180;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const corners = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(([px, py]) => {
    const dx = px - centerX;
    const dy = py - centerY;
    return {
      x: centerX + dx * cosine - dy * sine,
      y: centerY + dx * sine + dy * cosine,
    };
  });
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

/**
 * 配置されていない外周余白を利用者画面だけでトリミングする。
 * 保存レイアウト自体は変更しないので管理画面の座標は保持される。
 */
function calculateLayoutCrop(layout, supportedTypes) {
  const canvasWidth = Number(layout.canvas?.width) || 1000;
  const canvasHeight = Number(layout.canvas?.height) || 700;
  const visibleObjects = (layout.objects ?? []).filter((object) =>
    supportedTypes.has(object.objectType));

  if (!visibleObjects.length) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }

  const bounds = visibleObjects.map(getRotatedObjectBounds);
  const logicalPadding = Math.max(18, Math.min(canvasWidth, canvasHeight) * 0.025);
  const minX = Math.max(0, Math.min(...bounds.map((item) => item.minX)) - logicalPadding);
  const minY = Math.max(0, Math.min(...bounds.map((item) => item.minY)) - logicalPadding);
  const maxX = Math.min(canvasWidth, Math.max(...bounds.map((item) => item.maxX)) + logicalPadding);
  const maxY = Math.min(canvasHeight, Math.max(...bounds.map((item) => item.maxY)) + logicalPadding);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * 案内区画と対象入口の両方が入る範囲を作り、画面と同じ縦横比に広げる。
 * 縦横を同じ倍率にするため、区画・道路の位置や回転は変形しない。
 * 余白は画面上のラベル分を確保する。端の区画でも番号が切れない。
 */
function calculateGuidanceViewport(layout, recommendedSpace, supportedTypes, entrance) {
  const screenWidth = parkingMap.clientWidth || 360;
  const screenHeight = parkingMap.clientHeight || 400;
  const aspect = screenWidth / screenHeight;
  const target = recommendedSpace?.sourceObject;
  const points = target ? [target, ...(entrance ? [entrance] : [])] : [];
  let bounds;
  if (mapViewMode === "focus" && points.length) {
    const boxes = points.map(getRotatedObjectBounds);
    bounds = {
      x: Math.min(...boxes.map((box) => box.minX)),
      y: Math.min(...boxes.map((box) => box.minY)),
      width: Math.max(...boxes.map((box) => box.maxX)) - Math.min(...boxes.map((box) => box.minX)),
      height: Math.max(...boxes.map((box) => box.maxY)) - Math.min(...boxes.map((box) => box.minY)),
    };
  } else {
    bounds = calculateLayoutCrop(layout, supportedTypes);
  }
  const horizontalPadding = Math.min(90, screenWidth * 0.28);
  const verticalPadding = 64;
  const width = Math.max(100, bounds.width) / Math.max(0.1, 1 - 2 * horizontalPadding / screenWidth);
  const height = Math.max(100, bounds.height) / Math.max(0.1, 1 - 2 * verticalPadding / screenHeight);
  const viewWidth = Math.max(width, height * aspect);
  const viewHeight = viewWidth / aspect;
  return {
    x: bounds.x + bounds.width / 2 - viewWidth / 2,
    y: bounds.y + bounds.height / 2 - viewHeight / 2,
    width: viewWidth,
    height: viewHeight,
    scale: screenWidth / viewWidth,
  };
}

/** 読める大きさの番号・入口ラベルを、回転させず実際の中心位置に付ける。 */
function appendGuidanceMarker(object, crop, kind, text) {
  const { width, height } = getLayoutObjectSize(object);
  const marker = document.createElement("div");
  marker.className = `guidance-map-marker guidance-map-marker--${kind}`;
  marker.style.left = `${((Number(object.x) + width / 2 - crop.x) / crop.width) * 100}%`;
  marker.style.top = `${((Number(object.y) + height / 2 - crop.y) / crop.height) * 100}%`;
  marker.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "guidance-map-label";
  if (kind === "space") {
    const caption = document.createElement("small");
    caption.textContent = ui("案内先", "Your space");
    const number = document.createElement("strong");
    number.textContent = text;
    label.append(caption, number);
  } else {
    label.textContent = text;
  }
  marker.append(label);
  parkingMap.append(marker);
}

/** 管理画面の配置を使い、案内に必要な情報を利用者向けに表示する。 */
function renderRegisteredLayout(layout, recommendedSpace) {
  parkingMap.replaceChildren();
  parkingMap.className = "parking-map parking-map--layout";
  parkingMapTitle.textContent = ui("駐車場マップ", "Parking map");

  if (renderedMap?.layout !== layout || renderedMap?.space?.uid !== recommendedSpace?.uid) {
    mapViewMode = "focus";
  }
  renderedMap = { layout, space: recommendedSpace };
  mapViewControls.hidden = false;
  mapFocusButton.textContent = ui("案内先を拡大", "Focus on space");
  mapOverviewButton.textContent = ui("全体を見る", "Show overview");
  mapFocusButton.setAttribute("aria-pressed", String(mapViewMode === "focus"));
  mapOverviewButton.setAttribute("aria-pressed", String(mapViewMode === "overview"));

  const polygonTypes = new Set([
    "parkingLot",
    "excludedParkingLot",
    "building",
    "road",
    "nationalRoad",
    "prefecturalRoad",
    "publicRoad",
  ]);

  const supportedTypes = new Set([
    "parkingLot",
    "excludedParkingLot",
    "nationalRoad",
    "prefecturalRoad",
    "publicRoad",
    "road",
    "sidewalk",
    "crosswalk",
    "building",
    "parkingSpace",
    "buildingEntrance",
    "parkingEntrance",
    "stopLine",
    "speedBump",
    "noEntry",
    "cartCorral",
    "bicycleParking",
    "motorcycleParking",
    "loadingZone",
    "evCharger",
  ]);

  const entrance = state.guideEntrance;
  const crop = calculateGuidanceViewport(layout, recommendedSpace, supportedTypes, entrance);
  parkingMap.removeAttribute("style");
  parkingMap.dataset.cropped = "true";
  parkingMap.dataset.viewMode = mapViewMode;
  parkingMap.setAttribute("aria-label", ui(
    `駐車場マップ。案内先 ${recommendedSpace?.id ?? ""}。${entrance ? "対象の店舗入口を表示しています。" : "案内対象の入口は未登録です。"}`,
    `Parking map. Your space: ${recommendedSpace?.id ?? ""}. ${entrance ? "The destination entrance is shown." : "No destination entrance is registered."}`,
  ));

  layout.objects
    .filter((object) => supportedTypes.has(object.objectType))
    .forEach((object) => {
      const item = document.createElement("div");
      item.className = `map-object map-object--${object.objectType}`;
      item.dataset.objectType = object.objectType;
      /*
       * 管理画面と同じ仕様：x/y は常にオブジェクト外接矩形の左上。
       * 小型設備も中心座標へ変換せず、同じwidth/height/rotationを比率縮小する。
       */
      item.style.left = `${(((Number(object.x) || 0) - crop.x) / crop.width) * 100}%`;
      item.style.top = `${(((Number(object.y) || 0) - crop.y) / crop.height) * 100}%`;

      const { width: objectWidth, height: objectHeight } = getLayoutObjectSize(object);
      const hasSize = Number.isFinite(objectWidth) && Number.isFinite(objectHeight)
        && objectWidth > 0 && objectHeight > 0;

      if (hasSize) {
        item.style.width = `${(objectWidth / crop.width) * 100}%`;
        item.style.height = `${(objectHeight / crop.height) * 100}%`;
        item.style.transform = `rotate(${Number(object.rotation) || 0}deg)`;

        if (polygonTypes.has(object.objectType)) {
          const points = Array.isArray(object.polygonPoints) && object.polygonPoints.length >= 3
            ? object.polygonPoints
            : [
                { x: 0, y: 0 },
                { x: objectWidth, y: 0 },
                { x: objectWidth, y: objectHeight },
                { x: 0, y: objectHeight },
              ];

          item.classList.add("map-object--polygon");
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.classList.add("user-polygon-shape");
          svg.setAttribute("viewBox", `0 0 ${objectWidth} ${objectHeight}`);
          svg.setAttribute("preserveAspectRatio", "none");
          const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          polygon.classList.add("user-polygon-fill");
          polygon.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
          svg.append(polygon);
          item.append(svg);
        }
      }

      const appendLabel = (text) => {
        if (!text) return;
        const label = document.createElement("span");
        label.className = "map-object-label";
        label.textContent = text;
        item.append(label);
      };

      if (object.objectType === "parkingSpace") {
        item.dataset.spaceType = object.spaceType ?? "standard";
        item.dataset.markingStyle = object.markingStyle ?? "uShape";
        item.style.setProperty("--space-line-color", object.markingColor ?? "#ffffff");
        item.style.setProperty("--space-line-width", `${Math.max(1, Number(object.markingWidth) || 2)}px`);

        const typeMark = document.createElement("span");
        typeMark.className = "space-type-mark";
        typeMark.setAttribute("aria-hidden", "true");
        if (object.spaceType === "compact") typeMark.textContent = "軽";
        if (object.spaceType === "accessible") typeMark.textContent = "♿";
        if (object.spaceType === "ev") typeMark.textContent = "EV";
        if (typeMark.textContent && Math.min(objectWidth, objectHeight) * crop.scale >= 24) {
          item.append(typeMark);
        }

        const isRecommended = object.uid === recommendedSpace?.uid;
        const isOccupied = object.status === "occupied" || object.status === "unavailable";
        item.classList.toggle("is-occupied", isOccupied);
        item.classList.toggle("is-recommended", isRecommended);
        item.setAttribute("role", "listitem");
        item.setAttribute(
          "aria-label",
          `${object.name || object.spaceNumber || "区画"}、${isRecommended ? "案内先" : isOccupied ? "使用中" : "空き"}`,
        );
      } else if (object.objectType === "buildingEntrance") {
        // 非公開入口は利用者の入口表示から除く。対象入口だけに大きいラベルを付ける。
        if (object.publicAccess === false) return;
        item.setAttribute("aria-label", object.name || ui("建物入口", "Building entrance"));
        item.classList.toggle("is-guide-entrance", object.uid === entrance?.uid);
      } else if (object.objectType === "parkingEntrance") {
        const accessLabel = object.accessType === "entrance"
          ? "入口"
          : object.accessType === "exit"
            ? "出口"
            : "出入口";
        const defaultNames = new Set(["駐車場入口", "駐車場出口", "駐車場出入口"]);
        const customName = String(object.name ?? "").trim();
        appendLabel(customName && !defaultNames.has(customName)
          ? `${accessLabel}｜${customName}`
          : `駐車場${accessLabel}`);
        item.dataset.accessType = object.accessType ?? "both";
      } else if (object.objectType === "road") {
        if (object.trafficDirection === "oneWay") {
          appendLabel(object.name || "一方通行");
          item.dataset.trafficDirection = "oneWay";
        }
      } else if (object.objectType === "noEntry") {
        appendLabel(object.name || "進入禁止");
      } else if (object.objectType === "evCharger") {
        appendLabel(object.name || "EV充電");
      } else if (["stopLine", "speedBump", "cartCorral", "bicycleParking",
        "motorcycleParking", "loadingZone", "building", "parkingLot"].includes(object.objectType)) {
        // 形状を残し、管理用の名称・コピー名は利用者マップへ表示しない。
      } else if (object.objectType === "excludedParkingLot") {
        appendLabel(object.name || "対象外駐車場");
      } else if (object.objectType === "nationalRoad") {
        appendLabel(object.name || "国道");
      } else if (object.objectType === "prefecturalRoad") {
        appendLabel(object.name || "県道");
      } else if (object.objectType === "publicRoad") {
        appendLabel(object.name || "公道");
      }

      parkingMap.append(item);
    });
  if (recommendedSpace?.sourceObject) {
    const object = recommendedSpace.sourceObject;
    const number = object.spaceNumber ?? String(object.name ?? "").match(/(\d{1,4})$/)?.[1];
    appendGuidanceMarker(object, crop, "space", number != null
      ? String(number).padStart(3, "0") : recommendedSpace.id);
  }
  if (entrance) {
    appendGuidanceMarker(entrance, crop, "entrance", ui("店舗入口", "Store entrance"));
  }

}

/** レイアウト未登録時の研究用区画図を表示する。 */
function renderDemoParkingMap(spaces, recommendedSpace) {
  renderedMap = null;
  mapViewControls.hidden = true;
  delete parkingMap.dataset.viewMode;
  delete parkingMap.dataset.cropped;
  parkingMap.setAttribute("aria-label", ui("デモ駐車区画", "Demo parking spaces"));
  parkingMap.replaceChildren();
  parkingMap.className = "parking-map parking-map--demo";
  parkingMap.removeAttribute("style");
  parkingMapTitle.textContent = ui("デモ区画図", "Demo parking spaces");

  spaces.forEach((space) => {
    const item = document.createElement("div");
    const isRecommended = space.id === recommendedSpace.id;
    let status = "空き";

    item.className = "parking-space";
    if (space.isOccupied) {
      item.classList.add("is-occupied");
      status = "使用中";
    }
    if (isRecommended) {
      item.classList.add("is-recommended");
      status = "案内先";
    }

    item.innerHTML = '<span class="parking-space-number"></span><span class="parking-space-state"></span>';
    item.querySelector(".parking-space-number").textContent = space.id;
    item.querySelector(".parking-space-state").textContent = status;
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-label", `${space.id}、${status}`);
    parkingMap.append(item);
  });
}

/** 登録レイアウトがあれば実マップ、なければデモ図を表示する。 */
function renderParkingMap(spaces, recommendedSpace, layout) {
  if (layout && spaces.some((space) => space.sourceObject)) {
    renderRegisteredLayout(layout, recommendedSpace);
  } else {
    renderDemoParkingMap(spaces, recommendedSpace);
  }
}

/** 表示範囲の変更は検索や空き状況の更新を行わず、現在の案内先を維持する。 */
function setMapViewMode(mode) {
  if (!renderedMap) return;
  mapViewMode = mode;
  renderRegisteredLayout(renderedMap.layout, renderedMap.space);
}
mapFocusButton.addEventListener("click", () => setMapViewMode("focus"));
mapOverviewButton.addEventListener("click", () => setMapViewMode("overview"));

// スマホの回転・文字拡大・非表示画面からの復帰でも同じ縦横倍率で再配置する。
if ("ResizeObserver" in window) {
  let mapResizeFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(mapResizeFrame);
    mapResizeFrame = requestAnimationFrame(() => {
      if (renderedMap && parkingMap.clientWidth && parkingMap.clientHeight) {
        renderRegisteredLayout(renderedMap.layout, renderedMap.space);
      }
    });
  });
  observer.observe(parkingMap);
}

/* =========================================================
   画面遷移・検索
   ========================================================= */

/** 指定した4画面（施設・条件・待機・区画）のうち1画面だけを表示する。 */
function showScreen(screenName, options = {}) {
  const { addHistory = true, moveFocus = true } = options;
  if (!SCREEN_ORDER.includes(screenName)) {
    return;
  }

  if (screenName !== state.currentScreen && screenName !== "result") {
    state.searchRequestId += 1;
    cancelSpeech();
  }
  if (screenName === "facility" || screenName === "condition") {
    state.autoProximityArmed = false;
    state.autoTriggeredFacilityId = null;
  }

  document.querySelectorAll("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== screenName;
  });

  const currentIndex = SCREEN_ORDER.indexOf(screenName);
  document.querySelectorAll("[data-progress]").forEach((item) => {
    const itemIndex = SCREEN_ORDER.indexOf(item.dataset.progress);
    item.classList.toggle("is-current", itemIndex === currentIndex);
    item.classList.toggle("is-complete", itemIndex < currentIndex);
    if (itemIndex === currentIndex) {
      item.setAttribute("aria-current", "step");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  state.currentScreen = screenName;
  if (screenName === "facility") {
    renderFacilities();
  }

  if (addHistory) {
    window.history.pushState({ screen: screenName }, "", `#${screenName}`);
  }

  window.scrollTo({ top: 0, behavior: "auto" });
  if (moveFocus && !document.querySelector("#driving-dialog")?.open) {
    document.querySelector(`#${screenName}-title`)?.focus();
  }
}

/** 複合施設だけ目的店舗選択を表示する。 */
function updateDestinationPanel() {
  const facility = state.selectedFacility;
  const destinations = Array.isArray(facility?.destinations) ? facility.destinations : [];
  const isCompound = destinations.length > 0;

  destinationFieldset.hidden = !isCompound;
  destinationSelect.required = isCompound;
  destinationSelect.replaceChildren(
    new Option(ui("目的店舗を選択", "Select a destination store"), ""),
  );

  destinations.forEach((destination) => {
    destinationSelect.add(new Option(destination.name, destination.id));
  });

  if (isCompound && state.selectedDestination
      && destinations.some((item) => item.id === state.selectedDestination.id)) {
    destinationSelect.value = state.selectedDestination.id;
  } else {
    state.selectedDestination = null;
    destinationSelect.value = "";
  }
}

/** 現在のプルダウンから目的店舗を状態へ反映する。 */
function saveSelectedDestination() {
  const destinations = state.selectedFacility?.destinations ?? [];
  state.selectedDestination = destinations.find(
    (destination) => destination.id === destinationSelect.value,
  ) ?? null;
}

function updateRandomGuidanceNote() {
  if (!randomGuidanceNote || !state.selectedFacility) return;
  const random = RANDOM_GUIDANCE_FACILITY_IDS.has(state.selectedFacility.id);
  randomGuidanceNote.hidden = !random;
  if (random) {
    randomGuidanceNote.textContent = ui(
      `${getFacilityDisplayName(state.selectedFacility)}では、条件に合う空き区画から研究用にランダムで1区画を案内します。`,
      `For ${getFacilityDisplayName(state.selectedFacility)}, this prototype selects one matching available space at random.`,
    );
  }
}

/** Google Maps検索URLを施設情報から生成する。 */
function getFacilityGoogleMapsUrl(facility) {
  if (!facility) return null;

  if (facility.id === PRIVATE_TEST_FACILITY_ID) {
    const coordinate = readPrivateTestCoordinate();
    if (!coordinate) return null;
    const query = `${coordinate.latitude},${coordinate.longitude}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  const address = String(facility.address ?? "").trim();
  const destination = state.selectedDestination?.name;
  const query = [
    destination || getFacilityDisplayName(facility),
    address,
  ].filter(Boolean).join(" ");
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 自動案内の待機画面へ施設情報・条件・Google Mapsリンクを反映する。 */
function updateWaitingScreen() {
  const facility = state.selectedFacility;
  if (!facility) return;

  waitingFacilityName.textContent = getFacilityDisplayName(facility);
  waitingFacilityAddress.textContent = facility.id === PRIVATE_TEST_FACILITY_ID
    ? ui(
        "自宅テスト用（正確な位置はこの端末内に保存）",
        "Home test facility (exact location stored only on this device)",
      )
    : (facility.address || ui("住所未登録", "Address not registered"));
  waitingSpaceType.textContent = getSpaceTypeLabel(state.requestedSpaceType);
  waitingPriority.textContent = RANDOM_GUIDANCE_FACILITY_IDS.has(facility.id)
    ? ui("ランダム", "Random")
    : getPriorityLabel(state.selectedPriority);
  const destinationName = getSelectedDestinationName();
  waitingDestinationRow.hidden = !destinationName;
  waitingDestinationName.textContent = destinationName ?? "";

  const mapsUrl = getFacilityGoogleMapsUrl(facility);
  if (mapsUrl) {
    waitingGoogleMapsLink.href = mapsUrl;
    waitingGoogleMapsLink.hidden = false;
  } else {
    waitingGoogleMapsLink.removeAttribute("href");
    waitingGoogleMapsLink.hidden = true;
  }
  waitingGoogleMapsNote.hidden = facility.id !== PRIVATE_TEST_FACILITY_ID || !mapsUrl;
}

/** 条件画面と待機画面へ同じ接近状態を表示する。 */
function setProximityMessage(message) {
  if (proximityStatus) proximityStatus.textContent = message;
  if (waitingProximityStatus) waitingProximityStatus.textContent = message;
}

/** 条件画面の入力内容を検索状態へ保存する。 */
function saveSearchConditions() {
  const checkedPriority = conditionForm.querySelector('input[name="priority"]:checked');
  const checkedSpaceType = conditionForm.querySelector('input[name="spaceType"]:checked');
  state.selectedPriority = checkedPriority?.value ?? "balanced";
  state.requestedSpaceType = checkedSpaceType?.value ?? "standard";
  state.voiceEnabled = voiceEnabledInput?.checked !== false;
  const checkedGuidanceVoice = guidanceVoiceInputs.find((input) => input.checked);
  const selectedGuidanceLanguage = checkedGuidanceVoice?.value ?? "en-US";
  state.guidanceVoiceLanguage = ["en-US", "en-GB", "zh-CN", "ko-KR", "es-ES"]
    .includes(selectedGuidanceLanguage)
    ? selectedGuidanceLanguage
    : "en-US";
  saveSelectedDestination();
}

/** 選択施設までの実測距離を返す。位置情報がない場合はnull。 */
function getSelectedFacilityProximityKm() {
  if (!state.userLocation || !state.selectedFacility) {
    return null;
  }
  const coordinate = getFacilityCoordinate(state.selectedFacility);
  if (!coordinate) {
    return null;
  }
  return calculateDistanceKm(
    state.userLocation.latitude,
    state.userLocation.longitude,
    coordinate.latitude,
    coordinate.longitude,
  );
}

/** 接近監視中の状態を条件画面へ表示する。 */
function updateProximityStatus() {
  if (!proximityStatus && !waitingProximityStatus) return;

  if (!state.autoProximityArmed || !state.selectedFacility) {
    setProximityMessage(ui(
      "まだ自動案内を開始していません。",
      "Automatic guidance has not started.",
    ));
    return;
  }

  if (!state.userLocation) {
    setProximityMessage(ui(
      "位置情報を待っています。ブラウザーで位置情報を許可してください。",
      "Waiting for location. Please allow location access in your browser.",
    ));
    return;
  }

  const distanceKm = getSelectedFacilityProximityKm();
  if (distanceKm === null) {
    setProximityMessage(state.selectedFacility.id === PRIVATE_TEST_FACILITY_ID
      ? ui(
          "自宅テスト地点をこの端末に登録すると、250m接近時の自動案内を利用できます。",
          "Save the home test point on this device to use automatic guidance within 250 m.",
        )
      : ui(
          "この施設の位置座標を確認できないため、自動案内を開始できません。",
          "Automatic guidance cannot start because this facility does not have a confirmed coordinate.",
        ));
    return;
  }

  const meters = Math.round(distanceKm * 1000);
  const accuracy = Number(state.userLocation.accuracy);
  const accuracyText = Number.isFinite(accuracy)
    ? ui(`（測位精度 約${Math.round(accuracy)}m）`, ` (accuracy about ${Math.round(accuracy)} m)`)
    : "";

  setProximityMessage(meters <= AUTO_GUIDANCE_DISTANCE_KM * 1000
    ? ui(
        `施設付近です。空き区画を確認しています…${accuracyText}`,
        `You are near the facility. Checking available spaces…${accuracyText}`,
      )
    : ui(
        `施設まで直線約${meters}m。約250m以内で自動案内を開始します。${accuracyText}`,
        `About ${meters} m straight-line to the facility. Guidance will start automatically within about 250 m.${accuracyText}`,
      ));
}

/**
 * 位置情報更新時に接近判定を行う。
 * 同じ施設では1回だけ自動表示し、GPS精度が著しく低い測位では発火させない。
 */
async function checkAutomaticProximitySearch() {
  updateProximityStatus();

  if (!state.autoProximityArmed
      || !state.selectedFacility
      || !state.userLocation
      || state.proximitySearchRunning
      || state.autoTriggeredFacilityId === state.selectedFacility.id) {
    return;
  }

  const accuracy = Number(state.userLocation.accuracy);
  if (Number.isFinite(accuracy) && accuracy > AUTO_GUIDANCE_MAX_ACCURACY_METERS) {
    return;
  }

  const distanceKm = getSelectedFacilityProximityKm();
  if (distanceKm === null || distanceKm > AUTO_GUIDANCE_DISTANCE_KM) {
    return;
  }

  state.proximitySearchRunning = true;
  state.autoTriggeredFacilityId = state.selectedFacility.id;
  try {
    await runSpaceSearch(null, { autoTriggered: true, skipSafetyGuard: true });
  } finally {
    state.proximitySearchRunning = false;
  }
}

/** 選択施設に応じて登録済みレイアウトまたはデモ区画を準備する。 */
function prepareSpaces(facility) {
  const layout = getFacilityLayout(facility);
  if (layout) {
    const spaces = createLayoutParkingSpaces(layout, facility);
    if (spaces.length > 0) {
      return {
        layout,
        spaces,
        entrance: getGuideEntrance(layout, facility),
        isSimulation: false,
      };
    }
  }

  return {
    layout: null,
    spaces: createDemoParkingSpaces(),
    entrance: null,
    isSimulation: true,
  };
}

/** 空き区画検索を実行する。 */
async function runSpaceSearch(priorityOverride = null, options = {}) {
  const { autoTriggered = false, skipSafetyGuard = false } = options;
  // 通信を待つ前に依頼元を固定し、戻る操作・施設変更・再検索で無効化する。
  const requestId = ++state.searchRequestId;
  const facility = state.selectedFacility;
  await loadRemoteParkingLayouts();
  if (requestId !== state.searchRequestId || state.selectedFacility !== facility) {
    return { cancelled: true };
  }
  if (!skipSafetyGuard && window.parkingSafety && !window.parkingSafety.guardOperation()) {
    return { cancelled: true };
  }
  if (!state.selectedFacility) {
    showScreen("facility");
    return { cancelled: true };
  }

  saveSearchConditions();
  state.selectedPriority = priorityOverride ?? state.selectedPriority ?? "balanced";

  const matchingRadio = conditionForm.querySelector(
    `input[name="priority"][value="${state.selectedPriority}"]`,
  );
  if (matchingRadio) matchingRadio.checked = true;

  const priority = state.selectedPriority;
  state.recommendedSpace = null;

  if (state.currentScreen !== "result") {
    showScreen("result", { moveFocus: !autoTriggered });
  }
  resultContent.hidden = true;
  searchStatus.textContent = ui("空き区画を確認しています…", "Checking available spaces…");

  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (requestId !== state.searchRequestId || state.selectedFacility !== facility) {
        resolve({ cancelled: true });
        return;
      }

      const prepared = prepareSpaces(facility);
      if (prepared.isSimulation) {
        prepared.spaces = createDemoParkingSpaces(state.searchSequence);
      }

      state.currentLayout = prepared.layout;
      state.currentSpaces = prepared.spaces;
      state.guideEntrance = prepared.entrance;
      const useRandomGuidance = RANDOM_GUIDANCE_FACILITY_IDS.has(facility.id);
      state.recommendedSpace = selectRecommendedSpace(
        prepared.spaces,
        priority,
        state.requestedSpaceType,
        useRandomGuidance,
      );

      if (!state.recommendedSpace) {
        searchStatus.textContent = ui(
          `${getSpaceTypeLabel(state.requestedSpaceType)}で案内できる空き区画がありません。`,
          `No available ${getSpaceTypeLabel(state.requestedSpaceType)} space can be recommended.`,
        );
        resolve({ facility: facility.name, spaceId: null, priority, spaceType: state.requestedSpaceType });
        return;
      }

      spaceNumber.textContent = state.recommendedSpace.id;
      priorityBadge.textContent = RANDOM_GUIDANCE_FACILITY_IDS.has(facility.id)
        ? `${getSpaceTypeLabel(state.requestedSpaceType)} / ${ui("ランダム", "Random")}`
        : `${getSpaceTypeLabel(state.requestedSpaceType)} / ${getPriorityLabel(priority)}`;

      if (prepared.isSimulation) {
        spaceDescription.textContent = ui(
          `店舗入口まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m（シミュレーション）`,
          `About ${Math.round(state.recommendedSpace.entranceDistanceMeters)} m to the entrance (simulation)`,
        );
        searchStatus.textContent = ui(
          `${getFacilityDisplayName(facility)}の研究用シミュレーション結果です。`,
          `Research simulation result for ${getFacilityDisplayName(facility)}.`,
        );
      } else if (!prepared.entrance) {
        // 入口がない場合、Infinityの比較結果を距離による案内と説明しない。
        spaceDescription.textContent = ui(
          "案内対象の店舗入口が未登録のため、入口までの距離は表示できません。",
          "Distance is unavailable because no destination entrance is registered.",
        );
        searchStatus.textContent = ui(
          `${getFacilityDisplayName(facility)}の登録レイアウトから案内先を選びました。`,
          `A parking space was selected from the registered layout for ${getFacilityDisplayName(facility)}.`,
        );
      } else if (Number.isFinite(state.recommendedSpace.entranceDistanceMeters)) {
        const entranceName = prepared.entrance?.name || "建物入口";
        spaceDescription.textContent = ui(
          `${entranceName}まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m`,
          `About ${Math.round(state.recommendedSpace.entranceDistanceMeters)} m to the entrance`,
        );
        searchStatus.textContent = ui(
          `${getFacilityDisplayName(facility)}の登録レイアウトから案内先を選びました。`,
          `A parking space was selected from the registered layout for ${getFacilityDisplayName(facility)}.`,
        );
      } else {
        const entranceName = prepared.entrance?.name || "建物入口";
        spaceDescription.textContent = ui(
          `${entranceName}とのレイアウト上の距離を比較して選択`,
          "Selected by comparing the layout distance to the entrance",
        );
        searchStatus.textContent = ui(
          `${getFacilityDisplayName(facility)}の登録レイアウトから案内先を選びました。`,
          `A parking space was selected from the registered layout for ${getFacilityDisplayName(facility)}.`,
        );
      }

      if (RANDOM_GUIDANCE_FACILITY_IDS.has(facility.id)) {
        searchStatus.textContent = ui(
          `${getFacilityDisplayName(facility)}では研究用として、条件に合う空き区画からランダムに案内しています。`,
          `For ${getFacilityDisplayName(facility)}, this prototype randomly selects one matching available space.`,
        );
      }
      if (autoTriggered) {
        searchStatus.textContent = ui(
          `${getFacilityDisplayName(facility)}への接近を検知して案内先を自動表示しました。運転中は画面を操作しないでください。`,
          `You are near ${getFacilityDisplayName(facility)}. Parking guidance was displayed automatically. Do not operate the screen while driving.`,
        );
      }

      updatedTime.textContent = new Intl.DateTimeFormat(isEnglish() ? "en-US" : "ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());

      renderParkingMap(prepared.spaces, state.recommendedSpace, prepared.layout);
      resultContent.hidden = false;
      state.lastSearchWasAuto = autoTriggered;

      if (state.voiceEnabled) {
        speakCurrentGuidance();
      }

      resolve({
        facility: facility.name,
        spaceId: state.recommendedSpace.id,
        priority,
        spaceType: state.requestedSpaceType,
        autoTriggered,
        simulation: prepared.isSimulation,
      });
    }, 350);
  });
}

/** 案内先の番号部分を読み上げ用に整える。 */
function getSpokenSpaceId(space) {
  if (!space) return "";
  const raw = String(space.sourceObject?.spaceNumber ?? space.id ?? "");
  return raw.replace(/^0+/, "") || raw;
}

/** SpeechSynthesisが提供する音声一覧を返す。 */
function getSpeechVoices() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices?.() ?? [];
}

/**
 * Chromeでは音声一覧が初回表示直後に空のことがあるため、
 * voiceschanged または短い再試行で音声一覧の準備を待つ。
 */
async function waitForSpeechVoices(timeoutMs = 15000) {
  const initial = getSpeechVoices();
  if (initial.length) return initial;

  return new Promise((resolve) => {
    let finished = false;
    const started = Date.now();

    const finish = () => {
      if (finished) return;
      const voices = getSpeechVoices();
      if (voices.length || Date.now() - started >= timeoutMs) {
        finished = true;
        window.speechSynthesis?.removeEventListener?.("voiceschanged", onVoicesChanged);
        resolve(voices);
      }
    };

    const onVoicesChanged = () => finish();
    window.speechSynthesis?.addEventListener?.("voiceschanged", onVoicesChanged);

    const timer = window.setInterval(() => {
      finish();
      if (finished) window.clearInterval(timer);
    }, 120);

    window.setTimeout(() => {
      finish();
      window.clearInterval(timer);
    }, timeoutMs);
  });
}

/** 日本語では名称が「Google 日本語」の音声を直接最優先する。 */
function getJapaneseSpeechVoice(voices = getSpeechVoices()) {
  const directGoogle = voices.find((voice) =>
    /^(google\s*)?(日本語|japanese)$/i.test(String(voice.name).trim())
      || /google.*(日本語|japanese)/i.test(String(voice.name))
  );
  if (directGoogle) return directGoogle;

  const japanese = voices.filter(
    (voice) => String(voice.lang ?? "").toLowerCase().startsWith("ja"),
  );

  return japanese.find((voice) => /google/i.test(String(voice.name)))
    ?? japanese[0]
    ?? null;
}

/** 指定した言語・地域に一致するGoogle音声を最優先する。 */
function getGuidanceSpeechVoice(voices = getSpeechVoices()) {
  const locale = state.guidanceVoiceLanguage || "en-US";
  const normalizedLocale = locale.toLowerCase();
  const languagePrefix = normalizedLocale.split("-")[0];

  const localeSpecificPatterns = {
    "en-US": /google.*(us|united states).*english|google us english|google.*english.*us/i,
    "en-GB": /google.*(uk|united kingdom).*english|google uk english|google.*english.*uk/i,
    "zh-CN": /google.*(普通话|普通話|mandarin|chinese|中文|中国)/i,
    "ko-KR": /google.*(한국|한국어|korean|대한민국)/i,
    "es-ES": /google.*(español|spanish|españa|castellano)/i,
  };

  const namePattern = localeSpecificPatterns[locale];
  if (namePattern) {
    const byName = voices.find((voice) =>
      namePattern.test(String(voice.name))
        && String(voice.lang ?? "").toLowerCase().startsWith(languagePrefix)
    );
    if (byName) return byName;
  }

  const languageVoices = voices.filter(
    (voice) => String(voice.lang ?? "").toLowerCase().startsWith(languagePrefix),
  );

  return languageVoices.find((voice) =>
    String(voice.lang ?? "").toLowerCase() === normalizedLocale
      && /google/i.test(String(voice.name))
  )
    ?? languageVoices.find((voice) => /google/i.test(String(voice.name)))
    ?? languageVoices.find((voice) =>
      String(voice.lang ?? "").toLowerCase() === normalizedLocale
    )
    ?? languageVoices[0]
    ?? null;
}

/** 現在の表示言語と音声案内言語に対応する音声を返す。 */
function getSelectedSpeechVoice(voices = getSpeechVoices()) {
  return isEnglish()
    ? getGuidanceSpeechVoice(voices)
    : getJapaneseSpeechVoice(voices);
}

/** 読み上げに使用するBCP 47言語タグを返す。 */
function getGuidanceSpeechLocale() {
  if (!isEnglish()) return "ja-JP";
  return state.guidanceVoiceLanguage || "en-US";
}

/** 音声案内言語に応じた読み上げ速度を返す。 */
function getGuidanceSpeechRate() {
  if (!isEnglish()) return 1.00;
  if (state.guidanceVoiceLanguage === "en-US"
      || state.guidanceVoiceLanguage === "en-GB") {
    return 0.90;
  }
  return 0.95;
}

/** 音声案内用の駐車区画種別ラベルを返す。 */
function getSpokenSpaceTypeLabel(type) {
  const locale = getGuidanceSpeechLocale();

  const labels = {
    "ja-JP": {
      standard: "普通車区画",
      compact: "軽・小型車区画",
      accessible: "車椅子使用者用区画",
      ev: "EV充電区画",
    },
    "en-US": {
      standard: "standard parking space",
      compact: "compact parking space",
      accessible: "accessible parking space",
      ev: "electric vehicle charging space",
    },
    "en-GB": {
      standard: "standard parking space",
      compact: "compact parking space",
      accessible: "accessible parking space",
      ev: "electric vehicle charging space",
    },
    "zh-CN": {
      standard: "普通车位",
      compact: "小型车车位",
      accessible: "无障碍车位",
      ev: "电动车充电车位",
    },
    "ko-KR": {
      standard: "일반 주차구역",
      compact: "경차 주차구역",
      accessible: "장애인 전용 주차구역",
      ev: "전기차 충전 주차구역",
    },
    "es-ES": {
      standard: "plaza de aparcamiento estándar",
      compact: "plaza para vehículo compacto",
      accessible: "plaza de aparcamiento accesible",
      ev: "plaza para vehículo eléctrico",
    },
  };

  return labels[locale]?.[type]
    ?? getSpaceTypeLabel(type);
}

/** 日本語固定 / English表示時の多言語音声選択を同期する。 */
function updateVoiceModeUi() {
  const english = isEnglish();

  if (englishVoiceRow) {
    englishVoiceRow.hidden = !english;
    englishVoiceRow.style.display = english ? "grid" : "none";
  }

  guidanceVoiceInputs.forEach((input) => {
    input.checked = input.value === state.guidanceVoiceLanguage;
  });

  if (voiceModeLabel) {
    voiceModeLabel.textContent = english
      ? ui("音声案内言語", "Voice guidance language")
      : ui("日本語：Google 日本語（固定）", "Japanese: Google Japanese (fixed)");
  }

  updateVoiceStatus();
}

/** 音声案内ロケールの表示名を返す。 */
function getGuidanceLanguageDisplayName(locale = getGuidanceSpeechLocale()) {
  const labels = {
    "ja-JP": "日本語",
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "zh-CN": "中文",
    "ko-KR": "한국어",
    "es-ES": "Español",
  };
  return labels[locale] ?? locale;
}

/** 選択言語の音声が端末に存在しない場合の表示文。 */
function getMissingVoiceMessage(locale = getGuidanceSpeechLocale()) {
  const languageName = getGuidanceLanguageDisplayName(locale);
  return ui(
    `${languageName}の音声がこの端末・ブラウザーにありません。端末の音声データを追加するか、対応ブラウザーで試してください。`,
    `A ${languageName} voice is not available on this device or browser. Install the language voice data or try a supported browser.`,
  );
}

/** 現在実際に使われる音声名を表示する。 */
function updateVoiceStatus(message = "", stateName = "") {
  if (!voiceStatus) return;

  if (message) {
    voiceStatus.textContent = message;
  } else {
    const voice = getSelectedSpeechVoice();
    const expectedGoogle = voice && /google/i.test(voice.name);

    if (voice) {
      voiceStatus.textContent = expectedGoogle
        ? ui(
            `使用音声: ${voice.name}（${voice.lang}）`,
            `Voice: ${voice.name} (${voice.lang})`,
          )
        : ui(
            `Google音声が見つからないため、${voice.name}（${voice.lang}）を使用します。`,
            `Google voice is unavailable, so ${voice.name} (${voice.lang}) will be used.`,
          );
    } else {
      voiceStatus.textContent = getMissingVoiceMessage();
    }
  }

  voiceStatus.classList.toggle("is-active", stateName === "active");
  voiceStatus.classList.toggle("is-error", stateName === "error");
}

let speechRequestId = 0;

/** 再生中だけでなく、音声一覧を待っている読み上げも取り消す。 */
function cancelSpeech() {
  speechRequestId += 1;
  window.speechSynthesis?.cancel?.();
}

/** Web Speech APIで無料読み上げを行う。 */
function speakText(message) {
  if (!message || !("speechSynthesis" in window)
      || !("SpeechSynthesisUtterance" in window)) {
    return false;
  }

  void speakTextWhenVoicesReady(message);
  return true;
}

/** 音声一覧の読み込みを待ってからGoogle音声を指定して読み上げる。 */
async function speakTextWhenVoicesReady(message) {
  const requestId = ++speechRequestId;
  const voices = await waitForSpeechVoices();
  if (requestId !== speechRequestId) return;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(message);
  const voice = getSelectedSpeechVoice(voices);
  const locale = getGuidanceSpeechLocale();

  if (isEnglish() && !voice) {
    updateVoiceStatus(
      getMissingVoiceMessage(locale),
      "error",
    );
  }

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = locale;
  }

  /* 速度設定は getGuidanceSpeechRate に集約する。 */
  utterance.rate = getGuidanceSpeechRate();
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.addEventListener("start", () => {
    updateVoiceStatus(
      ui(
        `${voice?.name ?? "ブラウザー標準音声"}で読み上げています。`,
        `Speaking with ${voice?.name ?? "the browser default voice"}.`,
      ),
      "active",
    );
  });
  utterance.addEventListener("end", () => updateVoiceStatus());
  utterance.addEventListener("error", () => {
    updateVoiceStatus(
      ui("音声の再生に失敗しました。", "Voice playback failed."),
      "error",
    );
  });

  window.speechSynthesis.speak(utterance);
}

/** 自動案内開始時の安全メッセージを読み上げる。 */
function speakAutomaticGuidanceStartMessage() {
  const locale = getGuidanceSpeechLocale();
  const messages = {
    "ja-JP":
      "探索を開始しました。目的施設へ接近後、自動的に駐車区画の案内を開始します。運転中にスマートフォンを手で持って操作したり、画面を注視したりする行為は道路交通法で禁止されています。走行中は画面を操作しないでください。",
    "en-US":
      "Search started. Guidance will begin automatically when you approach the destination facility. Using or looking at a smartphone while driving is prohibited by Japanese road traffic law. Do not operate the screen while driving.",
    "en-GB":
      "Search started. Guidance will begin automatically when you approach the destination facility. Using or looking at a mobile phone while driving is prohibited by Japanese road traffic law. Do not operate the screen while driving.",
    "zh-CN":
      "已开始搜索。接近目的设施后，将自动开始停车位导航。在日本，驾驶时手持操作智能手机或注视屏幕是法律禁止的。驾驶时请勿操作屏幕。",
    "ko-KR":
      "검색을 시작했습니다. 목적 시설에 가까워지면 주차 구역 안내를 자동으로 시작합니다. 일본에서는 운전 중 스마트폰을 손에 들고 조작하거나 화면을 주시하는 행위가 법으로 금지되어 있습니다. 주행 중에는 화면을 조작하지 마세요.",
    "es-ES":
      "Se ha iniciado la búsqueda. La guía de la plaza de aparcamiento comenzará automáticamente al acercarse al destino. En Japón está prohibido utilizar o mirar un teléfono móvil mientras se conduce. No manipule la pantalla durante la conducción.",
  };

  return speakText(messages[locale] ?? messages["en-US"]);
}

/** 現在の案内先を読み上げる。 */
function speakCurrentGuidance() {
  if (!state.recommendedSpace) return false;

  const locale = getGuidanceSpeechLocale();
  const number = getSpokenSpaceId(state.recommendedSpace);
  const type = getSpokenSpaceTypeLabel(state.recommendedSpace.spaceType);
  const destination = getSelectedDestinationName();

  const messages = {
    "ja-JP":
      `駐車区画、${number}番です。${type}です。${destination ? `目的店舗は、${destination}です。` : ""}マップと現地の標識を確認してください。`,
    "en-US":
      `Parking space ${number}. ${type}.${destination ? ` Destination: ${destination}.` : ""} Please check the map and on-site signs.`,
    "en-GB":
      `Parking space ${number}. ${type}.${destination ? ` Destination: ${destination}.` : ""} Please check the map and on-site signs.`,
    "zh-CN":
      `停车位${number}号。${type}。${destination ? `目的地是${destination}。` : ""}请确认地图和现场标志。`,
    "ko-KR":
      `주차 구역 ${number}번입니다. ${type}입니다.${destination ? ` 목적지는 ${destination}입니다.` : ""} 지도와 현장 표지판을 확인해 주세요.`,
    "es-ES":
      `Plaza de aparcamiento número ${number}. ${type}.${destination ? ` Destino: ${destination}.` : ""} Compruebe el mapa y las señales del aparcamiento.`,
  };

  return speakText(messages[locale] ?? messages["en-US"]);
}

/** 現在設定の音声案内言語で短い試聴を行う。 */
function previewSelectedVoice() {
  const locale = getGuidanceSpeechLocale();
  const messages = {
    "ja-JP": "音声案内のテストです。駐車区画、5番です。",
    "en-US": "Voice guidance test. Parking space number five.",
    "en-GB": "Voice guidance test. Parking space number five.",
    "zh-CN": "语音导航测试。停车位5号。",
    "ko-KR": "음성 안내 테스트입니다. 주차 구역 5번입니다.",
    "es-ES": "Prueba de guía por voz. Plaza de aparcamiento número cinco.",
  };

  speakText(messages[locale] ?? messages["en-US"]);
}

/** Web Speech APIの利用可否を反映する。 */
function updateVoiceAvailability() {
  const supported =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  [voiceGuideButton, voicePreviewButton].forEach((button) => {
    if (!button) return;
    button.disabled = !supported;
  });

  if (voiceEnabledInput) voiceEnabledInput.disabled = !supported;
  guidanceVoiceInputs.forEach((input) => { input.disabled = !supported; });

  if (supported) {
    updateVoiceModeUi();
  } else {
    updateVoiceStatus(
      ui(
        "このブラウザーは音声読み上げに対応していません。",
        "This browser does not support speech synthesis.",
      ),
      "error",
    );
  }
}

/* =========================================================
   表示設定
   ========================================================= */

/** 文字サイズを切り替え、端末内に保存する。 */
function applyTextSizeLabel() {
  const useLarge = document.documentElement.dataset.fontSize === "large";
  textSizeButton.setAttribute("aria-pressed", String(useLarge));
  textSizeButton.textContent = useLarge
    ? ui("標準文字", "Standard text")
    : ui("文字を大きく", "Larger text");
}

function toggleTextSize() {
  const useLarge = document.documentElement.dataset.fontSize !== "large";
  document.documentElement.dataset.fontSize = useLarge ? "large" : "normal";
  applyTextSizeLabel();

  try {
    localStorage.setItem("parkingGuideFontSize", useLarge ? "large" : "normal");
  } catch {
    /* 保存できない環境でも表示変更は続ける。 */
  }
}

/** 保存済みの文字サイズを復元する。 */
function restoreTextSize() {
  let savedSize = "normal";
  try {
    savedSize = localStorage.getItem("parkingGuideFontSize") ?? "normal";
  } catch {
    savedSize = "normal";
  }

  const useLarge = savedSize === "large";
  document.documentElement.dataset.fontSize = useLarge ? "large" : "normal";
  applyTextSizeLabel();
}

/** テーマを反映し、ブラウザー上部の色も合わせる。 */
function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalizedTheme;
  const dark = normalizedTheme === "dark";
  themeButton.setAttribute("aria-pressed", String(dark));
  themeButton.textContent = dark
    ? ui("ライトモード", "Light mode")
    : ui("ダークモード", "Dark mode");
  themeColorMeta?.setAttribute("content", dark ? "#17191d" : "#ffffff");
}

/** ライト・ダークを切り替える。 */
function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem("parkingGuideTheme", nextTheme);
  } catch {
    /* 保存できない環境でも現在の表示は維持する。 */
  }
}

/** 保存値がない場合はOS設定を使う。 */
function restoreTheme() {
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("parkingGuideTheme");
  } catch {
    savedTheme = null;
  }
  const preferredTheme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(preferredTheme);
}

/** 自動案内を終了して位置監視・音声を止め、最初の画面へ戻る。 */
function endGuidance() {
  state.autoProximityArmed = false;
  state.proximitySearchRunning = false;
  state.autoTriggeredFacilityId = null;
  cancelSpeech();
  window.parkingSafety?.stop?.(
    ui("案内を終了しました。位置情報の取得を停止しました。", "Guidance ended. Location tracking stopped."),
  );
  resetApplication();
}

/** 最初の画面へ戻り、検索結果を初期化する。 */
function resetApplication() {
  state.searchRequestId += 1;
  state.selectedFacility = null;
  state.selectedDestination = null;
  state.selectedPriority = "balanced";
  state.requestedSpaceType = "standard";
  state.voiceEnabled = voiceEnabledInput?.checked !== false;
  state.autoProximityArmed = false;
  state.autoTriggeredFacilityId = null;
  state.proximitySearchRunning = false;
  state.pendingPrivateTestCalibration = false;
  state.recommendedSpace = null;
  state.currentSpaces = [];
  state.currentLayout = null;
  state.guideEntrance = null;
  state.searchSequence = 0;
  conditionForm.reset();
  showScreen("facility");
}

/* =========================================================
   操作イベント
   ========================================================= */

facilityList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-facility-id]");
  if (!button) {
    return;
  }

  const facility = FACILITIES.find((item) => item.id === button.dataset.facilityId);
  if (!facility) {
    return;
  }

  state.selectedFacility = facility;
  state.searchRequestId += 1;
  state.autoProximityArmed = false;
  state.autoTriggeredFacilityId = null;
  state.proximitySearchRunning = false;
  state.recommendedSpace = null;
  state.selectedDestination = null;
  selectedFacilityName.textContent = getFacilityDisplayName(facility);
  updateDestinationPanel();
  updateRandomGuidanceNote();
  updatePrivateTestLocationPanel();
  void ensureFacilityCoordinate(facility);
  showScreen("condition");
});

textSizeButton.addEventListener("click", toggleTextSize);
themeButton.addEventListener("click", toggleTheme);
languageButton.addEventListener("click", () => {
  cancelSpeech();
  applyLanguage(isEnglish() ? "ja" : "en");
});
destinationSelect?.addEventListener("change", () => {
  saveSelectedDestination();
  updateWaitingScreen();
});
voiceGuideButton?.addEventListener("click", () => {
  speakCurrentGuidance();
});
voicePreviewButton?.addEventListener("click", previewSelectedVoice);
voiceEnabledInput?.addEventListener("change", () => {
  state.voiceEnabled = voiceEnabledInput.checked;
  if (!state.voiceEnabled) cancelSpeech();
});
guidanceVoiceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;

    const selectedLanguage = input.value;
    state.guidanceVoiceLanguage =
      ["en-US", "en-GB", "zh-CN", "ko-KR", "es-ES"].includes(selectedLanguage)
        ? selectedLanguage
        : "en-US";
    updateVoiceModeUi();

    /* 選択した言語に音声が付いていることをその場で確認できるよう自動試聴する。 */
    previewSelectedVoice();

    try {
      localStorage.setItem(
        "parkingGuideGuidanceVoiceLanguage",
        state.guidanceVoiceLanguage,
      );
    } catch {
      /* 保存できない環境でも現在の選択は利用する。 */
    }
  });
});

savePrivateTestLocationButton?.addEventListener("click", () => {
  if (state.selectedFacility?.id !== PRIVATE_TEST_FACILITY_ID) return;

  if (state.userLocation && savePrivateTestCoordinate(state.userLocation)) {
    state.pendingPrivateTestCalibration = false;
    updatePrivateTestLocationPanel();
    updateProximityStatus();
    updateFacilityDistances();
    return;
  }

  state.pendingPrivateTestCalibration = true;
  window.parkingSafety?.start?.();
  updatePrivateTestLocationPanel();
});

clearPrivateTestLocationButton?.addEventListener("click", () => {
  clearPrivateTestCoordinate();
  state.pendingPrivateTestCalibration = false;
  state.autoTriggeredFacilityId = null;
  updatePrivateTestLocationPanel();
  updateProximityStatus();
  updateFacilityDistances();
});
filterForm.addEventListener("submit", (event) => event.preventDefault());

prefectureFilter.addEventListener("change", () => {
  state.filters.prefecture = prefectureFilter.value;
  renderFacilities();
});

categoryFilter.addEventListener("change", () => {
  state.filters.category = categoryFilter.value;
  renderFacilities();
});

resetFiltersButton.addEventListener("click", () => {
  state.filters = { prefecture: "", category: "" };
  state.sortByDistance = false;
  initializeFilters();
  renderFacilities();
});

sortDistanceButton.addEventListener("click", () => {
  state.sortByDistance = true;
  renderFacilities();
});

window.addEventListener("parking:locationchange", (event) => {
  state.userLocation = event.detail.location;

  if (state.pendingPrivateTestCalibration && state.userLocation
      && state.selectedFacility?.id === PRIVATE_TEST_FACILITY_ID) {
    if (savePrivateTestCoordinate(state.userLocation)) {
      state.pendingPrivateTestCalibration = false;
      updatePrivateTestLocationPanel();
      updateProximityStatus();
    }
  }

  updateFacilityDistances();
  if (state.currentScreen === "waiting") {
    updateWaitingScreen();
  }
  void checkAutomaticProximitySearch();
});

conditionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveSearchConditions();

  if (Array.isArray(state.selectedFacility?.destinations)
      && state.selectedFacility.destinations.length > 0
      && !state.selectedDestination) {
    destinationSelect.reportValidity();
    destinationSelect.focus();
    return;
  }

  const facility = state.selectedFacility;
  const requestId = ++state.searchRequestId;
  await ensureFacilityCoordinate(facility);
  if (requestId !== state.searchRequestId || state.selectedFacility !== facility) return;

  state.autoProximityArmed = true;
  state.autoTriggeredFacilityId = null;
  state.recommendedSpace = null;

  /* submitはユーザー操作なので、このタイミングで位置情報許可を求められる。 */
  window.parkingSafety?.start?.();
  updateWaitingScreen();
  updateProximityStatus();
  showScreen("waiting");
  if (state.voiceEnabled) {
    speakAutomaticGuidanceStartMessage();
  }
  void checkAutomaticProximitySearch();
});

searchNowButton?.addEventListener("click", () => {
  saveSearchConditions();
  if (Array.isArray(state.selectedFacility?.destinations)
      && state.selectedFacility.destinations.length > 0
      && !state.selectedDestination) {
    destinationSelect.reportValidity();
    destinationSelect.focus();
    return;
  }
  void runSpaceSearch();
});

retryButton.addEventListener("click", () => {
  state.searchSequence += 1;
  void runSpaceSearch();
});

endGuidanceButton?.addEventListener("click", endGuidance);

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.back));
});

document.querySelectorAll("[data-go-home]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    resetApplication();
  });
});

window.addEventListener("popstate", (event) => {
  if (window.parkingSafety && !window.parkingSafety.guardOperation()) {
    window.history.pushState({ screen: state.currentScreen }, "", `#${state.currentScreen}`);
    return;
  }

  const requestedScreen = event.state?.screen;
  const canOpenScreen =
    requestedScreen === "facility" ||
    (requestedScreen === "condition" && state.selectedFacility) ||
    (requestedScreen === "waiting" && state.selectedFacility && state.autoProximityArmed) ||
    (requestedScreen === "result" && state.recommendedSpace);

  showScreen(canOpenScreen ? requestedScreen : "facility", { addHistory: false });
});

/* =========================================================
   初期表示
   ========================================================= */

void loadRemoteParkingLayouts();
restoreTheme();
restoreTextSize();
restoreLanguage();
updateVoiceAvailability();
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    updateVoiceModeUi();
  });
}
initializeFilters();
window.history.replaceState({ screen: "facility" }, "", "#facility");
showScreen("facility", { addHistory: false, moveFocus: false });
