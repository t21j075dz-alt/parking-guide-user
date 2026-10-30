"use strict";

/**
 * 保存済みVOICEVOX音声を1本のAudioBufferにまとめる。
 * Safari / iOSでAudioBufferSourceNodeを数十個予約すると、先頭の
 * 1部品だけが鳴る環境があるため、可能な場合は1音源として再生する。
 *
 * サンプルレートはdecodeAudioDataによってAudioContextに揃っている。
 * 連結に失敗した場合はnullを返し、従来の個別音源方式へ戻す。
 */
window.ParkingContinuousVoice = (() => {
  function pauseSeconds(text) {
    const phrase = String(text || "");
    if (/繰り返します。|くりかえします。/.test(phrase)) return .42;
    if (/[。！？!?]$/.test(phrase)) return .20;
    return 0;
  }

  function join(context, buffers, parts = []) {
    if (typeof context?.createBuffer !== "function"
        || !Array.isArray(buffers) || !buffers.length) return null;
    try {
      const rate = Number(context.sampleRate);
      if (!Number.isFinite(rate) || rate < 8000) return null;
      const channels = Math.min(2, Math.max(...buffers.map(b => b?.numberOfChannels || 0)));
      if (channels < 1) return null;
      const frames = buffers.map(b => {
        if (!Number.isInteger(b?.length) || b.length < 1
            || typeof b.getChannelData !== "function"
            || (Number.isFinite(b.sampleRate) && Math.abs(b.sampleRate-rate) > 1)) {
          throw new Error("Unsupported decoded audio format");
        }
        return b.length;
      });
      const gaps = buffers.map((_,i) => i < buffers.length-1
        ? Math.round(pauseSeconds(parts[i]) * rate) : 0);
      const total = frames.reduce((n,k)=>n+k,0) + gaps.reduce((n,k)=>n+k,0);
      // 長い台本で大量のPCMメモリを要求しない。
      if (total <= 0 || total > rate * 90) return null;
      const merged = context.createBuffer(channels, total, rate);
      let offset = 0;
      for (let i=0; i<buffers.length; i++) {
        const source = buffers[i];
        let peak = 0;
        for (let c=0; c<source.numberOfChannels; c++) {
          const samples = source.getChannelData(c);
          for (let j=0; j<samples.length; j++) peak = Math.max(peak,Math.abs(samples[j]));
        }
        const gain = peak > 0 ? Math.min(3,.9/peak) : 1;
        const fade = Math.min(Math.round(rate*.004), Math.floor(source.length/5));
        for (let c=0; c<channels; c++) {
          const input = source.getChannelData(Math.min(c,source.numberOfChannels-1));
          const dest = merged.getChannelData(c);
          for (let j=0; j<input.length; j++) {
            const envelope = fade ? Math.min(1,(j+1)/fade,(input.length-j)/fade) : 1;
            dest[offset+j] = Math.max(-1,Math.min(1,input[j]*gain*envelope));
          }
        }
        offset += source.length + gaps[i];
      }
      return merged;
    } catch {
      return null;
    }
  }
  return Object.freeze({join,pauseSeconds});
})();
