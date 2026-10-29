"use strict";
/**
 * 添付「駐車場案内システム 音声ガイダンス台本」準拠。
 * 固定文・施設名・店舗名・エリア／区画番号を独立した音声部品に分割する。
 *
 * 事前保存するのは音声部品。再生時に同一の部品を組み合わせるため、
 * 施設や区画を変更しても固定文を再生成する必要はない。
 */
window.ParkingVoiceGuideScripts = (() => {
  const TEMPLATES = Object.freeze({
    // 01 条件入力後
    start_complex: "［目的施設名］内の［目的店舗名］への案内を設定しました。施設に近づくと、駐車枠への案内を自動で開始します。ご希望の条件に合う空き枠がない場合は、ほかの空き枠をご案内することがあります。現在の［目的施設名］の駐車場は、［混雑状況］。運転中はスマートフォンの操作や画面の注視を避け、安全運転でお進みください。",
    start_single: "［目的店舗名］への案内を設定しました。店舗に近づくと、駐車枠への案内を自動で開始します。ご希望の条件に合う空き枠がない場合は、ほかの空き枠をご案内することがあります。現在の駐車場は、［混雑状況］。運転中はスマートフォンの操作や画面の注視を避け、安全運転でお進みください。",
    approaching: "目的地に近づいています。最新の駐車場情報を確認しています。",
    // 02 目的地接近後: 同じ駐車枠を必ず二度読む
    space_found: "まもなく目的地です。ご希望の条件に合う空き枠が見つかりました。ご案内する駐車枠は、［駐車枠］番です。繰り返します。［駐車枠］番です。現地の標識や係員の案内を優先し、駐車場内は徐行してください。歩行者や車両の飛び出しにもご注意ください。ご案内した駐車枠以外への駐車はご遠慮ください。ご案内した駐車枠を利用できない場合は、安全な場所に停車してから、アプリの「再探索」ボタンを押してください。",
    space_alternative: "まもなく目的地です。申し訳ありません。現在、ご希望の条件に合う空き枠を確認できませんでした。代わりに、ほかの空き枠をご案内します。ご案内する駐車枠は、［駐車枠］番です。繰り返します。［駐車枠］番です。現地の標識や係員の案内を優先し、駐車場内は徐行してください。歩行者や車両の飛び出しにもご注意ください。ご案内した駐車枠以外への駐車はご遠慮ください。ご案内した駐車枠を利用できない場合は、安全な場所に停車してから、アプリの「再探索」ボタンを押してください。",
    space_none: "まもなく目的地です。申し訳ありません。現在、ご案内できる空き枠を確認できませんでした。周辺道路での空き待ちや、ほかの店舗への無断駐車はお控えください。今回の駐車場案内を終了します。ご利用ありがとうございました。",
    space_maybe_taken: "ご案内していた駐車枠が埋まった可能性があります。安全な場所に停車してから、空き状況を更新してください。",
    // 03 再探索
    retry_started: "駐車枠を再探索しています。しばらくお待ちください。",
    retry_found: "新しい空き枠が見つかりました。ご案内する駐車枠は、［駐車枠］番です。繰り返します。［駐車枠］番です。現地の標識や係員の案内を優先してお進みください。",
    retry_none: "申し訳ありません。現在、ご案内できる空き枠を確認できませんでした。現地の案内表示をご確認ください。",
    // 04 停車・完了・終了
    arrival_detected: "ご案内した駐車枠で、車両の停車を検知しました。駐車が完了した場合は、安全を確認してから「駐車完了」ボタンを押してください。駐車できなかった場合は、安全な場所に停車したうえで「再探索」ボタンを押してください。",
    parking_completed: "駐車完了を確認しました。お疲れさまでした。お忘れ物にお気をつけください。",
    guidance_ended: "駐車場案内を終了しました。ご利用ありがとうございました。",
    // 05 営業・施設・条件
    full: "現在、駐車場は満車と判定されています。新しい空き枠が確認できるまで、駐車枠への案内はできません。",
    rest: "本日、［施設名］は休業しています。営業日をご確認ください。",
    closed: "現在、［施設名］は営業時間外です。次の営業開始時刻は［時刻］です。",
    closed_unknown: "現在、［施設名］は営業時間外です。営業時間をご確認ください。",
    space_changed: "ご案内する駐車枠が変更されました。新しい駐車枠をご案内します。",
    conditions_changed: "駐車条件を変更しました。新しい条件で空き枠を確認します。",
    conditions_unavailable: "ご希望の条件に合う空き枠を確認できませんでした。ほかの条件で空き枠を探します。",
    destination_changed: "案内先を［駐車場名］に変更しました。",
    // 06 カメラ・位置情報・通信
    camera_disconnected: "カメラとの接続が切れたため、最新の空き状況を確認できません。現地の案内表示をご確認ください。",
    camera_recovered: "カメラとの接続が回復しました。最新の駐車場情報を確認しています。",
    recognition_unknown: "現在、駐車枠の状況を正確に確認できません。現地の状況を優先してください。",
    location_unknown: "現在地を取得できません。自動案内を開始できないため、安全な場所に停車してから、位置情報の設定をご確認ください。",
    status_stale: "駐車場情報の更新が停止しています。現在表示されている空き状況は、最新ではない可能性があります。",
    // 07 現在のアプリに未実装の検出は勝手に発火させない
    entrance_near: "まもなく駐車場入口です。入口の案内表示をご確認ください。",
    entrance_entered: "駐車場に入りました。歩行者やほかの車両に注意して、徐行してください。",
    route_turn: "この先を［方向］に進み、［エリア名］へお進みください。",
    space_unavailable: "ご案内していた駐車枠は、現在利用できません。別の駐車枠をご案内します。",
    timer_started: "駐車時間の記録を開始しました。",
    timer_elapsed: "現在の駐車時間は［駐車時間］です。",
    parked_location: "お客様の駐車場所は、［駐車枠］番です。繰り返します。［駐車枠］番です。",
    exit_detected: "駐車場からの退出を確認しました。ご利用ありがとうございました。",
    // 現行アプリの研究用録画を実際の空きと誤認させない
    recorded_demo: "これは録画映像による研究実演です。現在の駐車場の空き状況ではありません。",
    // 固定文として事前生成しておくその他の既存案内
    closing_soon: "まもなく閉店時刻です。閉店まで1時間以内です。",
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
