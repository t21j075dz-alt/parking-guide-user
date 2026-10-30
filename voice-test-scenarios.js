"use strict";
/**
 * 音声テスト専用シナリオ集。
 * 実カメラやライブ駐車状態には触れず、既存の案内台本を模擬値で再生する。
 * 日本語は台本から音声部品を組み立て、他言語は同言語のサンプルだけ再生する。
 */
window.ParkingVoiceTestScenarios = (() => {
  const GROUPS = Object.freeze([
    { id:"all", ja:"すべての音声", en:"All announcements" },
    { id:"basic", ja:"案内開始・到着", en:"Start and arrival" },
    { id:"availability", ja:"空き・満車・混雑", en:"Availability" },
    { id:"retry", ja:"再探索・条件変更", en:"Retry and changes" },
    { id:"parking", ja:"駐車・退出", en:"Parking and exit" },
    { id:"operation", ja:"営業時間・営業状態", en:"Opening hours" },
    { id:"connection", ja:"カメラ・通信・位置情報", en:"Connection issues" },
    { id:"advanced", ja:"入口・経路案内（研究用）", en:"Entrance and route samples" },
  ]);
  // 各台本の意味と対応づけている。実際には発生していないイベントは一切発火しない。
  const CASES = Object.freeze([
    ["voice_test_notice","basic","音声テストの説明","Voice test notice"],
    ["start_single","basic","案内設定（単独施設）","Start guidance: single facility"],
    ["start_complex","basic","案内設定（複合施設）","Start guidance: complex"],
    ["approaching","basic","目的地へ接近","Approaching destination"],
    ["space_found","basic","空き区画を案内（番号2回）","Space found (repeat twice)"],
    ["space_alternative","availability","代替区画を案内","Alternative space"],
    ["space_none","availability","案内できる空き区画なし","No suitable space"],
    ["space_maybe_taken","availability","案内先が埋まった可能性","Space possibly occupied"],
    ["full","availability","満車を案内","Parking lot full"],
    ["recognition_unknown","availability","区画の判定が不明","Unknown space status"],
    ["retry_started","retry","再探索を開始","Retry started"],
    ["retry_found","retry","再探索で区画を発見","Retry found a space"],
    ["retry_none","retry","再探索でも空きなし","Retry found no space"],
    ["space_changed","retry","案内区画が変更","Space changed"],
    ["conditions_changed","retry","駐車条件を変更","Conditions changed"],
    ["conditions_unavailable","retry","条件に一致する区画なし","Conditions unavailable"],
    ["destination_changed","retry","目的地を変更","Destination changed"],
    ["arrival_detected","parking","車両の停車を検知（模擬）","Arrival detected (simulated)"],
    ["parking_completed","parking","駐車完了","Parking completed"],
    ["parked_location","parking","駐車位置を再案内","Parked location"],
    ["timer_started","parking","駐車時間の記録開始","Parking timer started"],
    ["timer_elapsed","parking","現在の駐車時間","Parking elapsed time"],
    ["exit_detected","parking","退出を検知（模擬）","Exit detected (simulated)"],
    ["guidance_ended","parking","案内を終了","Guidance ended"],
    ["rest","operation","施設の休業日","Facility day off"],
    ["closed","operation","営業時間外・開店時刻あり","Closed: next opening"],
    ["closed_unknown","operation","営業時間外・時刻不明","Closed: hours unknown"],
    ["closing_soon","operation","閉店時刻が近い","Closing soon"],
    ["camera_disconnected","connection","カメラ接続が切断","Camera disconnected"],
    ["camera_recovered","connection","カメラ接続が回復","Camera reconnected"],
    ["location_unknown","connection","現在地を取得できない","Location unavailable"],
    ["status_stale","connection","空き情報の更新が停止","Stale parking status"],
    ["recorded_demo","connection","録画映像による実演の注意","Recorded demo notice"],
    ["entrance_near","advanced","駐車場入口へ接近（模擬）","Near entrance (simulated)"],
    ["entrance_entered","advanced","駐車場に入場（模擬）","Entrance detected (simulated)"],
    ["route_turn","advanced","区画までの経路（模擬）","Turn instruction (simulated)"],
    ["space_unavailable","advanced","区画が利用できなくなった","Space unavailable"],
  ].map(([id,group,ja,en]) => Object.freeze({ id,group,ja,en })));

  // 非日本語は訳文が用意されたシナリオだけ表示する。日本語台本を他言語音声へ流さない。
  const EXAMPLES = Object.freeze({
    voice_test_notice: {
      en:"This is a voice guidance test. Parking availability is simulated.",
      zh:"这是语音引导测试。所有停车位状态均为模拟数据。",
      ko:"음성 안내 테스트입니다. 주차 공간 정보는 모의 데이터입니다.",
      es:"Esta es una prueba de guía por voz. La disponibilidad de plazas es simulada.",
    },
    start_single: {
      en:"Parking guidance has been set for the test facility. The app will look for a space when you approach. Do not operate your phone while driving.",
      zh:"已为测试设施设置停车引导。接近目的地时将寻找车位。开车时请不要操作手机。",
      ko:"테스트 시설의 주차 안내를 설정했습니다. 목적지에 가까워지면 주차 공간을 찾습니다. 운전 중에는 휴대전화를 조작하지 마세요.",
      es:"La guía de aparcamiento está configurada para la instalación de prueba. Buscaremos una plaza cuando se acerque. No utilice el móvil al conducir.",
    },
    approaching: {
      en:"You are approaching your destination. Checking parking information.",
      zh:"即将到达目的地。正在确认停车场信息。",
      ko:"목적지에 가까워지고 있습니다. 주차장 정보를 확인하고 있습니다.",
      es:"Se está acercando a su destino. Comprobando la información del aparcamiento.",
    },
    space_found: {
      en:"A suitable space has been found. Please proceed to space number five. I repeat, space number five. Check the signs and drive slowly.",
      zh:"已找到合适车位。请前往五号车位。重复一遍，五号车位。请注意标志并缓慢行驶。",
      ko:"적합한 주차 공간을 찾았습니다. 5번 구역으로 이동하세요. 다시 말씀드립니다. 5번 구역입니다. 표지판을 확인하고 서행하세요.",
      es:"Hemos encontrado una plaza. Diríjase a la plaza número cinco. Repito, número cinco. Respete las señales y circule despacio.",
    },
    space_alternative: {
      en:"The requested space type is unavailable. We can guide you to another space, number five. I repeat, number five.",
      zh:"没有符合所选条件的车位。可引导您前往其他车位，五号车位。重复一遍，五号车位。",
      ko:"선택하신 조건에 맞는 공간이 없습니다. 다른 공간인 5번 구역으로 안내합니다. 다시 말씀드립니다. 5번 구역입니다.",
      es:"No hay una plaza del tipo solicitado. Le guiaremos a otra, la número cinco. Repito, número cinco.",
    },
    space_none: {
      en:"No parking space is available. Please do not queue on the public road. Follow local signs and use another parking lot.",
      zh:"目前没有可引导的停车位。请勿在公共道路上排队。请遵守现场标志并使用其他停车场。",
      ko:"안내 가능한 주차 공간이 없습니다. 공공 도로에서 대기하지 마세요. 현장 안내를 따르고 다른 주차장을 이용하세요.",
      es:"No hay plazas disponibles. No espere en la vía pública. Siga las señales y utilice otro aparcamiento.",
    },
    full: {
      en:"The parking lot is full. No space can be recommended until a free space is confirmed.",
      zh:"停车场目前已满。确认有空位之前无法推荐车位。",
      ko:"현재 주차장이 만차입니다. 빈 공간이 확인될 때까지 안내할 수 없습니다.",
      es:"El aparcamiento está lleno. No podemos recomendar una plaza hasta confirmar una disponible.",
    },
    retry_found: {
      en:"A new space is available. Please go to space number five. I repeat, number five.",
      zh:"已找到新的空位。请前往五号车位。重复一遍，五号车位。",
      ko:"새로운 빈 공간을 찾았습니다. 5번 구역으로 이동하세요. 다시 말씀드립니다. 5번 구역입니다.",
      es:"Hemos encontrado una nueva plaza. Diríjase a la número cinco. Repito, número cinco.",
    },
    parking_completed: {
      en:"Parking is complete. Please check that you have all your belongings.",
      zh:"停车已完成。请检查随身物品。",
      ko:"주차가 완료되었습니다. 소지품을 확인해 주세요.",
      es:"El estacionamiento ha finalizado. Compruebe que lleva todas sus pertenencias.",
    },
    rest: {
      en:"The test facility is closed today. Please check its operating days.",
      zh:"测试设施今天休息。请确认营业日期。",
      ko:"테스트 시설은 오늘 휴무입니다. 영업일을 확인해 주세요.",
      es:"La instalación de prueba está cerrada hoy. Consulte los días de apertura.",
    },
    camera_disconnected: {
      en:"The camera connection was lost. Current availability cannot be confirmed. Please follow local signs.",
      zh:"摄像头连接已中断。无法确认最新空位。请遵守现场标志。",
      ko:"카메라 연결이 끊어졌습니다. 현재 빈 공간을 확인할 수 없습니다. 현장 안내를 확인하세요.",
      es:"Se ha perdido la conexión con la cámara. No podemos verificar las plazas disponibles. Siga las señales.",
    },
    camera_recovered: {
      en:"The camera connection is restored. Updating parking information.",
      zh:"摄像头连接已恢复。正在更新停车信息。",
      ko:"카메라 연결이 복구되었습니다. 주차장 정보를 업데이트하고 있습니다.",
      es:"Se ha restablecido la conexión con la cámara. Actualizando la información.",
    },
    guidance_ended: {
      en:"Parking guidance has ended. Thank you for using the service.",
      zh:"停车引导已结束。感谢您的使用。",
      ko:"주차 안내가 종료되었습니다. 이용해 주셔서 감사합니다.",
      es:"La guía de aparcamiento ha terminado. Gracias por utilizar el servicio.",
    },
  });

  function languageKey(locale) {
    const key = String(locale || "ja-JP").split("-")[0].toLowerCase();
    return ["ja","en","zh","ko","es"].includes(key) ? key : "en";
  }
  function scenarios(locale = "ja-JP", group = "all") {
    const language = languageKey(locale);
    return CASES.filter(item =>
      (group === "all" || item.group === group) &&
      (language === "ja" || Boolean(EXAMPLES[item.id]?.[language]))
    );
  }
  function build(item, { facility = "テスト施設", space = "ご", destination = "サンプル店舗" } = {}, locale = "ja-JP") {
    if (!item?.id || !CASES.some(entry => entry.id === item.id)) throw new Error("音声テストの種類が正しくありません。");
    const language = languageKey(locale);
    if (language !== "ja") {
      const text = EXAMPLES[item.id]?.[language];
      if (!text) throw new Error("この言語に対応するテスト音声はありません。");
      return { text, parts:null, roles:null };
    }
    if (!window.ParkingVoiceGuideScripts) throw new Error("音声案内の台本を読み込めません。");
    const values = {
      "目的施設名": facility, "目的店舗名":destination,
      "混雑状況":"空きがあります", "駐車枠":space,
      "施設名":facility, "時刻":"午後六時", "駐車場名":facility,
      "方向":"右", "エリア名":"エーエリア", "駐車時間":"十二分",
    };
    const script = window.ParkingVoiceGuideScripts.build(item.id, values);
    return { text:script.text, parts:script.parts.map(piece=>piece.text),
      roles:script.parts.map(piece=>piece.role) };
  }
  return Object.freeze({
    groups: GROUPS, scenarios, build, languageKey,
  });
})();
