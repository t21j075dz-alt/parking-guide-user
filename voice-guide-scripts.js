"use strict";
/**
 * 音声ガイダンス37種類。短く丁寧なナビ表現へ統一し、駐車枠は必ず2回案内。
 * 固定文・施設名・店舗名・エリア／区画番号を独立した音声部品に分割する。
 *
 * 事前保存するのは音声部品。再生時に同一の部品を組み合わせるため、
 * 施設や区画を変更しても固定文を再生成する必要はない。
 */
window.ParkingVoiceGuideScripts = (() => {
  const TEMPLATES = Object.freeze({
    // 01 条件入力後
    start_complex: "［目的施設名］内の［目的店舗名］への駐車案内を設定しました。［目的施設名］に近づくと、空き枠を自動で探します。現在の駐車場は［混雑状況］。運転中の操作はお控えください。",
    start_single: "［目的店舗名］への駐車案内を設定しました。目的地に近づくと、空き枠を自動で探します。現在の駐車場は［混雑状況］。運転中の操作はお控えください。",
    approaching: "まもなく目的地です。駐車場の空き状況を確認しています。",
    // 02 目的地接近後: 同じ駐車枠を必ず二度読む
    space_found: "空き枠が見つかりました。ご案内する駐車枠は、［駐車枠］番です。繰り返します。［駐車枠］番です。場内は徐行し、現地の標識や係員の案内を優先してください。利用できない場合は、安全な場所に停車してから「再探索」を押してください。",
    space_alternative: "ご希望の条件に合う空き枠がないため、別の枠をご案内します。ご案内する駐車枠は、［駐車枠］番です。繰り返します。［駐車枠］番です。場内は徐行し、現地の標識や係員の案内を優先してください。",
    space_none: "現在、ご案内できる空き枠がありません。公道での空き待ちはお控えください。駐車場案内を終了します。ご利用ありがとうございました。",
    space_maybe_taken: "ご案内した駐車枠が埋まった可能性があります。安全な場所に停車してから「再探索」を押してください。",
    // 03 再探索
    retry_started: "空き枠をもう一度探しています。少々お待ちください。",
    retry_found: "新しい空き枠が見つかりました。ご案内する駐車枠は、［駐車枠］番です。繰り返します。［駐車枠］番です。現地の標識や係員の案内を優先してください。",
    retry_none: "申し訳ありません。現在、ご案内できる空き枠がありません。現地の案内表示をご確認ください。",
    // 04 停車・完了・終了
    arrival_detected: "ご案内した駐車枠に車を検知しました。ご自身の車ですか？安全に停車してから、画面の「はい」か「いいえ」を選んでください。",
    parking_completed: "駐車が完了しました。お疲れさまでした。お忘れ物にご注意ください。",
    guidance_ended: "駐車場案内を終了しました。ご利用ありがとうございました。",
    // 05 営業・施設・条件
    full: "現在、駐車場は満車です。空き枠が確認できるまで、ご案内できません。",
    rest: "本日、［施設名］は休業日です。営業日をご確認ください。",
    closed: "現在、［施設名］は営業時間外です。次の開店は［時刻］です。",
    closed_unknown: "現在、［施設名］は営業時間外です。営業時間をご確認ください。",
    space_changed: "ご案内する駐車枠が変わりました。新しい駐車枠をご案内します。",
    conditions_changed: "駐車条件を変更しました。新しい条件で空き枠を探します。",
    conditions_unavailable: "ご希望の条件に合う空き枠がありません。別の条件で探します。",
    destination_changed: "案内先を［駐車場名］に変更しました。",
    // 06 カメラ・位置情報・通信
    camera_disconnected: "カメラとの接続が切れました。最新の空き状況を確認できません。現地の案内表示をご確認ください。",
    camera_recovered: "カメラとの接続が回復しました。空き状況を更新しています。",
    recognition_unknown: "現在、駐車枠の空き状況を確認できません。現地の案内表示をご確認ください。",
    location_unknown: "現在地を取得できません。安全な場所に停車してから、位置情報の設定をご確認ください。",
    status_stale: "駐車場情報の更新が止まっています。表示中の空き状況は最新ではない可能性があります。現地の案内表示をご確認ください。",
    // 07 現在のアプリに未実装の検出は勝手に発火させない
    entrance_near: "まもなく駐車場入口です。入口の案内表示をご確認ください。",
    entrance_entered: "駐車場に入りました。歩行者に注意して、徐行してください。",
    route_turn: "この先を［方向］に進み、［エリア名］へお進みください。",
    space_unavailable: "ご案内した駐車枠は利用できません。別の駐車枠を探します。",
    timer_started: "駐車時間の記録を開始しました。",
    timer_elapsed: "現在の駐車時間は［駐車時間］です。",
    parked_location: "駐車した場所は、［駐車枠］番です。繰り返します。［駐車枠］番です。",
    exit_detected: "駐車場からの退出を確認しました。ご利用ありがとうございました。",
    // 現行アプリの研究用録画を実際の空きと誤認させない
    recorded_demo: "これは録画映像を使った研究用の案内です。現在の空き状況ではありません。",
    voice_test_notice: "これは音声案内のテストです。駐車枠の情報は模擬データです。",
    // 固定文として事前生成しておくその他の既存案内
    closing_soon: "閉店まで1時間以内です。ご利用時間にご注意ください。",
  });

  const PLACEHOLDER = /［([^］]+)］/g;
  // 句点で切り、残りはプレースホルダー単位に分解。
  // 読み上げの間が不自然にならないように、短い句をまとめる。
  function build(id, values = {}) {
    const template = TEMPLATES[id];
    if (!template) throw new Error("Unknown voice script: " + id);
    const parts = [];
    const pieces = template.split(/(［[^］]+］)/g).filter(Boolean);
    for (const piece of pieces) {
      const placeholder = /^［([^］]+)］$/.exec(piece);
      if (placeholder) {
        const value = String(values[placeholder[1]] ?? "").trim();
        if (!value) throw new Error("Voice value missing: " + placeholder[1]);
        parts.push({ role: placeholder[1], text: value });
      } else {
        const phrases = piece.match(/[^。！？]+[。！？]?/g) || [];
        for (const phrase of phrases) if (phrase.trim()) parts.push({ role: "fixed", text: phrase });
      }
    }
    return {
      id,
      parts,
      text: parts.map(p => p.text).join(""),
    };
  }

  function catalogFixed() {
    // 施設の選択前でも静的文言だけ先に音声ファイルとして保存できる。
    const fixed = new Set();
    for (const id of Object.keys(TEMPLATES)) {
      const template = TEMPLATES[id];
      for (const piece of template.split(/［[^］]+］/g)) {
        for (const fragment of piece.match(/[^。！？]+[。！？]?/g) || []) {
          if (fragment.trim()) fixed.add(fragment);
        }
      }
    }
    return [...fixed];
  }

  return Object.freeze({ build, catalogFixed, ids: Object.freeze(Object.keys(TEMPLATES)) });
})();
