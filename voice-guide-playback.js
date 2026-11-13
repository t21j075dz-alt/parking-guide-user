"use strict";
/**
 * 卒業研究：音声部品の組み立て補助。
 * 音声ファイルが揃っている場合は各部品をWeb Audioで連続再生する。
 * 未保存のときは同じ部品から「意味の区切り」を組み立て、
 * 端末の音声で順番に読み上げる（外部音声APIは呼ばない）。
 */
window.ParkingVoiceAssembler = (() => {
  function normalizeParts(parts) {
    if (!Array.isArray(parts)) return [];
    return parts.map(v => String(typeof v === "string" ? v : v?.text ?? ""))
      .filter(v => v.trim().length > 0);
  }

  function sentences(parts, maxChars = 78) {
    const text = normalizeParts(parts).join("");
    if (!text) return [];
    const pieces = text.match(/[^。！？.!?]+[。！？.!?]?/g) || [text];
    const result = [];
    let current = "";
    for (const item of pieces) {
      // 駐車枠の場所、繰り返し、到着、安全注意は独立した意味のまとまり。
      // 「エリア名」「店舗名」「枠番号」は語句の途中で切らずに読み上げる。
      const isKeySentence = /(?:繰り返します|くりかえします|まもなく目的地です|(?:番|ばん)です)[。！？.!?]?$/.test(item);
      if (current && (current.length + item.length > maxChars || isKeySentence)) {
        result.push(current); current = "";
      }
      if (item.length <= maxChars) {
        current += item;
        if (isKeySentence) { result.push(current); current = ""; }
      } else {
        if (current) { result.push(current); current = ""; }
        // 長い文を読点で区切る。名前・駐車枠番号を勝手に省略しない。
        const phrases = item.split(/(?<=、)/g);
        for (const phrase of phrases) {
          if (current && current.length + phrase.length > maxChars) {
            result.push(current); current = "";
          }
          current += phrase;
        }
      }
    }
    if (current) result.push(current);
    return result.filter(Boolean);
  }
  function segments(parts) {
    return sentences(parts).map(text => ({
      text,
      pauseAfterMs: /(?:繰り返します|くりかえします)[。！？]$/.test(text) ? 450
        : /(?:まもなく目的地です|(?:番|ばん)です)[。！？]$/.test(text) ? 280 : 170,
    }));
  }

  /**
   * 「A列 12」「B区画 7」「C9」の読みを既存の音声部品で構成する。
   * 施設専用に生成された全文音声が利用できない場合だけ使用する。
   * 読みが不明な名前・独自の読み仮名は勝手に分割しない。
   */
  function savedSpacePieces(value) {
    const text = String(value ?? "").trim();
    if (!text || typeof japaneseSpaceReading !== "function"
        || typeof japaneseNumber !== "function") return [text];
    const numbers = new Set(Array.from({ length: 99 }, (_, i) => japaneseNumber(i + 1)));
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const spokenLetter = japaneseSpaceReading(letter);
      const prefix = spokenLetter + "、";
      if (!text.startsWith(prefix)) continue;
      let rest = text.slice(prefix.length).trim();
      let areaLabel = "";
      for (const candidate of ["れつ", "くかく"]) {
        if (!rest.startsWith(candidate)) continue;
        const suffix = rest.slice(candidate.length).trim();
        if (numbers.has(suffix)) {
          areaLabel = candidate;
          rest = suffix;
          break;
        }
      }
      if (numbers.has(rest)) {
        return areaLabel ? [spokenLetter, areaLabel, rest] : [spokenLetter, rest];
      }
    }
    return [text];
  }

  return Object.freeze({ normalizeParts, sentences, segments, savedSpacePieces });
})();
