// lib/voice/wav.ts
// Float32 PCM → 16-bit PCM WAV 인코더 + base64. 의존성 없음(브라우저 내장만).
//
// 왜 필요한가: 브라우저 MediaRecorder 산출물은 Chrome=webm/opus, Safari=mp4/aac 로 갈리는데
// Gemini 가 받는 오디오 포맷 목록(WAV·MP3·AIFF·AAC·OGG·FLAC)에 webm 이 없다. 컨테이너를
// 그대로 올리면 브라우저에 따라 업스트림이 거절한다. → 항상 WAV 한 포맷으로 정규화해서 보낸다.
// 부수 효과: 16kHz 모노 = 32KB/s 로 페이로드 크기가 결정적이 된다(60초 ≈ 1.9MB).

/** 받아쓰기용 샘플레이트. 음성 인식은 16kHz면 충분하고, 그 이상은 페이로드만 키운다. */
export const TARGET_SAMPLE_RATE = 16_000;

/** 다채널 → 모노 평균 다운믹스. */
function toMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  for (let i = 0; i < length; i++) out[i] /= numberOfChannels;
  return out;
}

/**
 * 선형보간 리샘플. 받아쓰기 품질에선 polyphase 같은 고급 필터가 필요 없고,
 * 원본(48kHz)→16kHz 정수배 다운샘플이 대부분이라 앨리어싱 영향도 미미하다.
 */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Float32(-1..1) PCM → 16-bit PCM WAV 바이트(헤더 44B 포함). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  const dataSize = samples.length * 2;
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt 청크 길이
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // 모노
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = rate * channels * bytesPerSample
  view.setUint16(32, 2, true);           // blockAlign
  view.setUint16(34, 16, true);          // bitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return bytes;
}

/** 바이트 → base64. btoa는 인자 길이 제한이 있어 청크로 나눠 넣는다(대용량에서 스택 오버플로 방지). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 녹음 Blob(webm/mp4/…) → 16kHz 모노 WAV base64.
 * 브라우저 내장 디코더(decodeAudioData)가 컨테이너를 풀어주므로 포맷 협상이 필요 없다.
 */
export async function blobToWavBase64(
  blob: Blob,
): Promise<{ base64: string; durationMs: number; sampleCount: number }> {
  const AudioCtx =
    (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!AudioCtx) throw new Error('audio_context_unavailable');
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded: AudioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const mono = toMono(decoded);
    const resampled = resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const wav = encodeWav(resampled, TARGET_SAMPLE_RATE);
    return {
      base64: bytesToBase64(wav),
      durationMs: Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000),
      sampleCount: resampled.length,
    };
  } finally {
    // AudioContext는 명시적으로 닫지 않으면 탭당 개수 제한(~6)에 걸려 이후 녹음이 조용히 실패한다.
    void ctx.close?.();
  }
}
