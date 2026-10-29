"use strict";
const mapDisplay = window.ParkingMapDisplay;

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

// 録画動画をYOLOで解析しながら案内する研究実演施設。
// 実際の「自宅テスト用」とは別IDなので、現地の現在の空き情報を書き換えない。
const VIDEO_REPLAY_FACILITY_ID = "home-video-demo-001";
const VIDEO_REPLAY_FACILITY = Object.freeze({
  id: VIDEO_REPLAY_FACILITY_ID,
  name: "自宅駐車場（録画YOLO実演）",
  displayName: "自宅駐車場（録画YOLO実演）",
  prefecture: "岡山県",
  municipality: "岡山市（実験地点は現在地）",
  address: "現在地（録画実演用・実際の現在の空き情報ではありません）",
  category: "experiment",
  locationVerified: false,
  coordinateSource: "端末の現在地を実験用として利用。自宅の住所は公開しない",
  operatingStatus: "active",
  layoutId: VIDEO_REPLAY_FACILITY_ID,
  isDemo: false,
  isPrivateTest: true,
  requiresLocalCalibration: true,
  isRecordedExperiment: true,
  researchSpaceCount: 6,
  statusNote: "過去の録画をYOLOが逐次解析する実演。実際の現在の空きではありません",
});

// sampleRole は研究上の分類に使用し、一覧の表示条件にはしない。
const FACILITIES = Object.freeze([DEMO_FACILITY, VIDEO_REPLAY_FACILITY, ...FACILITY_CATALOG]);

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
  priority: "優先区画",
  ev: "EV充電",
});

const SPACE_TYPE_LABELS_EN = Object.freeze({
  standard: "Standard",
  compact: "Kei car",
  accessible: "Accessible",
  priority: "Priority parking",
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
  "その他の車種・専用区画": "Other vehicles / dedicated spaces",
  "車種・専用用途を選択": "Choose vehicle or dedicated use",
  "専用・予約区画は現地の利用条件をご確認ください。": "Check eligibility and reservations for dedicated spaces.",
  "研究用デモ · 実際の空き情報ではありません": "Research demo · Not live availability",
  "移動状態：未確認": "Motion: not checked",
  "目的の店舗を選んでください。": "Choose your destination.",
  "満：空きなし · 混：残りわずか · 空：空きあり · —：未確認": "Full · Busy: few spaces left · Open · —: unknown",
  "約250m以内で、空き区画を自動検索します。": "Automatically searches within about 250 m.",
  "駐車場のカメラ写真": "Parking camera photo",
  "現地の様子を、案内開始前に確認できます。": "Check the parking lot before starting guidance.",
  "カメラ": "Camera",
  "写真を更新": "Refresh photo",
  "現在の写真を確認できません": "Current photo unavailable",
  "満：満車 · 混：混雑 · 空：空きあり · 休：休業日 · 閉：開店前・閉店後 · —：未確認": "Full · Busy · Open · Day off · Closed before/after hours · —: unknown",
  "利用規約・プライバシー・このアプリについて": "Terms, privacy and about this app",
  "区画番号や混雑状況を音声で案内します。": "Hear space numbers and availability.",
  "音声・接続の詳細設定": "Voice and connection settings",
  "メディア再生（Safari向け）": "Media playback (Safari)",
  "案内音声を優先": "Prioritize guidance",
  "オンにすると、店舗名・区画番号を含む日本語案内文を外部サービス tts.quest に送信します。通信できない場合は端末音声に戻ります。設定は停車中に行ってください。": "When enabled, Japanese guidance including store names and space numbers is sent to the external service tts.quest. Device speech is used if unavailable. Change settings while parked.",
  "接続診断：テスト後に表示します。": "Connection results appear after testing.",
  "音が聞こえないとき": "If you cannot hear the voice",
  "停車中に「音声を試す」で確認し、再生中に端末・車載機の音量を調整してください。WebアプリからBluetooth・CarPlayの出力先は変更できません。": "While parked, test the voice and adjust the device or car volume during playback. This app cannot change Bluetooth or CarPlay output.",
  "再生方式は端末によって効果が異なります。通話向け音声はマイクを使用しません。電子音と読み上げの音量は一致しない場合があります。": "Playback modes vary by device. Call-style playback does not use the microphone. The test tone and voice may have different volumes.",
  "音声・速度・音量は言語ごとに保存します。": "Voice, rate and volume are saved per language.",
  "画面ロック中や他のアプリの使用中は、自動案内が止まる場合があります。": "Automatic guidance may stop while the screen is locked or another app is in use.",
  "運転中の操作は控え、音声案内をご利用ください。": "Use voice guidance and avoid screen controls while driving.",
  "空き区画が見つかりませんでした": "No available space was found",
  "公道で順番待ちをせず、周囲の安全を確認してそのまま通過してください。": "Do not queue on the public road. Check your surroundings and safely continue past the entrance.",
  "別の駐車場をご利用ください。": "Please use another parking lot.",
  "別の施設を選ぶ": "Choose another facility",
  "満：満車 · 混：混雑 · 空：空車 · —：未確認": "Full: no free spaces · Busy: few spaces remain · Open: spaces available · —: unknown",
  "デモの空き状況は起動時にランダム表示します。「空き状況を更新」で再抽選できます。": "Demo availability is randomized at launch. Refresh availability to draw again.",
  "このアプリについて": "About this app",
  "卒業研究用の試作です。実店舗の空き情報は取得していません。登録済み施設は管理レイアウトの保存時点のデータ、未登録施設はデモを表示します。実際の駐車可否は現地の表示に従ってください。": "Graduation research prototype. Live availability is not collected. Registered facilities use saved layout data; other facilities show a demo. Follow on-site signs when parking.",
  "「混」は空き3区画以下、または利用可能な区画の20％以下の場合に表示します。状態不明の区画がある場合は「—」です。": "Busy means at most 3 spaces or 20% of usable spaces remain. Unknown data is shown as —.",
  "研究用：空き区画からランダムに案内します。": "Research: randomly selects an available space.",

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
  "日本語は端末の利用可能な音声を使い、Google日本語がある場合は優先します。English表示では英語・中国語・韓国語・スペイン語を選べます。":
    "Japanese uses an available device voice, preferring Google Japanese if installed. English view offers other languages.",
  "日本語 / 端末音声": "Japanese / Device voice",
  "日本語 / 外部音声（実験）": "Japanese / External voice (experimental)",
  "音声案内言語": "Voice guidance language",
  "音声を試す": "Test voice",
  "音声ファイル方式を試す（外部音声合成）": "Try audio-file voice (external synthesis)",
  "オンにすると、日本語案内文（店舗名・区画番号を含む）を外部のVOICEVOX音声合成サービス（tts.quest）へ送信します。生成音声をチャイムと同じWeb Audioで再生します。通信が必要で、時間がかかる・利用できない場合は端末の読み上げに戻ります。運転中は設定しないでください。": "When enabled, Japanese guidance text (including store names and space numbers) is sent to the third-party VOICEVOX synthesis service (tts.quest). The resulting audio plays over Web Audio, like the test tone. Internet access is required; if slow or unavailable, device speech is used. Configure only while parked.",
  "VOICEVOX:春日部つむぎ（外部サービス tts.quest に接続）": "VOICEVOX:Kasukabe Tsumugi (third-party tts.quest service)",

  "読み上げ音声": "Reading voice",
  "自動（端末の音声）": "Automatic (device voice)",
  "読み上げ速度": "Speech rate",
  "0.8倍": "0.8×", "0.9倍": "0.9×", "1.0倍": "1.0×", "1.1倍": "1.1×",
  "アプリ内の音声音量": "In-app voice volume",
  "通話向け音声": "Communication-style audio",
  "メディア再生（Safari向け・音楽が止まる場合あり）": "Media playback (for Safari; may pause music)",
  "Safariではメディア再生、その他のブラウザーでは通話向け音声を初期設定にします。停車中に「音声を試す」で確認してください。": "Safari defaults to media playback; other browsers default to communication audio. Test while parked.",
  "音声・速度・音量は言語ごとに保存します。小さく聞こえる場合は別の読み上げ音声も試してください。端末音声は100%が上限です。外部音声ファイルは小さい音を補正して再生します。": "Voice, rate and volume are saved per language. Try another reading voice if it sounds quiet. Device speech is limited to 100%; quiet external audio files are level-corrected.",
  "音量の初期値は100%です。音が小さい場合は、安全な場所に停車して「音声を試す」を押し、再生中に端末やBluetooth接続先の音量を上げてください。": "Volume defaults to 100%. If quiet, stop safely, tap Test voice, and increase your device or Bluetooth output volume while it plays.",
  "Bluetooth・CarPlayの音声設定": "Bluetooth / CarPlay audio settings",
  "音楽と同時に再生": "Mix with music",
  "案内音声を優先（音楽が止まる場合あり）": "Prioritize guidance (may pause music)",
  "通話向け音声（標準）": "Communication-style guidance (default)",
  "通話向けの設定は本物の電話ではありません。マイクは起動せず、音が小さくなったり受話口から出たりする場合もあります。停車中にお試しください。":
    "This does not place a call or access the microphone. Audio may become quieter or play through the earpiece. Test only while parked.",
  "端末の標準設定に任せる": "Use device default",
  "接続先のテスト音": "Test output sound",
  "標準では通話向け音声を使います。音が聞こえない場合は、安全な場所に停車して再生方式を切り替えてください。":
    "Communication-style audio is the default. If inaudible, stop safely and try another playback mode.",
  "通話向け音声では、電子音で出力先を準備してから読み上げます。接続先のテスト音は電子音、音声を試すは読み上げ音声なので、音量は一致しません。":
    "In communication mode, a brief tone prepares the output before speech. The output test plays a tone, while Test voice uses synthesized speech, so the volume may differ.",
  "BluetoothやCarPlayの音量・出力先はWebアプリから直接変更できません。車載機とiPhoneの設定も確認してください。":
    "Web apps cannot directly change Bluetooth or CarPlay volume and output routing. Check your car audio and iPhone settings.",
  "言語を選ぶと、その言語の音声を自動で試聴します。対応音声が端末にない場合は画面に表示します。":
    "Selecting a language automatically plays a voice sample. If the voice is unavailable on the device, the app shows that on screen.",
  "音声はアプリ側で最大音量に設定しています。音が小さい場合は、安全な場所に停車して「音声を試す」を押し、再生中に端末やBluetooth接続先の音量を上げてください。":
    "Voice guidance is already set to the maximum app volume. If it sounds quiet, stop in a safe place, tap “Test voice,” and increase your device or Bluetooth output volume while the sample plays.",
  "再生方式の切り替えは対応ブラウザーでのみ有効です。画面ロック中や他のアプリを使用中は、位置情報の更新や新しい音声案内が止まる場合があります。": "Playback mode selection works only in supported browsers. When the screen is locked or another app is active, location updates and new voice prompts may stop.",
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
  return (isEnglish() ? SPACE_TYPE_LABELS_EN : SPACE_TYPE_LABELS)[type] ?? mapDisplay.spaceTypeLabel(type,isEnglish());
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
  updateExtendedSpaceTypes();
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
  }
  if (state.currentSpaces.length && state.recommendedSpace) {
    renderParkingMap(state.currentSpaces, state.recommendedSpace, state.currentLayout);
  } else if (renderedMap) {
    renderRegisteredLayout(renderedMap.layout, renderedMap.space);
  }
  updateSearchResultNotice();
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
    const savedOutputMode = localStorage.getItem("parkingGuideVoiceOutputModeV3");
    const previousOutputMode = localStorage.getItem("parkingGuideVoiceOutputModeV2");
    const legacyOutputMode = localStorage.getItem("parkingGuideVoiceOutputMode");
    state.voiceOutputMode = restoreVoiceOutputMode(
      savedOutputMode ?? (previousOutputMode === "mix" ? "mix" : null),
      previousOutputMode ?? legacyOutputMode,
    );
    const profiles = JSON.parse(localStorage.getItem("parkingGuideVoiceProfiles") || "{}");
    state.voiceProfiles = profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles : {};
    state.cloudVoiceEnabled = localStorage.getItem("parkingGuideCloudVoiceEnabled") === "true";
    localStorage.removeItem("parkingGuideVoiceURI");
  } catch {
    state.guidanceVoiceLanguage = "en-US";
    state.voiceOutputMode = getDefaultVoiceOutputMode();
    state.cloudVoiceEnabled = false;
  }
  applyLanguage(saved);
}

/* 選択施設からこの距離以内へ入ると、自動で案内先を表示する。 */
const AUTO_GUIDANCE_DISTANCE_KM = 0.25;
const AUTO_GUIDANCE_MAX_ACCURACY_METERS = 80;
const PRIVATE_TEST_FACILITY_ID = "home-test-001";
const PRIVATE_TEST_COORDINATE_STORAGE_KEY = "parkingGuidePrivateTestCoordinatesV1";
// 実験施設ごとに別の座標を保持する。自宅の旧保存キーは変更しない。
function isPrivateTestFacility(facility) {
  return Boolean(facility?.requiresLocalCalibration || facility?.id === PRIVATE_TEST_FACILITY_ID);
}
function privateTestStorageKey(facility) {
  return facility?.id && facility.id !== PRIVATE_TEST_FACILITY_ID
    ? `${PRIVATE_TEST_COORDINATE_STORAGE_KEY}:${facility.id}`
    : PRIVATE_TEST_COORDINATE_STORAGE_KEY;
}
const RANDOM_GUIDANCE_FACILITY_IDS = new Set(["target_021", PRIVATE_TEST_FACILITY_ID]);

const SCREEN_ORDER = Object.freeze(["facility", "condition", "waiting", "result"]);

const state = {
  currentScreen: "facility",
  language: "ja",
  voiceEnabled: true,
  guidanceVoiceLanguage: "en-US",
  voiceOutputMode: getDefaultVoiceOutputMode(),
  voiceProfiles: {},
  cloudVoiceEnabled: false,
  lastSearchWasAuto: false,
  selectedFacility: null,
  selectedDestination: null,
  resolvedFacilityCoordinates: new Map(),
  resolvingFacilityCoordinates: new Map(),
  // 店舗ごとのデモ状態を保持し、再描画やGPS更新だけでは抽選し直さない。
  demoParkingSpaces: new Map(),
  selectedPriority: "balanced",
  requestedSpaceType: "standard",
  autoProximityArmed: false,
  autoTriggeredFacilityId: null,
  proximitySearchRunning: false,
  pendingPrivateTestCalibration: false,
  searchOutcome: null,
  resultSimulation: false,
  resultLive: false,
  recommendedSpace: null,
  arrivalCheck: null, // 既存の案内先とカメラの検知結果を対応付ける。
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
const voiceSelect = document.querySelector("#voice-select");
const voiceRateSelect = document.querySelector("#voice-rate");
const voiceVolumeInput = document.querySelector("#voice-volume");
const voiceVolumeLabel = document.querySelector("#voice-volume-label");
const voicePreviewButton = document.querySelector("#voice-preview-button");
const voicePrepareButton = document.querySelector("#voice-prepare-button");
const voicePrepareStatus = document.querySelector("#voice-prepare-status");
const voiceOutputModeSelect = document.querySelector("#voice-output-mode");
const cloudVoiceInput = document.querySelector("#cloud-voice-enabled");
const cloudVoiceDiagnostic = document.querySelector("#cloud-voice-diagnostic");
const voiceOutputTestButton = document.querySelector("#voice-output-test-button");
const voiceOutputStatus = document.querySelector("#voice-output-status");
const voiceStatus = document.querySelector("#voice-status");
const randomGuidanceNote = document.querySelector("#random-guidance-note");
const privateTestLocationPanel = document.querySelector("#private-test-location-panel");
const privateTestLocationStatus = document.querySelector("#private-test-location-status");
const privateTestLocationTitle = document.querySelector("#private-test-location-title");
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
const noSpaceContent = document.querySelector("#no-space-content");
const noSpaceDescription = document.querySelector("#no-space-description");
const noSpaceTitle = document.querySelector("#no-space-title");
const congestionNotice = document.querySelector("#congestion-notice");
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
const parkingArrivalPanel = document.querySelector("#parking-arrival-panel");
const parkingArrivalStatus = document.querySelector("#parking-arrival-status");
const parkingArrivalConfirm = document.querySelector("#parking-arrival-confirm");

/* =========================================================
   既存の案内先への駐車をカメラで確認する。
   新たな区画登録や区画変更は行わない。
   個人の車かは識別できないため、最後は本人確認が必要。
   ========================================================= */
function startArrivalCheck(facility, space, live) {
  state.arrivalCheck = (live && facility?.id === PRIVATE_TEST_FACILITY_ID && space?.uid)
    ? { facilityId: facility.id, uid: space.uid, startedAt: Date.now(),
        occupiedSince: null, hitCount: 0, confirmed: false }
    : null;
  updateParkingArrivalPanel();
}

function updateParkingArrivalPanel() {
  if (!parkingArrivalPanel) return;
  const check = state.arrivalCheck;
  const visible = state.currentScreen === "result"
    && state.resultLive
    && state.searchOutcome === "found"
    && check?.uid === state.recommendedSpace?.uid
    && check.facilityId === state.selectedFacility?.id;
  parkingArrivalPanel.hidden = !visible;
  if (!visible) return;
  parkingArrivalConfirm.disabled = !check.confirmed;
  const info = window.ParkingLiveStatus?.snapshot(check.facilityId);
  if (!info?.published || info.error) {
    parkingArrivalStatus.textContent = ui(
      "カメラの最新情報を取得できません。案内終了は自動判定できません。",
      "Camera status is unavailable. Parking cannot be verified.",
    );
    check.confirmed = false;
    parkingArrivalConfirm.disabled = true;
    return;
  }
  const row = info.rows?.get(check.uid);
  const timestamp = Date.parse(row?.checked_at || "");
  const now = Date.now();
  const fresh = Number.isFinite(timestamp) && timestamp <= now + 5000
    && now - timestamp <= 20000;
  if (!fresh || row?.status !== "occupied" || timestamp <= check.startedAt) {
    check.occupiedSince = null;
    check.hitCount = 0;
    check.confirmed = false;
    parkingArrivalStatus.textContent = ui(
      "案内先の駐車をカメラで確認しています。停車するまで操作しないでください。",
      "Waiting for camera confirmation at your assigned space.",
    );
    parkingArrivalConfirm.disabled = true;
    return;
  }
  if (check.occupiedSince === null) check.occupiedSince = now;
  check.hitCount += 1;
  check.confirmed = check.hitCount >= 2 && now - check.occupiedSince >= 2000;
  parkingArrivalStatus.textContent = check.confirmed
    ? ui(
        "カメラが案内先への駐車を検知しました。自分の車であることを停車後に確認してください。",
        "A car was detected in your assigned space. Confirm it is your car after parking.",
      )
    : ui("駐車を検出しました。続けて確認しています…", "Parking detected; checking again…");
  parkingArrivalConfirm.disabled = !check.confirmed;
}

parkingArrivalConfirm?.addEventListener("click", () => {
  if (!state.arrivalCheck?.confirmed || parkingArrivalConfirm.disabled) return;
  if (window.parkingSafety && !window.parkingSafety.guardOperation()) return;
  // The camera confirms occupancy, not the user's identity.
  endGuidance();
});

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
function readPrivateTestCoordinate(facility = state.selectedFacility) {
  try {
    const saved = JSON.parse(localStorage.getItem(privateTestStorageKey(facility)) ?? "null");
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
    localStorage.setItem(privateTestStorageKey(state.selectedFacility), JSON.stringify({
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
    localStorage.removeItem(privateTestStorageKey(state.selectedFacility));
  } catch {
    /* 保存領域を利用できない環境では何もしない。 */
  }
}

/** 自宅テスト用の端末内登録状態を条件画面へ反映する。 */
function updatePrivateTestLocationPanel() {
  const isPrivateTest = isPrivateTestFacility(state.selectedFacility);
  if (privateTestLocationPanel) privateTestLocationPanel.hidden = !isPrivateTest;
  if (!isPrivateTest || !privateTestLocationStatus) return;
  if (privateTestLocationTitle) privateTestLocationTitle.textContent = ui(
    `${getFacilityDisplayName(state.selectedFacility)}：実験地点（現在地）`,
    `Test location (current position): ${getFacilityDisplayName(state.selectedFacility)}`,
  );
  const saved = readPrivateTestCoordinate(state.selectedFacility);
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
  if (!facility || isPrivateTestFacility(facility)) {
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
  if (isPrivateTestFacility(facility)) {
    // 公開住所・管理用航空写真の座標を代用せず、この施設専用の登録地点だけを使う。
    return readPrivateTestCoordinate(facility);
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
    distanceElement.textContent = "";
  } else {
    distanceElement.textContent = facility.isDemo && !state.userLocation
      ? ui(`参考距離 約${distance.toFixed(1)} km`, `Reference distance about ${distance.toFixed(1)} km`)
      : ui(`現在地から直線 約${distance.toFixed(1)} km`, `About ${distance.toFixed(1)} km straight-line from your location`);
  }

  button.setAttribute(
    "aria-label",
    [getFacilityDisplayName(facility), getCategoryLabel(facility.category), distanceElement.textContent, getOccupancyLabel(getFacilityOccupancy(facility))].filter(Boolean).join("、"),
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
      const occupancy = getFacilityOccupancy(facility);
      action.className = "facility-action facility-availability";
      const badge = document.createElement("span");
      badge.className = `availability-badge availability-${occupancy.level}`;
      badge.textContent = isEnglish() ? ({rest:"Day off",closed:"Closed",full:"Full",busy:"Busy",open:"Open",unknown:"—"}[occupancy.level]) : ({rest:"休",closed:"閉",full:"満",busy:"混",open:"空",unknown:"—"}[occupancy.level]);
      const source = document.createElement("small");
      source.textContent = facility.id === VIDEO_REPLAY_FACILITY_ID
        ? ui("録画YOLO実演・現在の空きではありません", "Recorded YOLO demo · not current") :
        facility.isRecordedExperiment && !occupancy.live
        ? ui("録画実験・現在未確認", "Recorded experiment") :
        occupancy.simulation ? ui("デモ", "Demo") : ui("登録データ", "Saved data");
      action.append(badge, source);
      action.title = getOccupancyLabel(occupancy);
    }

    const hours = document.createElement("span");
    hours.className = "facility-hours";
    const operation = getOperatingStatus(facility,null);
    hours.textContent = ui("営業時間：", "Hours: ") + (operation?.hours || ui("未登録", "Not provided"));
    main.append(name, meta, hours);
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
    renderFacilities();
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

  const targetBuildingId = state.selectedDestination?.buildingId ?? facility?.targetBuildingId ?? null;
  const targetIds = new Set([targetBuildingId,...(state.selectedDestination?.buildingAliases || [])]);

  if (targetBuildingId) {
    const matching = entrances.filter(
      (entrance) => targetIds.has(entrance.buildingId),
    );
    return matching.find((entrance) => entrance.guideTarget === true)
      ?? matching[0]
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
    .filter((object) => mapDisplay.isGuidableType(object.spaceType ?? "standard"))
    .filter((object) => Number.isFinite(object.x) && Number.isFinite(object.y))
    .map((object, index) => {
      const distance = calculateLayoutDistance(object, entrance, layout);
      const status = object.status ?? "unknown";
      const width = Number(object.width) || 0;
      const height = Number(object.height) || 0;

      return {
        id: mapDisplay.spaceName(object) || object.uid || `区画${index + 1}`,
        uid: object.uid || `space_${index + 1}`,
        number: index + 1,
        isOccupied: status !== "available",
        occupancyStatus: status,
        isWide: object.spaceType === "accessible" || width > height * 0.65,
        spaceType: object.spaceType ?? "standard",
        entranceDistanceMeters: distance.meters,
        distanceScore: distance.score,
        sourceObject: object,
      };
    });
}

/** レイアウト未登録時に動作確認用の12区画を作る。 */
function createDemoParkingSpaces() {
  // 空車・混雑・満車を各1/3で抽選する。実店舗の状況を表す値ではない。
  const level = ["open", "busy", "full"][Math.floor(Math.random() * 3)];
  const availableCount = level === "full" ? 0 : level === "busy"
    ? 1 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 9);
  const shuffled = Array.from({ length: 12 }, (_, index) => index + 1);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  const availableNumbers = new Set(shuffled.slice(0, availableCount));
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
      isOccupied: !availableNumbers.has(number),
      occupancyStatus: availableNumbers.has(number) ? "available" : "occupied",
      isWide: spaceType === "accessible",
      spaceType,
      entranceDistanceMeters: distanceMeters,
      distanceScore: distanceMeters,
      sourceObject: null,
    };
  });
}

function getDemoParkingSpaces(facility) {
  const id = facility?.id ?? DEMO_FACILITY.id;
  if (!state.demoParkingSpaces.has(id)) {
    state.demoParkingSpaces.set(id, createDemoParkingSpaces());
  }
  // 案内候補の処理から、一覧側の保持データを変更させない。
  return state.demoParkingSpaces.get(id).map((space) => ({ ...space }));
}

/** 日光の過去録画は8区画。現在の映像がないときは全区画を未確認にする。 */
function getRecordedExperimentUnknownSpaces(facility) {
  const count = Number.isInteger(facility?.researchSpaceCount)
    && facility.researchSpaceCount > 0 && facility.researchSpaceCount <= 100
    ? facility.researchSpaceCount : 8;
  return Array.from({ length: count }, (_, index) => ({
    id: `space_${String(index + 1).padStart(3, "0")}`,
    uid: `space_${String(index + 1).padStart(3, "0")}`,
    number: index + 1,
    isOccupied: true,
    occupancyStatus: "unknown",
    isWide: false,
    spaceType: "standard",
    entranceDistanceMeters: null,
    distanceScore: Infinity,
    sourceObject: null,
  }));
}

/** 基本5種類以外は分類付きセレクトへまとめる。 */
function updateExtendedSpaceTypes(){
  const select=document.querySelector('#extended-space-type');if(!select)return;
  const selected=select.value,groups=new Map();select.replaceChildren();
  for(const [key,preset] of Object.entries(mapDisplay.spacePresets)){
    if(['standard','compact','accessible','ev','priority'].includes(key)||!preset.guidable)continue;
    if(!groups.has(preset.group)){const g=document.createElement('optgroup');g.label=isEnglish()?({'乗用車':'Passenger vehicles','大型車・貨物車':'Large vehicles / trucks','バス':'Buses','二輪・自転車':'Bikes / mobility','優先・配慮':'Priority','充電':'Charging','専用・契約':'Dedicated / permit','荷さばき':'Loading'})[preset.group]||preset.group:preset.group;groups.set(preset.group,g);select.append(g);}
    const option=document.createElement('option');option.value=key;option.textContent=getSpaceTypeLabel(key);groups.get(preset.group).append(option);
  }
  if(selected&&mapDisplay.isGuidableType(selected))select.value=selected;
  select.onchange=()=>{document.querySelector('input[name="spaceType"][value="extended"]').checked=true;};
}

/** 希望条件に合う空き区画を1件選ぶ。 */
function selectRecommendedSpace(spaces, priority, requestedSpaceType = "standard", randomize = false) {
  const availableSpaces = spaces.filter((space) =>
    !space.isOccupied && mapDisplay.isGuidableType(space.spaceType) && space.spaceType === requestedSpaceType,
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
    roadSign: [10, 12],
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
  const extent=Math.max(Math.max(...bounds.map(b=>b.maxX))-Math.min(...bounds.map(b=>b.minX)),Math.max(...bounds.map(b=>b.maxY))-Math.min(...bounds.map(b=>b.minY)));
  const logicalPadding = Math.max(.001,extent*.04);
  const minX = Math.max(0, Math.min(...bounds.map((item) => item.minX)) - logicalPadding);
  const minY = Math.max(0, Math.min(...bounds.map((item) => item.minY)) - logicalPadding);
  const maxX = Math.min(canvasWidth, Math.max(...bounds.map((item) => item.maxX)) + logicalPadding);
  const maxY = Math.min(canvasHeight, Math.max(...bounds.map((item) => item.maxY)) + logicalPadding);

  return {
    x: minX,
    y: minY,
    width: Math.max(.001, maxX - minX),
    height: Math.max(.001, maxY - minY),
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
  const focused=mapViewMode === "focus" && points.length>0;
  const horizontalPadding = focused ? Math.min(80, screenWidth * 0.24) : 18;
  const verticalPadding = focused ? 64 : 44;
  const width = Math.max(.001, bounds.width) / Math.max(0.1, 1 - 2 * horizontalPadding / screenWidth);
  const height = Math.max(.001, bounds.height) / Math.max(0.1, 1 - 2 * verticalPadding / screenHeight);
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

let guidanceLabelRects = [];

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
  const bounds = {width:parkingMap.clientWidth || 360,height:parkingMap.clientHeight || 400};
  const anchor = {x:(Number(object.x)+width/2-crop.x)*crop.scale,y:(Number(object.y)+height/2-crop.y)*crop.scale};
  const labelWidth = Math.min(bounds.width-8, kind === "space" ? Math.max(90,Math.min(164,mapDisplay.units(text)*25+20)) : 112);
  const labelHeight = kind === "space" ? 62 : 38;
  const rect = mapDisplay.placeLabel(anchor,labelWidth,labelHeight,guidanceLabelRects,bounds);
  guidanceLabelRects.push(rect);
  label.style.left = `${rect.x-anchor.x}px`;
  label.style.top = `${rect.y-anchor.y}px`;
  label.style.bottom = "auto";
  label.style.width = `${rect.width}px`;
  label.style.height = `${rect.height}px`;
  label.style.transform = "none";
  label.style.setProperty("--guidance-number-size", `${mapDisplay.fitLabel(text,rect.width-20,38,28)}px`);
  marker.append(label);
  parkingMap.append(marker);
}

/** 管理画面の配置を使い、案内に必要な情報を利用者向けに表示する。 */
function renderRegisteredLayout(layout, recommendedSpace) {
  parkingMap.replaceChildren();
  guidanceLabelRects = [];
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

  const supportedTypes = new Set(mapDisplay.types);

  const entrance = state.guideEntrance;
  const crop = calculateGuidanceViewport(layout, recommendedSpace, supportedTypes, entrance);
  parkingMap.removeAttribute("style");
  parkingMap.dataset.cropped = "true";
  parkingMap.dataset.viewMode = mapViewMode;
  parkingMap.setAttribute("aria-label", ui(
    `駐車場マップ。案内先 ${recommendedSpace?.id ?? ""}。${entrance ? "対象の店舗入口を表示しています。" : "案内対象の入口は未登録です。"}`,
    `Parking map. Your space: ${recommendedSpace?.id ?? ""}. ${entrance ? "The destination entrance is shown." : "No destination entrance is registered."}`,
  ));

  const visibleSpaceStates = new Map(state.currentSpaces.map(space => [space.uid, space.occupancyStatus]));
  const videoPhaseLabels = {
    available: ui("空き", "Available"),
    parking_in: ui("駐車中", "Parking in"),
    stopped: ui("停車中", "Stopped"),
    exiting: ui("出庫中", "Exiting"),
    unknown: ui("確認中", "Checking"),
  };
  const visibleSpacePhases = new Map(state.currentSpaces.map(space => [space.uid, space.occupancyPhase]));
  layout.objects
    .filter((object) => supportedTypes.has(object.objectType))
    .forEach((object) => {
      const displayStatus = object.objectType === "parkingSpace"
        ? visibleSpaceStates.get(object.uid) ?? object.status : object.status;
      const item = document.createElement("div");
      item.className = `map-object map-object--${object.objectType}`;
      item.dataset.objectType = object.objectType;
      item.dataset.screenScale = String(crop.scale);
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

      if (object.objectType === "roadSign") mapDisplay.appendSign(item,object);
      if (object.objectType === "pavementMarking") mapDisplay.appendPavement(item,object);
      if (mapDisplay.roads.has(object.objectType)) {
        mapDisplay.appendRoute(item,object,layout);
        mapDisplay.appendSurface(item,object,layout);
      }
      const appendLabel = (text) => {
        if (!text) return;
        const label = document.createElement("span");
        label.className = "map-object-label";
        label.textContent = text;
        mapDisplay.applyTypography(item,{...object,name:text},crop.scale);
        label.title = text;
        label.style.position = "absolute";
        label.style.inset = "10%";
        label.style.transform = "none";
        item.append(label);
      };

      if (object.objectType === "parkingSpace") {
        item.dataset.spaceType = object.spaceType ?? "standard";
        item.dataset.markingStyle = object.markingStyle ?? "uShape";
        item.style.setProperty("--space-line-color", object.markingColor ?? "#ffffff");
        item.style.setProperty("--space-line-width", `${Math.max(.2,(Number(object.markingWidth)||.35)*crop.scale)}px`);
        item.style.setProperty("--map-number-color", "var(--color-text)");
        mapDisplay.appendParking(item,object);

        mapDisplay.appendType(item,object);
        const displayNumber = [mapDisplay.displayGroupName(object),mapDisplay.spaceNumber(object)].filter(Boolean).join("\n");
        mapDisplay.applyTypography(item,object,crop.scale);
        if (object.uid !== recommendedSpace?.uid && objectWidth*crop.scale >= 6) {
          const numberMark=document.createElement("span");numberMark.className="space-number-mark";numberMark.textContent=displayNumber;numberMark.setAttribute("aria-hidden","true");item.append(numberMark);
        }

        const isRecommended = object.uid === recommendedSpace?.uid;
        const isOccupied = !mapDisplay.isGuidableType(object.spaceType ?? "standard") || displayStatus !== "available";
        item.classList.toggle("is-occupied", isOccupied);
        item.classList.toggle("is-blocked", displayStatus === "blocked");
        item.classList.toggle("is-recommended", isRecommended && !isOccupied);
        const phase = state.selectedFacility?.id === VIDEO_REPLAY_FACILITY_ID
          ? visibleSpacePhases.get(object.uid) : null;
        if (phase && videoPhaseLabels[phase]) {
          const phaseTag = document.createElement("span");
          phaseTag.className = "replay-phase-badge";
          phaseTag.dataset.phase = phase;
          phaseTag.textContent = videoPhaseLabels[phase];
          phaseTag.setAttribute("aria-hidden", "true");
          item.append(phaseTag);
          item.dataset.replayPhase = phase;
        }
        item.setAttribute("role", "listitem");
        item.setAttribute(
          "aria-label",
          `${mapDisplay.displaySpaceName(object) || ui("区画","Space")}、${phase && videoPhaseLabels[phase] ? videoPhaseLabels[phase] : isRecommended && !isOccupied ? ui("案内先","Destination") : displayStatus === "occupied" ? ui("使用中","Occupied") : displayStatus === "blocked" ? ui("障害物あり","Blocked") : displayStatus === "unavailable" ? ui("利用不可","Unavailable") : isOccupied ? ui("未確認","Unknown") : ui("空き","Available")}`,
        );
      } else if (object.objectType === "buildingEntrance") {
        mapDisplay.appendEntrance(item,object);
        // 非公開入口は利用者の入口表示から除く。対象入口だけに大きいラベルを付ける。
        if (object.publicAccess === false) return;
        item.setAttribute("aria-label", mapDisplay.displayName(object) || ui("建物入口", "Building entrance"));
        item.classList.toggle("is-guide-entrance", object.uid === entrance?.uid);
      } else if (object.objectType === "parkingEntrance") {
        mapDisplay.appendEntrance(item,object);
        const accessLabel = object.accessType === "entrance"
          ? ui("入口", "Entrance")
          : object.accessType === "exit"
            ? ui("出口", "Exit")
            : ui("出入口", "Access");
        const defaultNames = new Set(["駐車場入口", "駐車場出口", "駐車場出入口", "Parking entrance", "Parking exit", "Parking access"]);
        const customName = mapDisplay.displayName(object).trim();
        appendLabel(customName && !defaultNames.has(customName)
          ? `${accessLabel}｜${customName}`
          : ui(`駐車場${accessLabel}`, `Parking ${accessLabel.toLowerCase()}`));
        item.dataset.accessType = object.accessType ?? "both";
      } else if (object.objectType === "road") {
        if (object.trafficDirection === "oneWay") {
          item.setAttribute("aria-label", ui("一方通行", "One way"));
          item.dataset.trafficDirection = "oneWay";
        }
      } else if (object.objectType === "noEntry") {
        mapDisplay.appendSign(item,{...object,signType:"noEntry"});
        item.setAttribute("aria-label",ui("進入禁止","No entry"));
      } else if (object.objectType === "evCharger") {
        appendLabel(mapDisplay.displayName(object) || "EV充電");
      } else if (["stopLine", "speedBump", "cartCorral", "bicycleParking",
        "motorcycleParking", "loadingZone", "parkingLot"].includes(object.objectType)) {
        // 形状を残し、管理用の名称・コピー名は利用者マップへ表示しない。
      } else if (object.objectType === "building") {
        appendLabel(mapDisplay.displayName(object) || ui("建物","Building"));
      } else if (object.objectType === "roadSign") {
        item.setAttribute("aria-label",mapDisplay.displayName(object) || "道路標識");
      } else if (object.objectType === "excludedParkingLot") {
        appendLabel(mapDisplay.displayName(object) || "対象外駐車場");
      } else if (object.objectType === "nationalRoad") {
        if (!object.routeNumber) appendLabel(mapDisplay.displayName(object) || "国道");
      } else if (object.objectType === "prefecturalRoad") {
        if (!object.routeNumber) appendLabel(mapDisplay.displayName(object) || "県道");
      } else if (object.objectType === "publicRoad") {
        appendLabel(mapDisplay.displayName(object) || "公道");
      }

      parkingMap.append(item);
      // 建物名称の領域を予約し、案内ラベルが名称を隠さないようにする。
      if (object.objectType === "building" && item.querySelector(".map-object-label")) {
        const labelBounds = item.querySelector(".map-object-label").getBoundingClientRect?.();
        const mapBounds = parkingMap.getBoundingClientRect?.();
        if (labelBounds?.width > 0 && mapBounds) guidanceLabelRects.push({
          x: labelBounds.left-mapBounds.left, y: labelBounds.top-mapBounds.top,
          width: labelBounds.width, height: labelBounds.height,
        });
      }
    });
  if (recommendedSpace?.sourceObject) {
    const object = recommendedSpace.sourceObject;
    appendGuidanceMarker(object, crop, "space", mapDisplay.displaySpaceName(object) || recommendedSpace.id);
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
  if (screenName !== "result") window.ParkingLiveStatus?.stop();
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

/** 保存レイアウトの店舗情報を優先し、旧データの建物IDも維持する。 */
function getFacilityDestinations(facility = state.selectedFacility) {
  const saved=getFacilityLayout(facility)?.destinations;
  return (Array.isArray(saved)?saved:facility?.destinations || []).filter(d=>d && typeof d.id==="string" && typeof d.name==="string");
}
function getOperatingStatus(facility=state.selectedFacility, destination=state.selectedDestination) {
  const site=getFacilityLayout(facility)?.operations || facility?.operations;
  const siteStatus=window.ParkingOperations?.operating(site);
  if(siteStatus?.closed || !destination?.operations)return siteStatus;
  return window.ParkingOperations?.operating(destination.operations);
}
let lastClosingAnnouncementKey="";
function getClosingAnnouncementKey() {
  const operation=getOperatingStatus();
  return operation?.closingSoon?`${state.selectedFacility?.id}:${state.selectedDestination?.id||""}:${operation.closingKey}`:"";
}
function announceClosingTimeIfNeeded() {
  if(document.hidden || !state.voiceEnabled || !["waiting","result"].includes(state.currentScreen))return false;
  const key=getClosingAnnouncementKey();
  if(!key || key===lastClosingAnnouncementKey || window.speechSynthesis?.speaking)return false;
  const spoken=speakText(getClosingAnnouncement());
  if(spoken)lastClosingAnnouncementKey=key;
  return spoken;
}
function getClosingAnnouncement(locale=getGuidanceSpeechLocale()) {
  if(!getOperatingStatus()?.closingSoon)return "";
  const messages={"ja-JP":"まもなく、へいてんじこくです。へいてんまで、いちじかんいないです。", "en-US":"This destination closes within one hour. ","en-GB":"This destination closes within one hour. ","zh-CN":"目的地将在一小时内结束营业。", "ko-KR":"목적지가 한 시간 이내에 영업을 종료합니다. ","es-ES":"Este destino cierra en menos de una hora. "};
  return messages[locale] || messages["en-US"];
}
function updateDestinationCards() {
  const host=document.querySelector("#destination-cards");if(!host)return;
  host.replaceChildren();
  for(const destination of getFacilityDestinations()){
    const status=getOperatingStatus(state.selectedFacility,destination);
    const button=document.createElement("button");button.type="button";button.className="destination-card";
    button.dataset.destinationId=destination.id;
    button.setAttribute("aria-pressed",String(state.selectedDestination?.id===destination.id));
    const name=document.createElement("strong");name.textContent=isEnglish()?(destination.nameEn||destination.name):destination.name;
    const hours=document.createElement("span");hours.textContent=status?.hours || ui("営業時間未登録","Hours not provided");
    const detail=document.createElement("small");detail.textContent=status?.closureKind==="rest"?ui("休：定休日・臨時休業","Day off / temporarily closed"):status?.preOpening?ui("閉：開店前（案内可能）","Closed before opening · early guidance available"):status?.closed?ui("閉：営業時間外","Closed outside opening hours"):status?.closingSoon?ui("閉店まで1時間以内","Closes within one hour"):status?.unknown?ui("営業時間未確認","Hours unverified"):ui("営業中","Open");
    button.append(name,hours,detail);
    button.onclick=()=>{destinationSelect.value=destination.id;saveSelectedDestination();updateDestinationCards();};
    host.append(button);
  }
}

/** 複合施設だけ目的店舗選択を表示する。 */
function updateDestinationPanel() {
  const facility = state.selectedFacility;
  const destinations = getFacilityDestinations(facility);
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
    state.selectedDestination = destinations.find(item=>item.id===state.selectedDestination.id);
    destinationSelect.value = state.selectedDestination.id;
  } else {
    state.selectedDestination = null;
    destinationSelect.value = "";
  }
  updateDestinationCards();
}

/** 現在のプルダウンから目的店舗を状態へ反映する。 */
function saveSelectedDestination() {
  const destinations = getFacilityDestinations();
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
      "研究用：空き区画からランダムに案内します。",
      `For ${getFacilityDisplayName(state.selectedFacility)}, this prototype selects one matching available space at random.`,
    );
  }
}

/** Google Maps検索URLを施設情報から生成する。 */
function getFacilityGoogleMapsUrl(facility) {
  if (!facility) return null;

  if (isPrivateTestFacility(facility)) {
    const coordinate = readPrivateTestCoordinate(facility);
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
  waitingFacilityAddress.textContent = isPrivateTestFacility(facility)
    ? ui(
        "現在地を実験用所在地として端末内に登録（実施設の住所ではありません）",
        "Current position is the device-local test location, not the real facility address",
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
  waitingGoogleMapsNote.hidden = !isPrivateTestFacility(facility) || !mapsUrl;
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
  const selectedType = checkedSpaceType?.value === "extended"
    ? document.querySelector('#extended-space-type')?.value : checkedSpaceType?.value;
  state.requestedSpaceType = mapDisplay.isGuidableType(selectedType) ? selectedType : "standard";
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
    setProximityMessage(isPrivateTestFacility(state.selectedFacility)
      ? ui(
          "現在地をこの端末に実験地点として登録すると、250m接近時の自動案内を利用できます。",
          "Save the current position as the test point to use automatic guidance within 250 m.",
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
  if (getOperatingStatus(facility, facility===state.selectedFacility?state.selectedDestination:null)?.closed) return {layout, spaces:[], entrance:null, isSimulation:false, isLive:false};
  if (layout) {
    const live = window.ParkingLiveStatus?.snapshot(facility.id)?.published === true;
    let spaces = window.ParkingLiveStatus?.apply(
      facility.id, createLayoutParkingSpaces(layout, facility),
    ) ?? createLayoutParkingSpaces(layout, facility);
    if (facility.isRecordedExperiment && !live) {
      // 編集画面で仮設定した空きや録画結果を、現在の空きとして案内しない。
      spaces = spaces.map(space => ({ ...space, isOccupied: true, occupancyStatus: "unknown" }));
    }
    return { layout, spaces:window.ParkingOperations?.shared(spaces) ?? spaces, entrance: getGuideEntrance(layout, facility), isSimulation: false, isLive: live };
  }

  return {
    layout: null,
    spaces: facility.isRecordedExperiment
      ? getRecordedExperimentUnknownSpaces(facility) : getDemoParkingSpaces(facility),
    entrance: null,
    isSimulation: true,
  };
}

/**
 * カメラ情報が変わったらマップと警告だけを更新する。
 * 運転中に勝手に案内先を変更したり、音声を割り込ませたりしない。
 */
function beginLiveUpdates(facility) {
  // 自宅の実地実験中は未公開でも公開状態を定期確認する。
  // 動画実演も公開OFF→ONの切替をユーザー画面に反映する。
  // 現在の自宅駐車場とは別施設なので、録画を実ライブとは表示しない。
  if ((!state.resultLive && facility.id !== PRIVATE_TEST_FACILITY_ID
       && facility.id !== VIDEO_REPLAY_FACILITY_ID)
      || !window.ParkingLiveStatus) return;
  window.ParkingLiveStatus.watch(facility.id, () => {
    if (state.currentScreen !== "result" || state.selectedFacility !== facility) return;
    const current = prepareSpaces(facility);
    state.currentSpaces = current.spaces;
    state.resultLive = current.isLive === true;
    if (state.recommendedSpace && state.currentLayout) {
      renderParkingMap(state.currentSpaces, state.recommendedSpace, state.currentLayout);
    }
    updateSearchResultNotice();
    updateParkingArrivalPanel();
    renderFacilities();
  });
}

/** 状態が不明な区画や利用不可の区画を「空き」に数えない。混雑の閾値は研究用。 */
function summarizeOccupancy(spaces, simulation = false, live = false) {
  const usable = spaces.filter(space => space.occupancyStatus !== "unavailable");
  const available = usable.filter(space => !space.isOccupied).length;
  const unknown = usable.filter(space => space.occupancyStatus === "unknown" ||
    (space.occupancyStatus && !["available", "occupied"].includes(space.occupancyStatus))).length;
  const total = usable.length;
  const level = !total || unknown ? "unknown" : !available ? "full"
    : available <= 3 || available / total <= 0.2 ? "busy" : "open";
  return { available, total, unknown, level, simulation, live };
}
function getFacilityOccupancy(facility) {
  const operatingStatus=getOperatingStatus(facility,null);
  if (operatingStatus?.closureKind==="rest") {
    return {level:"rest", available:0, total:0, unknown:0};
  }
  // 開店60分前の案内は可能だが、実際の営業時間前なので施設一覧には「閉」と表示する。
  if (operatingStatus?.closed || operatingStatus?.preOpening) {
    return {level:"closed",preOpening:operatingStatus.preOpening===true, available:0, total:0, unknown:0};
  }
  const prepared = prepareSpaces(facility);
  return { ...summarizeOccupancy(prepared.spaces, prepared.isSimulation, prepared.isLive),
    recordedExperiment: facility?.isRecordedExperiment === true,
    videoDemo: facility?.id === VIDEO_REPLAY_FACILITY_ID };
}
function getOccupancyLabel(occupancy) {
  const source = occupancy.videoDemo
    ? ui("録画映像を逐次YOLO判定・実際の空きではありません",
         "Recorded YOLO replay · not current availability")
    : occupancy.live ? ui("カメラ確認", "Camera verified")
    : occupancy.recordedExperiment ? ui("録画実験・現在未確認", "Recorded experiment · not live")
    : occupancy.simulation ? ui("デモ", "Demo") : ui("登録データ", "Saved data");
  const label = {rest:ui("休業日（休）", "Day off"),closed:occupancy.preOpening?ui("開店前（閉）・案内可能", "Before opening · early guidance available"):ui("営業時間外（閉）", "Closed outside opening hours"),full:ui("満車", "Full"),busy:ui("混雑", "Busy"),open:ui("空きあり", "Spaces available"),unknown:ui("空き状況未確認", "Availability unknown")}[occupancy.level];
  return `${label} · ${source}${!["unknown", "closed", "rest"].includes(occupancy.level) ? ui(` · 空き${occupancy.available}区画`, ` · ${occupancy.available} free spaces`) : ""}`;
}
function updateSearchResultNotice() {
  if (!state.searchOutcome) return;
  const occupancy = { ...getFacilityOccupancy(state.selectedFacility),
    recordedExperiment: state.selectedFacility?.isRecordedExperiment === true };
  const homeTest = state.selectedFacility?.id === PRIVATE_TEST_FACILITY_ID;
  const cameraState = homeTest ? window.ParkingLiveStatus?.snapshot(PRIVATE_TEST_FACILITY_ID) : null;
  const liveNotPublished = homeTest && cameraState?.published !== true;
  const liveError = homeTest && cameraState?.published === true && cameraState.error;
  const isOperating = occupancy.level !== "rest" && occupancy.level !== "closed";
  if (state.arrivalCheck?.confirmed && state.arrivalCheck.uid === state.recommendedSpace?.uid) {
    searchStatus.textContent = ui(
      "案内先で駐車を検知しました。停車後に自分の車か確認して案内を終了してください。",
      "Parking detected at your assigned space. Confirm your own car to finish guidance.",
    );
    return;
  }
  const chosenIsUnavailable = state.resultLive && state.recommendedSpace
    && state.currentSpaces.some(space => space.uid === state.recommendedSpace.uid && space.isOccupied);
  searchStatus.textContent = chosenIsUnavailable
    ? ui("案内先の状況が変わりました。安全な場所に停車して「空き状況を更新」を押してください。", "The recommended space has changed. Stop safely and tap Refresh availability.")
    : (isOperating && liveNotPublished
      ? ui("カメラ空き情報：利用者への公開OFF。管理者アプリで公開を許可してください。", "Live camera status is not published to users. Enable sharing in the admin app.")
      : isOperating && liveError
        ? ui("カメラとの通信を確認できません。最新の空きを案内できません。", "Cannot reach the camera status service. Live availability is unverified.")
        : (state.searchOutcome === "not-found" ? ui("駐車場全体：", "Entire parking lot: ") : "")
          + getOccupancyLabel(occupancy)
          + (state.resultLive && state.selectedFacility?.id !== VIDEO_REPLAY_FACILITY_ID
              ? ui("（数秒ごとに更新・現地優先）", " (updates every few seconds; follow on-site signs)")
              : ui("（実際の空き情報ではありません）", " (not live availability)")));
  if (state.selectedFacility?.id === VIDEO_REPLAY_FACILITY_ID) {
    // ここは結果・案内画面でも常に「録画再生中」と明示する。
    searchStatus.textContent = ui(
      "【録画YOLO実演・現在の駐車場ではありません】",
      "[Recorded YOLO demo — not current parking conditions] "
    ) + " " + searchStatus.textContent;
  }
  congestionNotice.hidden = occupancy.level !== "busy" || state.searchOutcome !== "found";
  congestionNotice.textContent = ui(`混雑しています。空きは残り${occupancy.available}区画です。`, `Busy: only ${occupancy.available} spaces remain.`);
  noSpaceContent.hidden = state.searchOutcome !== "not-found";
  if (noSpaceTitle) noSpaceTitle.textContent = isOperating && liveNotPublished
    ? ui("カメラの空き情報が非公開です", "Camera parking data is not published")
    : isOperating && liveError
      ? ui("カメラとの接続を確認できません", "Live camera status unavailable")
      : occupancy.level === "unknown"
        ? ui("空き区画を確認できません", "Available parking not yet confirmed")
        : ui("空き区画が見つかりませんでした", "No available space found");
  noSpaceDescription.textContent = occupancy.level === "rest"
    ? ui("本日は定休日・臨時休業です。別の施設を選んでください。", "This facility is closed for the day. Choose another facility.")
    : occupancy.level === "closed"
    ? (occupancy.preOpening
        ? ui("開店前のため「閉」です。開店60分前から案内可能ですが、実際の入庫は現地の表示を優先してください。", "Before opening. Early guidance is available within 60 minutes; follow on-site parking access signs.")
        : ui("営業時間外のため「閉」です。別の施設を選んでください。", "Outside opening hours. Choose another facility."))
    : isOperating && liveNotPublished
    ? ui("YOLOの判定結果を受け取る設定がOFFです。管理者アプリで「カメラによる空き状況・車両追跡」を開き、状況を確認したうえで「利用者アプリへ最新の空き状況を公開」をONにしてください。設定を変えた後、「空き状況を更新」を押してください。空きの確認なしに案内は行いません。",
         "Camera status sharing is disabled. An administrator must check the camera monitor and enable user sharing, then refresh availability.")
    : isOperating && liveError
    ? ui("カメラの状態を取得できません。通信や公開設定を確認してください。過去の空き情報で案内しません。",
         "Camera status could not be retrieved. Check connectivity and sharing settings; stale free spaces are not used.")
    : occupancy.recordedExperiment && !occupancy.live
    ? ui("ここは過去録画の研究用施設です。現在の空きが確認できないため、ライブ案内はできません。",
         "This is a recorded research facility. Current spaces cannot be verified for live guidance.")
    : occupancy.level === "full"
    ? (state.resultSimulation
        ? ui("デモでは満車です。空き状況を更新すると再抽選します。", "The demo parking lot is full. Refresh availability to draw again.")
        : ui("登録データでは満車です。", "The saved data shows a full parking lot."))
    : state.resultLive
      ? (occupancy.unknown > 0
          ? ui(`カメラが${occupancy.unknown}区画を確認できていません。これは満車を意味しません。現地で空車確認した区画の登録と、YOLOの車両停止判定を確認してください。`,
               `Camera status is unknown for ${occupancy.unknown} spaces; this does not mean the lot is full. Check camera calibration and verified-empty settings.`)
          : ui(`${getSpaceTypeLabel(state.requestedSpaceType)}で案内できる空き区画はありません。区画の種類と実際の空き状況をご確認ください。`,
               `No confirmed free ${getSpaceTypeLabel(state.requestedSpaceType)} space is available. Check the selected space type.`))
      : ui(`${getSpaceTypeLabel(state.requestedSpaceType)}の空き区画が見つかりませんでした。`, `No available ${getSpaceTypeLabel(state.requestedSpaceType)} space was found.`);
}
function getFacilitySpokenName(locale) {
  const facility = state.selectedFacility;
  if (locale === "ja-JP") return facility?.nameReading || window.PARKING_SPEECH_READINGS?.[facility?.id] || getFacilityDisplayName(facility);
  return getFacilityDisplayName(facility);
}
function getNoSpaceGuidanceMessage(locale = getGuidanceSpeechLocale()) {
  const messages = {
    "ja-JP": "あきくかくがみつかりませんでした。こうどうでじゅんばんまちをせず、しゅういのあんぜんをかくにんして、そのままつうかしてください。べつのちゅうしゃじょうをごりようください。",
    "en-US": "No suitable parking space was found. Do not queue on the public road. Check your surroundings, safely continue past the entrance, and use another parking lot.",
    "en-GB": "No suitable parking space was found. Do not queue on the public road. Check your surroundings, safely continue past the entrance, and use another car park.",
    "zh-CN": "未找到合适的空车位。请勿在公共道路上排队等候。确认周围安全后继续通过，请使用其他停车场。",
    "ko-KR": "빈 주차 공간을 찾지 못했습니다. 공공 도로에서 줄을 서서 기다리지 마세요. 주변 안전을 확인하고 그대로 통과하여 다른 주차장을 이용해 주세요.",
    "es-ES": "No se encontró una plaza adecuada. No espere en la vía pública. Compruebe su entorno, continúe de forma segura y utilice otro aparcamiento.",
  };
  return messages[locale] ?? messages["en-US"];
}

/** 空き区画検索を実行する。 */
async function runSpaceSearch(priorityOverride = null, options = {}) {
  const { autoTriggered = false, skipSafetyGuard = false, refreshSimulation = false } = options;
  // 通信を待つ前に依頼元を固定し、戻る操作・施設変更・再検索で無効化する。
  const requestId = ++state.searchRequestId;
  const facility = state.selectedFacility;
  await loadRemoteParkingLayouts();
  if (facility?.id) await window.ParkingLiveStatus?.refresh(facility.id);
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
  cancelSpeech();
  state.searchOutcome = null;
  state.recommendedSpace = null;
  noSpaceContent.hidden = true;
  congestionNotice.hidden = true;

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

      if (refreshSimulation && !getFacilityLayout(facility)) {
        state.demoParkingSpaces.delete(facility.id);
      }
      const prepared = prepareSpaces(facility);

      state.resultSimulation = prepared.isSimulation;
      state.resultLive = prepared.isLive === true;
      state.currentLayout = prepared.layout;
      state.currentSpaces = prepared.spaces;
      state.guideEntrance = prepared.entrance;
      const useRandomGuidance = !state.resultLive && RANDOM_GUIDANCE_FACILITY_IDS.has(facility.id);
      state.recommendedSpace = selectRecommendedSpace(
        prepared.spaces,
        priority,
        state.requestedSpaceType,
        useRandomGuidance,
      );
      startArrivalCheck(facility, state.recommendedSpace, state.resultLive);

      if (!state.recommendedSpace) {
        state.searchOutcome = "not-found";
        state.lastSearchWasAuto = autoTriggered;
        updateSearchResultNotice();
        renderFacilities();
        beginLiveUpdates(facility);
        updateParkingArrivalPanel();
        if (state.voiceEnabled) speakCurrentGuidance();
        resolve({ facility: facility.name, spaceId: null, priority, spaceType: state.requestedSpaceType });
        return;
      }

      spaceNumber.textContent = state.recommendedSpace.id;
      priorityBadge.textContent = (!state.resultLive && RANDOM_GUIDANCE_FACILITY_IDS.has(facility.id))
        ? `${getSpaceTypeLabel(state.requestedSpaceType)} / ${ui("ランダム", "Random")}`
        : `${getSpaceTypeLabel(state.requestedSpaceType)} / ${getPriorityLabel(priority)}`;

      if (prepared.isSimulation) {
        spaceDescription.textContent = ui(
          `入口まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m · デモ`,
          `About ${Math.round(state.recommendedSpace.entranceDistanceMeters)} m to entrance · Demo`,
        );
      } else if (!prepared.entrance) {
        spaceDescription.textContent = ui("入口が未登録のため距離は未表示です。", "Distance unavailable: no entrance registered.");
      } else if (Number.isFinite(state.recommendedSpace.entranceDistanceMeters)) {
        spaceDescription.textContent = ui(
          `${prepared.entrance.name || "建物入口"}まで約${Math.round(state.recommendedSpace.entranceDistanceMeters)}m`,
          `About ${Math.round(state.recommendedSpace.entranceDistanceMeters)} m to ${prepared.entrance.name || "entrance"}`,
        );
      } else {
        spaceDescription.textContent = ui("レイアウト上の入口との距離で選択", "Selected by layout distance to entrance");
      }

      updatedTime.textContent = new Intl.DateTimeFormat(isEnglish() ? "en-US" : "ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());

      renderParkingMap(prepared.spaces, state.recommendedSpace, prepared.layout);
      resultContent.hidden = false;
      state.searchOutcome = "found";
      updateSearchResultNotice();
      renderFacilities();
      beginLiveUpdates(facility);
      updateParkingArrivalPanel();
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
function getSpokenSpaceId(space, locale = getGuidanceSpeechLocale()) {
  if (!space) return "";
  const raw = space.sourceObject ? mapDisplay.spaceName(space.sourceObject) : mapDisplay.normalizeNumber(space.id);
  if (locale === "ja-JP" && typeof japaneseSpaceReading === "function") {
    return space.sourceObject?.spaceNumberReading || space.sourceObject?.nameReading || japaneseSpaceReading(raw);
  }
  return mapDisplay.normalizeNumber(raw);
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

/** OSが公開する品質属性・名称を優先。主観的な評判を品質保証に使わない。 */
function speechVoiceQuality(voice) {
  const name=String(voice.name || "");
  return (/premium|natural|neural|高品質/i.test(name)?300:0)
    + (/enhanced|拡張/i.test(name)?200:0)
    + (/samantha|daniel|ting.?ting|yuna|monica/i.test(name)?100:0)
    + (voice.localService?20:0);
}

/** 現在の表示言語と音声案内言語に対応する音声を返す。 */
function getSelectedSpeechVoice(voices = getSpeechVoices()) {
  const locale = getGuidanceSpeechLocale();
  const uri = getVoiceProfile().voiceURI;
  const chosen = voices.find((voice) => voice.voiceURI === uri
    && String(voice.lang).toLowerCase().split("-")[0] === locale.toLowerCase().split("-")[0]);
  if (chosen) return chosen;
  const matching = voices.filter((voice) => String(voice.lang).toLowerCase() === locale.toLowerCase());
  /* iOSの高品質音声が一覧にある場合は、その音声を優先する。音量は名称から推定しない。 */
  const enhanced = [...matching].sort((a,b)=>speechVoiceQuality(b)-speechVoiceQuality(a))
    .find(voice=>speechVoiceQuality(voice)>=100);
  return enhanced ?? (isEnglish() ? getGuidanceSpeechVoice(voices) : getJapaneseSpeechVoice(voices));
}

/** 読み上げに使用するBCP 47言語タグを返す。 */
function getGuidanceSpeechLocale() {
  if (!isEnglish()) return "ja-JP";
  return state.guidanceVoiceLanguage || "en-US";
}

/** 音声案内言語に応じた読み上げ速度を返す。 */
function getGuidanceSpeechRate() {
  const rate = Number(getVoiceProfile().rate);
  return [0.8, 0.9, 1, 1.1].includes(rate) ? rate : (isEnglish() ? 0.9 : 1);
}

/** 端末音声の音量上限は1。端末や車載機の音量を変更する値ではない。 */
function getGuidanceSpeechVolume() {
  const volume = Number(getVoiceProfile().volume);
  return Number.isFinite(volume) ? Math.min(1, Math.max(0.1, volume)) : 1;
}

function getVoiceProfile() {
  const profile = state.voiceProfiles[getGuidanceSpeechLocale()];
  return profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
}

/** 言語ごとに音声・速度・アプリ内音量を保存する。 */
function saveVoiceProfile() {
  state.voiceProfiles[getGuidanceSpeechLocale()] = {
    voiceURI: voiceSelect?.value || "",
    rate: Number(voiceRateSelect?.value) || getGuidanceSpeechRate(),
    volume: Number(voiceVolumeInput?.value || 100) / 100,
  };
  try { localStorage.setItem("parkingGuideVoiceProfiles", JSON.stringify(state.voiceProfiles)); } catch {}
}

/** ブラウザーが提供する実在音声のみ選べる。別言語の選択は混ぜない。 */
function updateVoiceControls() {
  const locale = getGuidanceSpeechLocale();
  const profile = getVoiceProfile();
  const voices = getSpeechVoices().filter((voice) => String(voice.lang).toLowerCase().split("-")[0]
    === locale.toLowerCase().split("-")[0]);
  if (voiceSelect) {
    const choices = [{ value: "", label: ui("自動（端末の音声）", "Automatic (device voice)") },
      ...voices.map((voice) => ({ value: voice.voiceURI, label: `${voice.name} (${voice.lang})${voice.localService ? ui(" · 端末内", " · On device") : ui(" · 通信利用", " · Online")}` }))];
    voiceSelect.replaceChildren(...choices.map((choice) => {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      return option;
    }));
    voiceSelect.value = voices.some((voice) => voice.voiceURI === profile.voiceURI) ? profile.voiceURI : "";
    voiceSelect.disabled = state.cloudVoiceEnabled && locale === "ja-JP";
  }
  if (voiceRateSelect) voiceRateSelect.value = String(getGuidanceSpeechRate());
  if (voiceVolumeInput) voiceVolumeInput.value = String(Math.round(getGuidanceSpeechVolume() * 100));
  if (voiceVolumeLabel) voiceVolumeLabel.textContent = `${Math.round(getGuidanceSpeechVolume() * 100)}%`;
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
      : state.cloudVoiceEnabled
        ? ui("日本語 / 外部音声（実験）", "Japanese / External voice (experimental)")
        : ui("日本語 / 端末音声", "Japanese / Device voice");
  }

  if (voiceOutputModeSelect) voiceOutputModeSelect.value = state.voiceOutputMode;
  if (cloudVoiceInput) cloudVoiceInput.checked = state.cloudVoiceEnabled;
  updateVoiceControls();
  updateVoiceOutputStatus();
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
  } else if (state.cloudVoiceEnabled && getGuidanceSpeechLocale() === "ja-JP") {
    voiceStatus.textContent = ui(
      "使用音声: VOICEVOX:春日部つむぎ（保存済み音声はオフラインでも再生可能）",
      "Voice: VOICEVOX Kasukabe Tsumugi (saved clips work offline)",
    );
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
            `使用音声: ${voice.name}（${voice.lang}）`,
            `Voice: ${voice.name} (${voice.lang})`,
          );
    } else {
      voiceStatus.textContent = getMissingVoiceMessage();
    }
  }

  voiceStatus.classList.toggle("is-active", stateName === "active");
  voiceStatus.classList.toggle("is-error", stateName === "error");
}

/** Safariでは録音を伴わない再生を既定にする。他アプリ内のブラウザーは区別する。 */
function getDefaultVoiceOutputMode() {
  const agent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const safari = /AppleWebKit/.test(agent) && /Safari/.test(agent)
    && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|GSA|Android/.test(agent);
  /* Safariの通話向け設定で聞こえない報告を受けた既定値。実機の出力保証はしない。 */
  return safari ? "media" : "call-test";
}

function restoreVoiceOutputMode(savedV3, legacy) {
  const options = new Set(["mix", "priority", "media", "call-test", "system"]);
  if (options.has(savedV3)) return savedV3;
  if (legacy === "call-test") return getDefaultVoiceOutputMode();
  if (["priority", "media", "system"].includes(legacy)) return legacy;
  return getDefaultVoiceOutputMode();
}

/** 案内音声の再生優先度。音量や出力先の直接変更には使用できない。 */
const VOICE_AUDIO_SESSION_TYPES = Object.freeze({
  mix: "ambient",
  priority: "transient-solo",
  media: "playback",
  "call-test": "play-and-record",
  system: "auto",
});

/** 現在の再生方式と、このブラウザーの対応状況を表示する。 */
function updateVoiceOutputStatus(message = "", isError = false) {
  if (!voiceOutputStatus) return;
  let hasSession = false;
  try {
    hasSession = typeof navigator !== "undefined" && Boolean(navigator.audioSession);
  } catch {
    hasSession = false;
  }
  if (!message && hasSession && state.voiceOutputMode === "media") {
    message = ui(
      "メディア再生を使用します。Safariで通話向け音声が聞こえない場合の代替設定です。音楽が止まる場合があります。",
      "Using media playback, an alternative when communication audio is inaudible in Safari. Music may pause.",
    );
  }
  voiceOutputStatus.textContent = message || (hasSession
    ? (state.voiceOutputMode === "call-test"
      ? ui(
        "通話向け音声を自動案内・手動案内に使用します。実際の電話ではなく、マイクも使用しません。聞こえない場合は別の方式を選んでください。",
        "Communication-style audio is used for automatic and manual guidance. No phone call or microphone is used. Choose another mode if inaudible.",
      )
      : ui(
        "再生方式を選んで「音声を試す」で確認してください。実際の音量は接続先によって異なります。",
        "Select a mode and use Test voice. Actual loudness depends on the connected device.",
      ))
    : ui(
      "このブラウザーでは再生優先度の切り替えに対応していません。端末・車載機の音量と出力先をご確認ください。",
      "This browser does not support audio priority switching. Check the device and car audio output and volume.",
    ));
  voiceOutputStatus.classList.toggle("is-error", isError);
}

/** 対応環境のみ音声再生方式を指定し、未対応環境は標準の読み上げを維持する。 */
function configureVoiceAudioSession() {
  try {
    if (typeof navigator === "undefined" || !navigator.audioSession) return false;
    const type = VOICE_AUDIO_SESSION_TYPES[state.voiceOutputMode] ?? "ambient";
    navigator.audioSession.type = type;
    return navigator.audioSession.type === type;
  } catch {
    return false;
  }
}

/** 独占再生終了時に、他のアプリの音声と混ぜられる設定へ復帰する。 */
function releasePriorityAudioSession() {
  try {
    if (typeof navigator !== "undefined"
        && ["transient-solo", "play-and-record", "playback"].includes(navigator.audioSession?.type)) {
      navigator.audioSession.type = "ambient";
    }
  } catch {
    /* 未対応環境ではブラウザーに任せる。 */
  }
}

/** 音声合成とは別の短いテスト音で、接続先への出力状態を確かめる。 */
async function playVoiceOutputTestSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    updateVoiceOutputStatus(
      ui("このブラウザーではテスト音を再生できません。", "Output sound test is unavailable in this browser."),
      true,
    );
    return false;
  }

  cancelSpeech();
  configureVoiceAudioSession();
  let context = null;
  try {
    context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, startAt);
    /* テスト音は急に鳴り始めないよう小さめの音量でフェードさせる。 */
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.08);
    gain.gain.setValueAtTime(0.12, startAt + 1.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.95);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.addEventListener("ended", () => {
      void context.close().catch(() => {});
      releasePriorityAudioSession();
    }, { once: true });
    /* ユーザーのボタン操作に連動して AudioContext を起動する。 */
    const resumePromise = context.resume();
    oscillator.start();
    oscillator.stop(startAt + 2);
    await resumePromise;
    updateVoiceOutputStatus(ui(
      "約2秒のテスト音を再生します。聞こえない場合はiPhoneの再生先と車載機の入力を確認してください。",
      "Playing a two-second tone. If inaudible, check the iPhone output route and car audio source.",
    ));
    return true;
  } catch {
    if (context) void context.close().catch(() => {});
    releasePriorityAudioSession();
    updateVoiceOutputStatus(
      ui("テスト音を再生できませんでした。", "Could not play the output test sound."),
      true,
    );
    return false;
  }
}

/** 通話向け音声の間だけ、テスト音と同じ Web Audio 経路を準備する。 */
let activeSpeechAudioRoute = null;

/** 古い経路を停止し、音声が終わった後に無音の音源を残さない。 */
function stopSpeechAudioRoute() {
  const route = activeSpeechAudioRoute;
  activeSpeechAudioRoute = null;
  if (!route) return;
  try { route.voiceSource?.stop(); } catch { /* すでに終了した音声を無視する。 */ }
  try { route.oscillator.stop(); } catch { /* 停止済みなら無視する。 */ }
  try { void Promise.resolve(route.context.close()).catch(() => {}); }
  catch { /* ブラウザー側の終了失敗は案内終了を妨げない。 */ }
}

/**
 * 通話向け設定のとき、短い接続確認音の準備と音声中の経路維持を行う。
 * 実際の発話は引き続き SpeechSynthesis が担当し、音量増幅はできない。
 */
function prepareSpeechAudioRoute(forAudioFile = false) {
  stopSpeechAudioRoute();
  if (!forAudioFile && state.voiceOutputMode !== "call-test") return false;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;

  let context = null;
  try {
    configureVoiceAudioSession();
    context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.00001, now);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    const route = { context, oscillator, gain };
    activeSpeechAudioRoute = route;
    /* 操作時に準備する。自動案内で起動が拒否されても音声合成は継続。 */
    const resumed = context.resume();
    if (resumed?.catch) {
      void resumed.catch(() => {
        if (activeSpeechAudioRoute === route) stopSpeechAudioRoute();
      });
    }
    return true;
  } catch {
    if (context) {
      try { void Promise.resolve(context.close()).catch(() => {}); } catch {}
    }
    activeSpeechAudioRoute = null;
    return false;
  }
}

/** 音声の直前に、接続先テスト音と同じ周波数の短いチャイムを鳴らす。 */
function cueSpeechAudioRoute() {
  const route = activeSpeechAudioRoute;
  if (!route) return;
  try {
    const now = route.context.currentTime;
    const gain = route.gain.gain;
    gain.cancelScheduledValues?.(now);
    gain.setValueAtTime(0.00001, now);
    gain.linearRampToValueAtTime(0.12, now + 0.035);
    gain.setValueAtTime(0.12, now + 0.13);
    gain.linearRampToValueAtTime(0.00001, now + 0.24);
  } catch {
    stopSpeechAudioRoute();
  }
}

/** 画面へ戻った際、ブラウザーが一時停止した読み上げだけを再開する。 */
function resumePausedSpeechOnReturn() {
  if (document.hidden || !state.voiceEnabled) return;
  if (window.speechSynthesis?.paused) {
    configureVoiceAudioSession();
    if (activeSpeechAudioRoute) {
      void activeSpeechAudioRoute.context.resume?.().catch?.(() => {});
    }
    window.speechSynthesis.resume?.();
  }
}

let speechRequestId = 0;
let pendingCloudVoiceController = null;

/** Web Speech と外部TTSを区別して外部サービスの状態を常に表示する。 */
function setCloudVoiceDiagnostic(message, isError = false) {
  if (!cloudVoiceDiagnostic) return;
  cloudVoiceDiagnostic.textContent = message;
  cloudVoiceDiagnostic.classList.toggle("is-error", isError);
  cloudVoiceDiagnostic.classList.toggle("is-active", !isError);
}

/** 外部サービスの技術的エラーを、個人情報を含めずに説明する。 */
function describeCloudVoiceError(error) {
  const code = String(error?.message ?? "");
  if (error?.name === "AbortError") return ui(
    "通信時間切れ（タイムアウト）", "Timed out",
  );
  if (error?.name === "TypeError") return ui(
    "通信エラー（ネットワーク・CORS制限の可能性）",
    "Network error (possibly CORS restrictions)",
  );
  if (code.includes("HTTP 429")) return ui(
    "音声サービスが混雑しています（HTTP 429）", "Voice service is busy (HTTP 429)",
  );
  if (/HTTP 5[0-9]{2}/.test(code)) return ui(
    "音声サービス側の障害（HTTP 5xx）", "Voice service error (HTTP 5xx)",
  );
  if (code.includes("Audio generation is taking too long")) return ui(
    "音声の生成が制限時間に間に合いませんでした",
    "Audio generation did not finish in time",
  );
  if (code.includes("Invalid audio response")) return ui(
    "外部サービスからの応答形式が予期したものと異なります",
    "Unexpected response format",
  );
  return ui(
    "音声の生成・ダウンロード・再生に失敗しました",
    "Voice synthesis, download, or playback failed",
  );
}

/** 再生中だけでなく、音声一覧を待っている読み上げも取り消す。 */
function cancelSpeech() {
  speechRequestId += 1;
  pendingCloudVoiceController?.abort();
  pendingCloudVoiceController = null;
  window.speechSynthesis?.cancel?.();
  stopSpeechAudioRoute();
  releasePriorityAudioSession();
}

/**
 * 日本語の案内文を利用者の明示的な同意がある場合だけ音声ファイルへ変換する。
 * tts.quest のURLは必ず同社ドメインか確認し、外部から返された任意のURLへ接続しない。
 */
function isTrustedVoiceAudioUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^audio[0-9]+\.tts\.quest$/.test(url.hostname)
      && /^\/v1\/data\/[a-zA-Z0-9]+\/(?:audio\.(?:wav|mp3)|status\.json)$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** 音声ファイルの最大振幅を測り、最大3倍まで補正する。端末音量は変更しない。 */
function getAudioFileGain(buffer) {
  if (!buffer.getChannelData || !buffer.numberOfChannels) return 1;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak > 0 ? Math.min(3, 0.9 / peak) : 1;
}

/** 端末に事前保存された音声を優先し、未保存の場合のみ生成して保存する。 */
async function playCloudVoiceAudio(message, requestId, isPreview = false) {
  const route = activeSpeechAudioRoute;
  if (!route || !route.context.decodeAudioData || !route.context.createBufferSource
      || !window.ParkingVoiceAudioCache) {
    setCloudVoiceDiagnostic(ui("保存音声の再生機能が利用できません。", "Saved audio playback is unavailable."), true);
    return false;
  }
  const controller = new AbortController();
  pendingCloudVoiceController?.abort();
  pendingCloudVoiceController = controller;
  try {
    setCloudVoiceDiagnostic(ui("保存済みの音声を確認しています。", "Checking saved audio."));
    const audio = await window.ParkingVoiceAudioCache.get(message, {
      signal: controller.signal, timeoutMs: isPreview ? 60000 : 45000,
    });
    if (requestId !== speechRequestId || activeSpeechAudioRoute !== route) return true;
    const buffer = await route.context.decodeAudioData(audio.bytes);
    if (requestId !== speechRequestId || activeSpeechAudioRoute !== route) return true;
    if (route.context.state && route.context.state !== "running") {
      throw new Error("Audio playback requires a user gesture");
    }
    const source = route.context.createBufferSource();
    route.voiceSource = source;
    source.buffer = buffer;
    source.playbackRate?.setValueAtTime(getGuidanceSpeechRate(), route.context.currentTime);
    const level = route.context.createGain();
    level.gain.setValueAtTime(getAudioFileGain(buffer) * getGuidanceSpeechVolume(), route.context.currentTime);
    source.connect(level);
    level.connect(route.context.destination);
    source.addEventListener("ended", () => {
      if (requestId !== speechRequestId || activeSpeechAudioRoute !== route) return;
      stopSpeechAudioRoute();
      releasePriorityAudioSession();
      updateVoiceStatus();
    }, { once: true });
    configureVoiceAudioSession();
    source.start();
    setCloudVoiceDiagnostic(audio.source === "saved"
      ? ui("保存済み音声を再生しています（通信不要）。", "Playing saved audio (no network required).")
      : ui("音声を生成して端末に保存しました。", "Generated and saved the audio on this device."));
    updateVoiceStatus(ui("VOICEVOXの音声ファイルを再生しています。", "Playing VOICEVOX audio."), "active");
    return true;
  } catch (error) {
    if (requestId === speechRequestId) {
      setCloudVoiceDiagnostic(ui("保存音声を利用できません（", "Saved audio unavailable (")
        + describeCloudVoiceError(error) + ui("）。端末音声に切り替えます。", "). Switching to device speech."), true);
    }
    return false;
  } finally {
    if (pendingCloudVoiceController === controller) pendingCloudVoiceController = null;
  }
}

/** Web Speech APIで無料読み上げを行う。 */
function speakText(message, { preview = false, userGesture = false } = {}) {
  if (!message) return false;
  if (getGuidanceSpeechLocale() === "ja-JP" && typeof normalizeJapaneseSpeech === "function") message = normalizeJapaneseSpeech(message);

  /* 日本語の音声ファイル方式は本人が選んだ場合にのみ外部へ文章を送信する。 */
  const tryAudioFile = state.cloudVoiceEnabled
    && getGuidanceSpeechLocale() === "ja-JP"
    && Boolean(window.AudioContext || window.webkitAudioContext);

  if (tryAudioFile) {
    cancelSpeech();
    prepareSpeechAudioRoute(true);
    const requestId = ++speechRequestId;
    window.speechSynthesis?.cancel?.();
    void playCloudVoiceAudio(message, requestId, preview).then((played) => {
      if (played || requestId !== speechRequestId) return;
      stopSpeechAudioRoute();
      releasePriorityAudioSession();
      updateVoiceStatus(ui(
        "外部音声合成を利用できなかったため、端末の読み上げへ切り替えます。",
        "External synthesis is unavailable. Falling back to device speech.",
      ), "error");
      if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
        void speakTextWhenVoicesReady(message, requestId);
      }
    });
    return true;
  }

  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
  /* 通常のブラウザー音声は Web Audio へ接続できず別経路で出力される。 */
  cancelSpeech();
  prepareSpeechAudioRoute();
  void speakTextWhenVoicesReady(message, undefined, userGesture);
  return true;
}

function localeForSpeechMessage(message) {
  return getGuidanceSpeechLocale() === "ja-JP" && typeof normalizeJapaneseSpeech === "function" ? normalizeJapaneseSpeech(message) : message;
}

/** 音声一覧の読み込みを待ってからGoogle音声を指定して読み上げる。 */
async function speakTextWhenVoicesReady(message, requestId = ++speechRequestId, userGesture = false, localRetry = false) {
  const initialVoices = getSpeechVoices();
  // iPhoneでは最初の音声をタップ操作内で要求する。音声一覧が未取得でもOS標準音声で開始する。
  const voices = initialVoices.length || userGesture ? initialVoices : await waitForSpeechVoices();
  if (requestId !== speechRequestId) return;
  /* 直接呼ばれた場合も準備する。準備に失敗しても従来の読み上げを行う。 */
  if (!activeSpeechAudioRoute) prepareSpeechAudioRoute();
  configureVoiceAudioSession();
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(localeForSpeechMessage(message));
  const locale = getGuidanceSpeechLocale();
  const localVoices = [...voices].sort((a,b)=>speechVoiceQuality(b)-speechVoiceQuality(a));
  const localVoice = localVoices.find(v=>v.localService && String(v.lang).toLowerCase()===locale.toLowerCase())
    || localVoices.find(v=>v.localService && String(v.lang).split("-")[0]===locale.split("-")[0]);
  const voice = localRetry || window.navigator?.onLine === false ? localVoice : getSelectedSpeechVoice(voices);

  if (isEnglish() && !voice) {
    updateVoiceStatus(
      getMissingVoiceMessage(locale),
      "error",
    );
  }

  if (voice) {
    utterance.voice = voice;
    utterance.lang = locale;
  } else {
    utterance.lang = locale;
  }

  /* 速度設定は getGuidanceSpeechRate に集約する。 */
  utterance.rate = getGuidanceSpeechRate();
  utterance.pitch = 1;
  /* Web Speech API の音量上限は 1。端末の再生音量は利用者が調整する。 */
  utterance.volume = getGuidanceSpeechVolume();

  let started = false;
  const startWatchdog = setTimeout(() => {
    if (started || requestId !== speechRequestId) return;
    if (!localRetry && localVoice && localVoice !== voice) {
      void speakTextWhenVoicesReady(message, requestId, false, true);
    } else {
      window.speechSynthesis.cancel();
      stopSpeechAudioRoute();
      releasePriorityAudioSession();
      updateVoiceStatus(ui("音声を開始できません。案内内容：", "Voice did not start. Guidance: ") + message, "error");
    }
  }, 6000);
  utterance.addEventListener("start", () => {
    started = true;
    clearTimeout(startWatchdog);
    if (requestId !== speechRequestId) return;
    updateVoiceStatus(
      ui(
        `${voice?.name ?? "ブラウザー標準音声"}で読み上げています。`,
        `Speaking with ${voice?.name ?? "the browser default voice"}.`,
      ),
      "active",
    );
  });
  utterance.addEventListener("end", () => {
    clearTimeout(startWatchdog);
    if (requestId !== speechRequestId) return;
    stopSpeechAudioRoute();
    releasePriorityAudioSession();
    updateVoiceStatus();
  });
  utterance.addEventListener("error", (event) => {
    clearTimeout(startWatchdog);
    if (requestId !== speechRequestId) return;
    if (!localRetry && localVoice && localVoice !== voice && !["canceled", "interrupted", "not-allowed"].includes(event.error)) {
      void speakTextWhenVoicesReady(message, requestId, false, true);
      return;
    }
    stopSpeechAudioRoute();
    releasePriorityAudioSession();
    updateVoiceStatus(
      ui("音声を再生できません。案内内容：", "Voice unavailable. Guidance: ") + message,
      "error",
    );
  });

  /* Web Audio のチャイムと端末音声の聞こえ方を同じ案内内で比較できる。 */
  cueSpeechAudioRoute();
  window.speechSynthesis.speak(utterance);
}

/** 自動案内開始時の安全メッセージを読み上げる。 */
function getAutomaticGuidanceStartMessage(locale = getGuidanceSpeechLocale()) {
  const facility = getFacilitySpokenName(locale) || ui("もくてきしせつ", "the destination");
  const messages = {
    "ja-JP": `${facility}にちかづくと、じどうであきくかくをさがします。そうさは、あんぜんなばしょにていしゃしてからおこなってください。`,
    "en-US": `The parking space search will start automatically when you approach ${facility}. Use the controls only after stopping in a safe place.`,
    "en-GB": `The parking space search will start automatically when you approach ${facility}. Use the controls only after stopping in a safe place.`,
    "zh-CN": `接近${facility}时，将自动开始搜索停车位。请在安全地点停车后再操作。`,
    "ko-KR": `${facility}에 가까워지면 주차 공간 검색을 자동으로 시작합니다. 조작은 안전한 곳에 정차한 후에 해 주세요.`,
    "es-ES": `La búsqueda de una plaza de aparcamiento comenzará automáticamente al acercarse a ${facility}. Utilice los controles solo después de detenerse en un lugar seguro.`,
  };
  return getClosingAnnouncement(locale) + (messages[locale] ?? messages["en-US"]);
}

function speakAutomaticGuidanceStartMessage({ userGesture = false } = {}) {
  const spoken=speakText(getAutomaticGuidanceStartMessage(), { userGesture });
  if(spoken)lastClosingAnnouncementKey=getClosingAnnouncementKey();
  return spoken;
}

/** 再探索や手動探索では、実際には検知していない「接近」を読み上げない。 */
function getCurrentGuidanceMessage(locale = getGuidanceSpeechLocale()) {
  return getClosingAnnouncement(locale) + getParkingGuidanceMessage(locale);
}
function getParkingGuidanceMessage(locale = getGuidanceSpeechLocale(), options = {}) {
  // すべての案内言語で「録画の実演」であることを先に伝える。
  // 音声だけ聞く利用者にも実際の空き案内と誤解させない。
  const replayWarnings = {
    "ja-JP": "これはろくがえいぞうによるけんきゅうじつえんです。げんざいのあきじょうきょうではありません。",
    "en-US": "This is a demonstration using recorded footage, not current parking availability. ",
    "en-GB": "This is a demonstration using recorded footage, not current parking availability. ",
    "zh-CN": "这是过去录像的研究演示，不代表目前的停车位状态。",
    "ko-KR": "이것은 녹화 영상을 이용한 연구 시연입니다. 현재 주차 상황이 아닙니다. ",
    "es-ES": "Esta es una demostración con una grabación, no la disponibilidad actual del aparcamiento. ",
  };
  const replayNotice = state.selectedFacility?.id === VIDEO_REPLAY_FACILITY_ID
    ? (replayWarnings[locale] || replayWarnings["en-US"]) : "";
  if (state.searchOutcome === "not-found" && !options.space) {
    const full = summarizeOccupancy(state.currentSpaces, state.resultSimulation).level === "full";
    const fullMessages = {"ja-JP":"とうろくでーたでは、まんしゃです。", "en-US":"The saved data shows a full parking lot. ", "en-GB":"The saved data shows a full car park. ", "zh-CN":"已保存的数据显示停车场已满。", "ko-KR":"저장된 데이터상 주차장이 만차입니다. ", "es-ES":"Los datos guardados indican que el aparcamiento está lleno. "};
    return replayNotice + (full ? fullMessages[locale] ?? fullMessages["en-US"] : "") + getNoSpaceGuidanceMessage(locale);
  }
  if (!state.recommendedSpace && !options.space) return "";
  const number = getSpokenSpaceId(options.space ?? state.recommendedSpace, locale);
  const facility = getFacilitySpokenName(locale);
  const occupancy = summarizeOccupancy(options.spaces ?? state.currentSpaces, options.simulation ?? state.resultSimulation);
  const crowded = occupancy.level === "busy";
  const remaining = typeof japaneseNumber === "function" ? japaneseNumber(occupancy.available) : occupancy.available;
  const approaching = (options.autoTriggered ?? state.lastSearchWasAuto) && facility;
  const messages = {
    "ja-JP": `${approaching ? `${facility}にせっきんしました。` : facility ? `${facility}のごあんないです。` : ""}${crowded ? `こんざつしています。あきは、のこり${remaining}くかくです。` : ""}ごあんないするくかくは、${number}ばんです。くりかえします。${number}ばんです。しゅういのあんぜんと、げんちのひょうじをかくにんしてください。くかくがみつからないばあいは、こうどうでまつことなく、あんぜんにつうかしてください。`,
    "en-US": `${approaching ? `You are approaching ${facility}. ` : facility ? `Parking guidance for ${facility}. ` : ""}Your recommended parking space is number ${number}. I repeat, number ${number}. Check your surroundings and on-site signs before parking. If no space can be found, do not queue on the public road; safely continue past the entrance.`,
    "en-GB": `${approaching ? `You are approaching ${facility}. ` : facility ? `Parking guidance for ${facility}. ` : ""}Your recommended parking space is number ${number}. I repeat, number ${number}. Check your surroundings and on-site signs before parking. If no space can be found, do not queue on the public road; safely continue past the entrance.`,
    "zh-CN": `${approaching ? `已接近${facility}。` : facility ? `为您提供${facility}的停车位指引。` : ""}推荐的停车位是${number}号。重复一遍，${number}号。请确认周围安全及现场标识后停车。若找不到车位，请勿在公共道路排队等候，确认安全后继续通过。`,
    "ko-KR": `${approaching ? `${facility}에 가까워졌습니다. ` : facility ? `${facility}의 주차 공간을 안내합니다. ` : ""}안내할 주차 공간은 ${number}번입니다. 다시 말씀드립니다. ${number}번입니다. 주변의 안전과 현장 표지판을 확인한 후 주차해 주세요. 주차 공간이 없으면 공공 도로에서 기다리지 말고 안전하게 통과해 주세요.`,
    "es-ES": `${approaching ? `Se está acercando a ${facility}. ` : facility ? `Guía de aparcamiento para ${facility}. ` : ""}La plaza recomendada es la número ${number}. Repito, número ${number}. Compruebe la seguridad de su entorno y las señales antes de aparcar. Si no encuentra una plaza, no espere en la vía pública; continúe de forma segura.`,
  };
  const crowdMessages = {"en-US": `The parking lot is busy. Only ${occupancy.available} spaces remain. `, "en-GB": `The car park is busy. Only ${occupancy.available} spaces remain. `, "zh-CN": `停车场拥挤，仅剩${occupancy.available}个空车位。`, "ko-KR": `주차장이 혼잡합니다. 빈 공간은 ${occupancy.available}개입니다. `, "es-ES": `El aparcamiento está concurrido. Solo quedan ${occupancy.available} plazas. `};
  return replayNotice + (crowded && locale !== "ja-JP" ? crowdMessages[locale] ?? crowdMessages["en-US"] : "") + (messages[locale] ?? messages["en-US"]);
}

/** 自動探索、手動探索、再案内で同じ案内文を使う。 */
function speakCurrentGuidance() {
  const spoken=speakText(getCurrentGuidanceMessage());
  if(spoken)lastClosingAnnouncementKey=getClosingAnnouncementKey();
  return spoken;
}

/** 現在設定の音声案内言語で短い試聴を行う。 */
function getVoicePreviewMessage(locale = getGuidanceSpeechLocale()) {
  const messages = {
    "ja-JP": "おんせいのてすとです。ちゅうしゃくかく、びー、ごばんです。",
    "en-US": "Voice output test. Parking space number five. Please change the playback mode while parked if you cannot hear this.",
    "en-GB": "Voice output test. Parking space number five. Please change the playback mode while parked if you cannot hear this.",
    "zh-CN": "语音导航测试。停车位5号。",
    "ko-KR": "음성 안내 테스트입니다. 주차 구역 5번입니다.",
    "es-ES": "Prueba de guía por voz. Plaza de aparcamiento número cinco.",
  };

  return messages[locale] ?? messages["en-US"];
}

/** 試聴も通常案内と同じ経路で再生する。 */
function previewSelectedVoice() {
  speakText(getVoicePreviewMessage(), { preview: true });
}

/** 停車中に選択施設の音声を生成・保存する。外部への送信は明示同意後のみ。 */
async function prepareSelectedFacilityVoice() {
  if (!voicePrepareButton || !voicePrepareStatus) return;
  if (!state.cloudVoiceEnabled || getGuidanceSpeechLocale() !== "ja-JP") {
    voicePrepareStatus.textContent = ui("日本語の音声ファイル方式を有効にしてください。", "Enable Japanese audio-file mode.");
    return;
  }
  const facility = state.selectedFacility;
  if (!facility) {
    voicePrepareStatus.textContent = ui("先に施設を選択してください。", "Select a facility first.");
    return;
  }
  voicePrepareButton.disabled = true;
  voicePrepareStatus.textContent = ui("音声を準備しています…", "Preparing audio…");
  try {
    await loadRemoteParkingLayouts();
    if (state.selectedFacility !== facility) return;
    const prepared = prepareSpaces(facility);
    const messages = [getAutomaticGuidanceStartMessage("ja-JP"),
      getNoSpaceGuidanceMessage("ja-JP"), getVoicePreviewMessage("ja-JP")];
    if (state.searchOutcome) messages.push(getCurrentGuidanceMessage("ja-JP"));
    const matching = prepared.spaces.filter(s => !s.isOccupied && s.spaceType === state.requestedSpaceType).slice(0, 4);
    for (const space of matching) {
      for (const autoTriggered of [true, false]) {
        messages.push(getClosingAnnouncement("ja-JP") + getParkingGuidanceMessage("ja-JP", {
          space, autoTriggered, spaces: prepared.spaces, simulation: prepared.isSimulation,
        }));
      }
    }
    const normalized = messages.map(s => typeof normalizeJapaneseSpeech === "function"
      ? normalizeJapaneseSpeech(s) : s);
    const results = await window.ParkingVoiceAudioCache.prepare(normalized, p => {
      voicePrepareStatus.textContent = ui(
        "保存準備：" + p.done + " / " + p.total + " 件（失敗 " + p.failed + " 件）",
        "Saving " + p.done + " / " + p.total + " (failed: " + p.failed + ")",
      );
    });
    voicePrepareStatus.textContent = ui(
      "保存完了。新規 " + results.created + " 件、保存済み " + results.saved + " 件、失敗 " + results.failed + " 件。",
      "Finished: " + results.created + " new, " + results.saved + " existing, " + results.failed + " failed.",
    );
  } catch {
    voicePrepareStatus.textContent = ui("保存に失敗しました。通信状況をご確認ください。", "Preparation failed. Check your connection.");
  } finally {
    voicePrepareButton.disabled = false;
  }
}

function updateVoiceAvailability() {
  const supported =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  [voiceGuideButton, voicePreviewButton, document.querySelector("#no-space-voice")].forEach((button) => {
    if (!button) return;
    button.disabled = !supported;
  });

  if (voiceEnabledInput) voiceEnabledInput.disabled = !supported;
  guidanceVoiceInputs.forEach((input) => { input.disabled = !supported; });
  if (voiceOutputTestButton) {
    voiceOutputTestButton.disabled = !(window.AudioContext || window.webkitAudioContext);
  }

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
  cancelSpeech();
  window.parkingSafety?.resetConfirmation?.();
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
  state.arrivalCheck = null;
  state.searchOutcome = null;
  state.resultLive = false;
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
  state.arrivalCheck = null;
  state.pendingPrivateTestCalibration = false;
  state.searchOutcome = null;
  state.resultLive = false;
  state.currentSpaces = [];
  state.currentLayout = null;
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
  updateDestinationCards();
  updateWaitingScreen();
});
voiceGuideButton?.addEventListener("click", () => {
  speakCurrentGuidance();
});
voicePreviewButton?.addEventListener("click", previewSelectedVoice);
voicePrepareButton?.addEventListener("click", () => { void prepareSelectedFacilityVoice(); });
[voiceSelect, voiceRateSelect, voiceVolumeInput].forEach((control) => {
  control?.addEventListener("change", () => {
    cancelSpeech();
    saveVoiceProfile();
    updateVoiceControls();
    previewSelectedVoice();
  });
});
voiceVolumeInput?.addEventListener("input", () => {
  if (voiceVolumeLabel) voiceVolumeLabel.textContent = `${voiceVolumeInput.value}%`;
});
cloudVoiceInput?.addEventListener("change", () => {
  cancelSpeech();
  state.cloudVoiceEnabled = cloudVoiceInput.checked;
  setCloudVoiceDiagnostic(state.cloudVoiceEnabled
    ? ui("音声ファイル方式を試行します。接続結果をここに表示します。", "Testing audio-file playback; results appear here.")
    : ui("音声ファイル方式はオフです。", "Audio-file mode is off."));
  try {
    localStorage.setItem("parkingGuideCloudVoiceEnabled", String(state.cloudVoiceEnabled));
  } catch {
    /* 保存できないときも現在の画面では選択した方式を使う。 */
  }
  updateVoiceModeUi();
  if (state.cloudVoiceEnabled) {
    previewSelectedVoice();
  } else {
    updateVoiceStatus();
  }
});
voiceOutputTestButton?.addEventListener("click", () => { void playVoiceOutputTestSound(); });
voiceOutputModeSelect?.addEventListener("change", () => {
  const selected = voiceOutputModeSelect.value;
  cancelSpeech();
  state.voiceOutputMode = Object.hasOwn(VOICE_AUDIO_SESSION_TYPES, selected) ? selected : getDefaultVoiceOutputMode();
  updateVoiceOutputStatus();
  try {
    localStorage.setItem("parkingGuideVoiceOutputModeV3", state.voiceOutputMode);
  } catch {
    /* 保存できない場合も現在の選択は有効とする。 */
  }
  previewSelectedVoice();
});
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
    cancelSpeech();
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
  if (!isPrivateTestFacility(state.selectedFacility)) return;

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
      && isPrivateTestFacility(state.selectedFacility)) {
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

  if (getFacilityDestinations().length > 0
      && !state.selectedDestination) {
    destinationSelect.reportValidity();
    destinationSelect.focus();
    return;
  }

  const facility = state.selectedFacility;
  state.autoProximityArmed = true;
  state.autoTriggeredFacilityId = null;
  state.searchOutcome = null;
  state.recommendedSpace = null;

  /* Safariではユーザー操作から離れて音声を開始すると無音になる場合がある。
   * 待機画面と最初の案内音声を先に開始し、外部の住所・位置検索は後から進める。 */
  window.parkingSafety?.start?.();
  updateWaitingScreen();
  updateProximityStatus();
  showScreen("waiting");
  const requestId = state.searchRequestId;
  if (state.voiceEnabled) {
    speakAutomaticGuidanceStartMessage({ userGesture: true });
  }
  await ensureFacilityCoordinate(facility);
  if (requestId !== state.searchRequestId || state.selectedFacility !== facility) return;
  void checkAutomaticProximitySearch();
});

searchNowButton?.addEventListener("click", () => {
  saveSearchConditions();
  if (getFacilityDestinations().length > 0
      && !state.selectedDestination) {
    destinationSelect.reportValidity();
    destinationSelect.focus();
    return;
  }
  void runSpaceSearch();
});

retryButton.addEventListener("click", () => {
  state.searchSequence += 1;
  void runSpaceSearch(null, { refreshSimulation: true });
});

endGuidanceButton?.addEventListener("click", endGuidance);
document.querySelector("#no-space-voice")?.addEventListener("click", speakCurrentGuidance);
document.querySelector("#no-space-retry")?.addEventListener("click", () => {
  state.searchSequence += 1;
  void runSpaceSearch(null, { refreshSimulation: true });
});
document.querySelector("#no-space-other")?.addEventListener("click", endGuidance);

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
    (requestedScreen === "result" && state.searchOutcome);

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
/* 画面へ戻ったときだけ、中断状態にある音声を再開する。 */
document.addEventListener?.("visibilitychange", resumePausedSpeechOnReturn);
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    updateVoiceModeUi();
  });
}
initializeFilters();
window.history.replaceState({ screen: "facility" }, "", "#facility");
showScreen("facility", { addHistory: false, moveFocus: false });

// 営業時間の境界を越えた一覧を、操作なしでも更新する。
setInterval(() => { if (state.currentScreen === "facility") renderFacilities(); }, 60000);

// 待機・案内中の時刻変化も確認する。
setInterval(announceClosingTimeIfNeeded,30000);
