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
  "Gemini Live AI音声（無料枠）を優先し、利用できない場合は端末音声へ切り替えます。":
    "Gemini Live AI voice (free tier) is preferred. The app falls back to the device voice if needed.",
  "音声方式": "Voice system",
  "Gemini Live AI音声（無料枠・推奨）": "Gemini Live AI voice (free tier, recommended)",
  "端末音声（予備）": "Device voice (fallback)",
  "音声を試す": "Test voice",
  "Gemini音声": "Gemini voice",
  "Kore（推奨）": "Kore (recommended)",
  "Puck": "Puck",
  "端末音声": "Device voice",
  "自動（聞き取りやすい音声）": "Automatic (clear voice)",
  "Gemini Live音声は初回利用時に接続します。": "Gemini Live voice connects when first used.",
  "Gemini音声では案内文をGemini APIへ送信します。AIアシスタント中のみマイクを使用し、会話音声もGemini APIへ送信します。Free Tierでは送信内容がGoogleのサービス改善に利用される場合があります。":
    "Gemini voice sends guidance text to the Gemini API. The microphone is used only while the AI assistant is active, and conversation audio is sent to the Gemini API. Free-tier content may be used by Google to improve its products.",
  "AIアシスタント": "AI assistant",
  "AIアシスタントを終了": "Stop AI assistant",
  "Gemini 駐車場アシスタント": "Gemini Parking Assistant",
  "「AIアシスタント」を押すと、マイクで駐車場について質問できます。":
    "Press AI assistant to ask parking questions by voice."
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
  populateVoiceOptions();
  updateVoiceControlUi();
  window.dispatchEvent(new CustomEvent("parking:languagechange", {
    detail: { language: state.language },
  }));
  try {
    localStorage.setItem("parkingGuideLanguage", state.language);
    localStorage.setItem("parkingGuideVoiceURI", state.selectedVoiceURI ?? "");
    localStorage.setItem("parkingGuideVoiceProvider", state.voiceProvider);
    localStorage.setItem("parkingGuideGeminiVoice", state.geminiVoice);
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
    state.selectedVoiceURI = localStorage.getItem("parkingGuideVoiceURI") ?? "";
    const savedProvider = localStorage.getItem("parkingGuideVoiceProvider");
    state.voiceProvider = savedProvider === "device" ? "device" : "gemini";
    const savedGeminiVoice = localStorage.getItem("parkingGuideGeminiVoice") ?? "Kore";
    state.geminiVoice = ["Kore", "Puck", "Aoede", "Charon"].includes(savedGeminiVoice)
      ? savedGeminiVoice
      : "Kore";
  } catch {
    state.selectedVoiceURI = "";
    state.voiceProvider = "gemini";
    state.geminiVoice = "Kore";
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
  voiceProvider: "gemini",
  geminiVoice: "Kore",
  selectedVoiceURI: "",
  geminiAssistantActive: false,
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
const voiceProviderSelect = document.querySelector("#voice-provider-select");
const geminiVoiceSelect = document.querySelector("#gemini-voice-select");
const geminiVoiceRow = document.querySelector("#gemini-voice-row");
const deviceVoiceRow = document.querySelector("#device-voice-row");
const geminiVoiceStatus = document.querySelector("#gemini-voice-status");
const voiceSelect = document.querySelector("#voice-select");
const voicePreviewButton = document.querySelector("#voice-preview-button");
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
const updatedTime = document.querySelector("#updated-time");
const voiceGuideButton = document.querySelector("#voice-guide-button");
const aiAssistantButton = document.querySelector("#ai-assistant-button");
const aiAssistantPanel = document.querySelector(".ai-assistant-panel");
const aiAssistantStatus = document.querySelector("#ai-assistant-status");
const aiAssistantTranscript = document.querySelector("#ai-assistant-transcript");
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

/** Supabaseに保存された最新レイアウトを読み込み、同梱データより優先する。 */
async function loadRemoteParkingLayouts() {
  const config = window.PARKING_REMOTE_CONFIG ?? {};
  const url = String(config.supabaseUrl ?? "").replace(/\/$/, "");
  const publishableKey = String(config.publishableKey ?? "");
  if (config.enabled !== true || !/^https:\/\//.test(url) || publishableKey.length <= 10) {
    return;
  }

  try {
    const response = await fetch(`${url}/rest/v1/parking_layouts?select=facility_id,layout_data,updated_at`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return;
    }
    const rows = await response.json();
    const layouts = { ...(window.PARKING_LAYOUTS ?? {}) };
    rows.forEach((row) => {
      if (row?.facility_id && row.layout_data && Array.isArray(row.layout_data.objects)) {
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

/** オブジェクト座標をキャンバス比率へ変換する。 */
function toPercent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

/**
 * Web Mercatorで扱える緯度の範囲へ収める。
 * 管理画面と同じ計算式を使い、航空写真と配置オブジェクトの位置関係を一致させる。
 */
function clampMapLatitude(latitude) {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

/** 緯度経度を国土地理院XYZタイルと同じ世界ピクセル座標へ変換する。 */
function toMapWorldPixel(latitude, longitude, zoom) {
  const size = 256 * (2 ** zoom);
  const lat = clampMapLatitude(latitude) * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * size,
    y: (1 - Math.log(Math.tan(lat) + (1 / Math.cos(lat))) / Math.PI) / 2 * size,
  };
}

/**
 * 利用者マップ用の航空写真タイルを1枚生成する。
 * 高倍率タイルが取得できない場合は、管理画面と同様にズーム14まで
 * 低い倍率の親タイルを順番に試し、該当部分を拡大して空白を補う。
 */
function createUserSatelliteTile(targetX, targetY, targetZoom, leftPx, topPx, canvasWidth, canvasHeight) {
  const tile = document.createElement("div");
  tile.className = "user-satellite-tile";
  tile.style.left = `${toPercent(leftPx, canvasWidth)}%`;
  tile.style.top = `${toPercent(topPx, canvasHeight)}%`;
  tile.style.width = `${toPercent(257, canvasWidth)}%`;
  tile.style.height = `${toPercent(257, canvasHeight)}%`;

  function loadCandidate(candidateZoom) {
    if (candidateZoom < 14) {
      tile.classList.add("is-missing");
      return;
    }

    const difference = targetZoom - candidateZoom;
    const scale = 2 ** difference;
    const candidateTileCount = 2 ** candidateZoom;
    const parentX = Math.floor(targetX / scale);
    const parentY = Math.floor(targetY / scale);
    const wrappedParentX =
      ((parentX % candidateTileCount) + candidateTileCount) % candidateTileCount;
    const offsetX = targetX - parentX * scale;
    const offsetY = targetY - parentY * scale;

    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.loading = "eager";
    image.style.width = `${scale * 100}%`;
    image.style.height = `${scale * 100}%`;
    image.style.left = `${-offsetX * 100}%`;
    image.style.top = `${-offsetY * 100}%`;

    image.addEventListener("error", () => {
      image.remove();
      loadCandidate(candidateZoom - 1);
    }, { once: true });

    image.src =
      `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${candidateZoom}/${wrappedParentX}/${parentY}.jpg`;
    tile.append(image);
  }

  loadCandidate(targetZoom);
  return tile;
}

/**
 * 管理画面で位置合わせした航空写真を、利用者マップの最背面へ描画する。
 * backgroundが未登録の施設では何も描画せず、従来どおり模式図だけを表示する。
 */
function renderRegisteredBackground(layout, canvasWidth, canvasHeight) {
  const background = layout?.background;
  if (!background || background.type !== "gsi-seamlessphoto") {
    return;
  }
  if (!Number.isFinite(background.centerLat) || !Number.isFinite(background.centerLng)) {
    return;
  }

  const zoom = Math.max(14, Math.min(18, Math.round(background.zoom ?? 18)));
  const tileCount = 2 ** zoom;
  const center = toMapWorldPixel(background.centerLat, background.centerLng, zoom);
  const topLeftX = center.x - canvasWidth / 2;
  const topLeftY = center.y - canvasHeight / 2;

  const startTileX = Math.floor(topLeftX / 256) - 1;
  const endTileX = Math.floor((topLeftX + canvasWidth) / 256) + 1;
  const startTileY = Math.floor(topLeftY / 256) - 1;
  const endTileY = Math.floor((topLeftY + canvasHeight) / 256) + 1;

  const layer = document.createElement("div");
  layer.className = "user-satellite-layer";
  layer.style.opacity = String(
    Math.max(0.15, Math.min(1, Number(background.opacity) || 0.75)),
  );
  layer.setAttribute("aria-hidden", "true");

  for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) {
      continue;
    }

    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const tile = createUserSatelliteTile(
        wrappedX,
        tileY,
        zoom,
        tileX * 256 - topLeftX - 0.5,
        tileY * 256 - topLeftY - 0.5,
        canvasWidth,
        canvasHeight,
      );
      layer.append(tile);
    }
  }

  parkingMap.append(layer);

  /* 国土地理院の航空写真を表示するため、利用者画面にも出典を明記する。 */
  const attribution = document.createElement("span");
  attribution.className = "map-photo-attribution";
  attribution.textContent = "出典：国土地理院 全国最新写真（シームレス）";
  parkingMap.append(attribution);
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

/** 管理画面で作成した実レイアウトを簡易表示する。 */
function renderRegisteredLayout(layout, recommendedSpace) {
  parkingMap.replaceChildren();
  parkingMap.className = "parking-map parking-map--layout";
  parkingMapTitle.textContent = "駐車場マップ";

  const canvasWidth = Number(layout.canvas?.width) || 1000;
  const canvasHeight = Number(layout.canvas?.height) || 700;

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

  const crop = calculateLayoutCrop(layout, supportedTypes);
  parkingMap.style.aspectRatio = `${crop.width} / ${crop.height}`;
  parkingMap.dataset.cropped = "true";

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
      item.style.left = `${toPercent((Number(object.x) || 0) - crop.x, crop.width)}%`;
      item.style.top = `${toPercent((Number(object.y) || 0) - crop.y, crop.height)}%`;

      const { width: objectWidth, height: objectHeight } = getLayoutObjectSize(object);
      const hasSize = Number.isFinite(objectWidth) && Number.isFinite(objectHeight)
        && objectWidth > 0 && objectHeight > 0;

      if (hasSize) {
        item.style.width = `${toPercent(objectWidth, crop.width)}%`;
        item.style.height = `${toPercent(objectHeight, crop.height)}%`;
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
        if (typeMark.textContent) item.append(typeMark);

        const displayNumber = object.spaceNumber
          ?? String(object.name ?? "").match(/(\d{1,4})$/)?.[1]
          ?? "";
        if (displayNumber) {
          const numberMark = document.createElement("span");
          numberMark.className = "space-number-mark";
          numberMark.textContent = String(displayNumber).padStart(3, "0");
          item.append(numberMark);
        }

        const isRecommended = object.uid === recommendedSpace?.uid;
        const isOccupied = object.status === "occupied" || object.status === "unavailable";
        item.classList.toggle("is-occupied", isOccupied);
        item.classList.toggle("is-recommended", isRecommended);
        appendLabel(object.name || object.spaceNumber || "区画");
        item.setAttribute(
          "aria-label",
          `${object.name || object.spaceNumber || "区画"}、${isRecommended ? "案内先" : isOccupied ? "使用中" : "空き"}`,
        );
      } else if (object.objectType === "buildingEntrance") {
        const marker = document.createElement("span");
        marker.className = "entrance-icon";
        marker.setAttribute("aria-hidden", "true");
        marker.textContent = "↥";
        const label = document.createElement("span");
        label.className = "entrance-label";
        label.textContent = object.name || "建物入口";
        item.append(marker, label);
        item.setAttribute("aria-label", label.textContent);
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
        "motorcycleParking", "loadingZone"].includes(object.objectType)) {
        appendLabel(object.name || "");
      } else if (object.objectType === "building") {
        appendLabel(object.name || "建物");
      } else if (object.objectType === "parkingLot") {
        appendLabel(object.name || "駐車場敷地");
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
}

/** レイアウト未登録時の研究用区画図を表示する。 */
function renderDemoParkingMap(spaces, recommendedSpace) {
  parkingMap.replaceChildren();
  parkingMap.className = "parking-map parking-map--demo";
  parkingMap.removeAttribute("style");
  parkingMapTitle.textContent = "デモ区画図";

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

/* =========================================================
   画面遷移・検索
   ========================================================= */

/** 指定した4画面（施設・条件・待機・区画）のうち1画面だけを表示する。 */
function showScreen(screenName, options = {}) {
  const { addHistory = true, moveFocus = true } = options;
  if (!SCREEN_ORDER.includes(screenName)) {
    return;
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
  state.voiceProvider = voiceProviderSelect?.value === "device" ? "device" : "gemini";
  state.geminiVoice = geminiVoiceSelect?.value || state.geminiVoice || "Kore";
  state.selectedVoiceURI = voiceSelect?.value ?? state.selectedVoiceURI ?? "";
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
  await loadRemoteParkingLayouts();
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

  const requestId = ++state.searchRequestId;
  const facility = state.selectedFacility;
  const priority = state.selectedPriority;
  state.recommendedSpace = null;

  if (state.currentScreen !== "result") {
    showScreen("result", { moveFocus: !autoTriggered });
  }
  resultContent.hidden = true;
  searchStatus.textContent = "空き区画を確認しています…";

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

/** 端末が提供する音声一覧から、聞き取りやすい候補を優先して返す。 */
function getAvailableSpeechVoices() {
  if (!("speechSynthesis" in window)) return [];
  const languagePrefix = isEnglish() ? "en" : "ja";
  return (window.speechSynthesis.getVoices?.() ?? [])
    .filter((voice) => voice.lang?.toLowerCase().startsWith(languagePrefix))
    .sort((first, second) => {
      const preferredPattern = isEnglish()
        ? /Samantha|Ava|Karen|Google US English|Microsoft.*(Aria|Jenny|Guy)/i
        : /Kyoko|Nanami|Haruka|Ayumi|Otoya|Google 日本語|Microsoft.*Japan/i;
      const firstScore = (first.localService ? 2 : 0) + (preferredPattern.test(first.name) ? 4 : 0)
        + (first.default ? 1 : 0);
      const secondScore = (second.localService ? 2 : 0) + (preferredPattern.test(second.name) ? 4 : 0)
        + (second.default ? 1 : 0);
      return secondScore - firstScore || first.name.localeCompare(second.name);
    });
}

/** 利用可能な音声をプルダウンへ反映する。 */
function populateVoiceOptions() {
  if (!voiceSelect) return;

  const previous = state.selectedVoiceURI || voiceSelect.value || "";
  const defaultText = ui("自動（聞き取りやすい音声）", "Automatic (clear voice)");
  voiceSelect.replaceChildren(new Option(defaultText, ""));

  getAvailableSpeechVoices().forEach((voice) => {
    const option = new Option(`${voice.name}（${voice.lang}）`, voice.voiceURI);
    voiceSelect.add(option);
  });

  if ([...voiceSelect.options].some((option) => option.value === previous)) {
    voiceSelect.value = previous;
  } else {
    voiceSelect.value = "";
    state.selectedVoiceURI = "";
  }
}

/** 選択中、または自動選択された音声を返す。 */
function getSelectedSpeechVoice() {
  const voices = getAvailableSpeechVoices();
  if (!voices.length) return null;
  if (state.selectedVoiceURI) {
    const selected = voices.find((voice) => voice.voiceURI === state.selectedVoiceURI);
    if (selected) return selected;
  }
  return voices[0];
}

/** Geminiへ渡す現在の駐車場情報を、推測を含めず短いテキストへまとめる。 */
function buildGeminiVoiceContext() {
  const available = state.currentSpaces
    .filter((space) => space?.status === "available")
    .slice(0, 30)
    .map((space) => getSpokenSpaceId(space))
    .filter(Boolean);

  const parts = [
    `language=${state.language}`,
    `facility=${getFacilityDisplayName(state.selectedFacility) || "not selected"}`,
    `destination=${getSelectedDestinationName() || "not selected"}`,
    `requested_space_type=${getSpaceTypeLabel(state.requestedSpaceType)}`,
    `priority=${getPriorityLabel(state.selectedPriority)}`,
  ];

  if (state.recommendedSpace) {
    parts.push(`recommended_space=${getSpokenSpaceId(state.recommendedSpace)}`);
    parts.push(`recommended_type=${getSpaceTypeLabel(state.recommendedSpace.spaceType)}`);
    if (Number.isFinite(state.recommendedSpace.entranceDistanceMeters)) {
      parts.push(`entrance_distance_m=${Math.round(state.recommendedSpace.entranceDistanceMeters)}`);
    }
  }

  if (available.length) {
    parts.push(`known_available_spaces=${available.join(",")}`);
  }

  parts.push("This is a research prototype. Do not claim live occupancy beyond the app data.");
  return parts.join("\n");
}

/** Gemini音声の状態表示を更新する。 */
function setGeminiVoiceStatus(message, stateName = "") {
  if (!geminiVoiceStatus) return;
  geminiVoiceStatus.textContent = message;
  geminiVoiceStatus.classList.toggle("is-error", stateName === "error");
  geminiVoiceStatus.classList.toggle(
    "is-active",
    ["ready", "speaking", "listening", "thinking"].includes(stateName),
  );
}

/** Gemini/端末音声の設定画面を現在値へ同期する。 */
function updateVoiceControlUi() {
  if (voiceProviderSelect) voiceProviderSelect.value = state.voiceProvider;
  if (geminiVoiceSelect) geminiVoiceSelect.value = state.geminiVoice;
  if (geminiVoiceRow) geminiVoiceRow.hidden = state.voiceProvider !== "gemini";
  if (deviceVoiceRow) deviceVoiceRow.hidden = state.voiceProvider !== "device";

  const geminiSupported = window.parkingGeminiVoice?.isSupported?.() === true;
  if (state.voiceProvider === "gemini") {
    setGeminiVoiceStatus(
      geminiSupported
        ? ui("Gemini Live音声は初回利用時に接続します。", "Gemini Live voice connects when first used.")
        : ui("Gemini音声を利用できないため、端末音声を使用します。", "Gemini voice is unavailable. Device voice will be used."),
      geminiSupported ? "" : "error",
    );
  }
}

/** 端末標準の読み上げ。Geminiが利用できない場合のフォールバックにも使う。 */
function speakDeviceText(message) {
  if (!message || !("speechSynthesis" in window)
      || !("SpeechSynthesisUtterance" in window)) {
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = isEnglish() ? "en-US" : "ja-JP";
  utterance.rate = 0.84;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voice = getSelectedSpeechVoice();
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
  return true;
}

/** 指定文をGemini Live AI音声、または端末音声で読み上げる。 */
function speakText(message) {
  if (!message) return false;

  const geminiVoice = window.parkingGeminiVoice;
  if (state.voiceProvider === "gemini" && geminiVoice?.isSupported?.()) {
    window.speechSynthesis?.cancel?.();
    void geminiVoice.speak(message, {
      language: state.language,
      voice: state.geminiVoice,
      contextText: buildGeminiVoiceContext(),
    }).catch((error) => {
      console.warn("Gemini音声へ接続できないため端末音声へ切り替えます。", error);
      const reason = String(error?.message ?? "").trim();
      setGeminiVoiceStatus(
        reason
          ? ui(
              `Gemini音声へ接続できなかったため、端末音声で読み上げます。原因: ${reason}`,
              `Gemini voice could not connect. Using the device voice instead. Reason: ${reason}`,
            )
          : ui(
              "Gemini音声へ接続できなかったため、端末音声で読み上げます。",
              "Gemini voice could not connect. Using the device voice instead.",
            ),
        "error",
      );
      speakDeviceText(message);
    });
    return true;
  }

  return speakDeviceText(message);
}

/** 自動案内開始時の安全メッセージを読み上げる。 */
function speakAutomaticGuidanceStartMessage() {
  const message = isEnglish()
    ? "Search started. Guidance will begin automatically when you approach the destination facility. Using or looking at a smartphone while driving is prohibited by Japanese road traffic law. Do not operate the screen while driving."
    : "探索を開始しました。目的施設へ接近後、自動的に駐車区画の案内を開始します。運転中にスマートフォンを手で持って操作したり、画面を注視したりする行為は道路交通法で禁止されています。走行中は画面を操作しないでください。";
  return speakText(message);
}

/** 現在の案内先を読み上げる。 */
function speakCurrentGuidance() {
  if (!state.recommendedSpace) return false;

  const number = getSpokenSpaceId(state.recommendedSpace);
  const type = getSpaceTypeLabel(state.recommendedSpace.spaceType);
  const destination = getSelectedDestinationName();
  const message = isEnglish()
    ? `Parking space ${number}. ${type}.${destination ? ` Destination: ${destination}.` : ""} Please check the map and on-site signs.`
    : `駐車区画、${number}番です。${type}です。${destination ? `目的店舗は、${destination}です。` : ""}マップと現地の標識を確認してください。`;

  return speakText(message);
}

/** 音声選択画面から短い試聴を行う。 */
function previewSelectedVoice() {
  const message = isEnglish()
    ? "Voice guidance test. Parking space number five."
    : "音声案内のテストです。駐車区画、5番です。";
  speakText(message);
}

function updateVoiceAvailability() {
  const deviceSupported =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const geminiSupported = window.parkingGeminiVoice?.isSupported?.() === true;
  const anySupported = deviceSupported || geminiSupported;

  [voiceGuideButton, voicePreviewButton].forEach((button) => {
    if (!button) return;
    button.disabled = !anySupported;
    button.title = anySupported
      ? ""
      : ui(
          "このブラウザーでは音声案内を利用できません。",
          "Voice guidance is not available in this browser.",
        );
  });

  if (voiceEnabledInput) voiceEnabledInput.disabled = !anySupported;
  if (voiceProviderSelect) voiceProviderSelect.disabled = !anySupported;
  if (geminiVoiceSelect) geminiVoiceSelect.disabled = !geminiSupported;
  if (voiceSelect) voiceSelect.disabled = !deviceSupported;
  if (aiAssistantButton) aiAssistantButton.disabled = !geminiSupported;

  if (deviceSupported) populateVoiceOptions();
  updateVoiceControlUi();
}

/** Gemini Liveの会話モードを開始・終了する。 */
async function toggleGeminiAssistant() {
  const geminiVoice = window.parkingGeminiVoice;
  if (!geminiVoice?.isSupported?.()) {
    setGeminiVoiceStatus(
      ui("Gemini AIアシスタントを利用できません。", "Gemini AI assistant is unavailable."),
      "error",
    );
    return;
  }

  if (window.parkingSafety && !window.parkingSafety.guardOperation()) {
    return;
  }

  if (geminiVoice.isAssistantActive()) {
    geminiVoice.disconnect();
    state.geminiAssistantActive = false;
    return;
  }

  state.voiceProvider = "gemini";
  if (voiceProviderSelect) voiceProviderSelect.value = "gemini";
  updateVoiceControlUi();

  if (aiAssistantTranscript) {
    aiAssistantTranscript.hidden = true;
    aiAssistantTranscript.textContent = "";
  }

  try {
    await geminiVoice.startAssistant({
      language: state.language,
      voice: state.geminiVoice,
      contextText: buildGeminiVoiceContext(),
    });
    state.geminiAssistantActive = true;
  } catch (error) {
    console.error(error);
    state.geminiAssistantActive = false;
    setGeminiVoiceStatus(
      ui(
        "AIアシスタントへ接続できませんでした。Supabase/Gemini設定を確認してください。",
        "Could not connect to the AI assistant. Check the Supabase/Gemini setup.",
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
  window.speechSynthesis?.cancel?.();
  window.parkingGeminiVoice?.disconnect?.({ silent: true });
  state.geminiAssistantActive = false;
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
  state.geminiAssistantActive = false;
  window.parkingGeminiVoice?.disconnect?.({ silent: true });
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
  window.parkingGeminiVoice?.disconnect?.({ silent: true });
  state.geminiAssistantActive = false;
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
aiAssistantButton?.addEventListener("click", () => {
  void toggleGeminiAssistant();
});
voiceEnabledInput?.addEventListener("change", () => {
  state.voiceEnabled = voiceEnabledInput.checked;
});
voiceProviderSelect?.addEventListener("change", () => {
  state.voiceProvider = voiceProviderSelect.value === "device" ? "device" : "gemini";
  window.parkingGeminiVoice?.disconnect?.({ silent: true });
  state.geminiAssistantActive = false;
  updateVoiceControlUi();
  try {
    localStorage.setItem("parkingGuideVoiceProvider", state.voiceProvider);
  } catch {}
});
geminiVoiceSelect?.addEventListener("change", () => {
  state.geminiVoice = geminiVoiceSelect.value || "Kore";
  window.parkingGeminiVoice?.disconnect?.({ silent: true });
  state.geminiAssistantActive = false;
  updateVoiceControlUi();
  try {
    localStorage.setItem("parkingGuideGeminiVoice", state.geminiVoice);
  } catch {}
});
voiceSelect?.addEventListener("change", () => {
  state.selectedVoiceURI = voiceSelect.value;
  try {
    localStorage.setItem("parkingGuideVoiceURI", state.selectedVoiceURI);
  } catch {
    /* 保存できない環境でも現在の選択は利用する。 */
  }
});

window.addEventListener("parking:gemini-voice-status", (event) => {
  const detail = event.detail ?? {};
  const statusMessage = detail.message ?? "";

  if (statusMessage) {
    setGeminiVoiceStatus(statusMessage, detail.state ?? "");
    if (aiAssistantStatus) aiAssistantStatus.textContent = statusMessage;
  }

  const assistantActive = detail.assistantActive === true;
  state.geminiAssistantActive = assistantActive;
  if (aiAssistantButton) {
    aiAssistantButton.setAttribute("aria-pressed", String(assistantActive));
    aiAssistantButton.textContent = assistantActive
      ? ui("AIアシスタントを終了", "Stop AI assistant")
      : ui("AIアシスタント", "AI assistant");
  }
  aiAssistantPanel?.classList.toggle("is-active", assistantActive);
  aiAssistantPanel?.classList.toggle("is-error", detail.state === "error");

  if (aiAssistantTranscript && (detail.userTranscript || detail.assistantTranscript)) {
    const lines = [];
    if (detail.userTranscript) {
      lines.push(ui(`あなた：${detail.userTranscript}`, `You: ${detail.userTranscript}`));
    }
    if (detail.assistantTranscript) {
      lines.push(ui(`AI：${detail.assistantTranscript}`, `AI: ${detail.assistantTranscript}`));
    }
    if (lines.length) {
      aiAssistantTranscript.textContent = lines.join("\n");
      aiAssistantTranscript.hidden = false;
    }
  }
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

  await ensureFacilityCoordinate(state.selectedFacility);

  if (state.voiceEnabled) {
    speakAutomaticGuidanceStartMessage();
  }
  state.autoProximityArmed = true;
  state.autoTriggeredFacilityId = null;
  state.recommendedSpace = null;

  /* submitはユーザー操作なので、このタイミングで位置情報許可を求められる。 */
  window.parkingSafety?.start?.();
  updateWaitingScreen();
  updateProximityStatus();
  showScreen("waiting");
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
updateVoiceControlUi();
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    populateVoiceOptions();
  });
}
initializeFilters();
window.history.replaceState({ screen: "facility" }, "", "#facility");
showScreen("facility", { addHistory: false, moveFocus: false });
