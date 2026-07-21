// lib/voice/recorder.ts
// 마이크 녹음 어댑터. 화면(VoiceInputButton)은 이 인터페이스만 알고, 플랫폼 분기는 여기서 끝난다.
//
// 현재 구현: 웹(getUserMedia + MediaRecorder). 네이티브(iOS/Android 앱)는 미구현이라
// supportsVoice()가 false → 마이크 버튼 자체가 안 그려진다(눌렀는데 아무 일 없는 상태 금지).
// 네이티브 추가 시 이 파일에 expo-audio 분기만 넣으면 되고 호출부는 안 건드린다.

import { Platform } from 'react-native';

import { blobToWavBase64 } from './wav';

/** 한 번에 녹음 가능한 최대 길이. 넘으면 자동 정지(비용·페이로드 상한과 연동). */
export const MAX_RECORD_MS = 60_000;
/** 이보다 짧으면 오발화(잘못 눌렀다 뗌)로 보고 전사에 보내지 않는다. */
export const MIN_RECORD_MS = 600;

// ── 자동 종료(무음 감지) ─────────────────────────────────────
// 사장님은 말을 끝내고 버튼을 다시 누르는 걸 잊는다. 그러면 60초 캡까지 계속 녹음돼
// 뒤에 붙은 침묵·잡음까지 업로드된다(느리고, 비싸고, 오인식도 늘어난다).
// → 말이 끝나면 스스로 멈춘다. 최대길이 캡은 그대로 두고(주머니 속 사고 방지) 그 위에 얹는다.
/** 말이 한 번 시작된 뒤, 이만큼 조용하면 "끝났다"로 보고 자동 정지 → 바로 전사. */
export const SILENCE_AFTER_SPEECH_MS = 2_500;
/**
 * 시작하고 이 시간까지 말이 한 번도 안 잡히면 자동 취소(전사에 보내지 않는다).
 * 마이크를 누르고 무슨 말을 할지 정리하는 시간이 있으므로 넉넉히 — 말이 시작되면 이 타이머는
 * 무의미해지니(그 뒤엔 SILENCE_AFTER_SPEECH_MS 가 담당) 길게 잡아도 손해가 없다.
 */
export const NO_SPEECH_TIMEOUT_MS = 10_000;
const LEVEL_POLL_MS = 100;
// 절대 임계값 하한. 카페 소음·AGC(자동 이득)로 바닥이 올라가면 아래 noiseFloor 배수가 대신 잡는다.
const SPEECH_MIN_RMS = 0.012;
const SPEECH_OVER_FLOOR = 2.5;   // 배경 소음 대비 이 배수 이상이어야 '말'
const FLOOR_RISE = 1.02;         // 바닥은 천천히 오르고(소음 증가 추종)
// 자동 종료 사유 — 호출부가 "전사할 것 / 버릴 것"을 구분한다.
export type AutoStopReason = 'silence' | 'max_length' | 'no_speech';

export type RecordingResult = {
  /** 16kHz 모노 16-bit PCM WAV 의 base64. */
  base64: string;
  mimeType: 'audio/wav';
  durationMs: number;
};

/** 호출부가 사용자에게 그대로 보여줄 수 있는 실패 사유. */
export type VoiceErrorKind =
  | 'unsupported'      // 이 환경에서 녹음 불가
  | 'permission'       // 마이크 권한 거부
  | 'too_short'        // 너무 짧게 눌렀다 뗌
  | 'no_audio'         // 캡처된 오디오가 없음
  | 'failed';          // 그 외

export class VoiceError extends Error {
  kind: VoiceErrorKind;
  constructor(kind: VoiceErrorKind, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

/** 이 환경에서 음성 입력을 켤 수 있는가. false면 마이크 버튼을 아예 숨긴다. */
export function supportsVoice(): boolean {
  if (Platform.OS !== 'web') return false; // 네이티브는 아직 미구현(P3)
  const md = (globalThis as any).navigator?.mediaDevices;
  return !!md?.getUserMedia && typeof (globalThis as any).MediaRecorder !== 'undefined';
}

type Session = {
  recorder: any;            // MediaRecorder
  stream: any;              // MediaStream
  chunks: Blob[];
  startedAt: number;
  autoStopTimer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
  // 무음 감지용 — 세션과 수명을 같이 한다(teardown에서 반드시 정리).
  audioCtx: any | null;
  levelTimer: ReturnType<typeof setInterval> | null;
  /**
   * 녹음 완료(= 마지막 chunk 까지 도착) 신호. ★ recorder.state 로 완료를 추론하면 안 된다:
   * stop() 은 state 를 동기적으로 'inactive' 로 바꾸지만 dataavailable 은 그 다음 태스크에서
   * 온다(실측: stop 직후 chunks=0 → 500ms 뒤 1개). 최대길이 타이머가 stop() 한 뒤 같은 틱에
   * blob 을 만들면 60초 녹음이 통째로 빈 blob 이 된다.
   */
  stopped: Promise<void>;
};

// 동시에 하나만 — 두 화면이 겹쳐 뜨더라도 마이크는 한 세션만 잡는다.
let current: Session | null = null;

/** 브라우저가 실제로 만들어줄 수 있는 컨테이너를 고른다(디코딩은 어차피 우리가 WAV로 바꾼다). */
function pickMimeType(): string | undefined {
  const MR = (globalThis as any).MediaRecorder;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MR?.isTypeSupported?.(t));
}

/**
 * 라이브 입력 레벨을 100ms마다 재서 "말이 끝났는지"를 판정한다.
 *
 * 고정 임계값 하나로는 안 된다 — 브라우저 AGC(자동 이득)가 조용할 때 배경 소음을 끌어올려서
 * 시끄러운 매장에선 무음 구간도 임계값을 넘어버린다(→ 영영 안 멈춤). 그래서 배경 소음 바닥
 * (noiseFloor)을 계속 추적하고 "바닥 대비 몇 배"로 판정한다. 바닥은 내려갈 땐 즉시,
 * 올라갈 땐 천천히(FLOOR_RISE) 따라가 순간적인 말소리를 바닥으로 착각하지 않는다.
 */
function startLevelMonitor(session: Session, onAutoStop?: (reason: AutoStopReason) => void) {
  const AudioCtx = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!AudioCtx) return; // 레벨 감지 불가 → 최대길이 캡만으로 동작(기능이 죽지는 않는다)
  const ctx = new AudioCtx();
  // Safari는 사용자 제스처 밖에서 만든 AudioContext를 suspended로 둔다. 이 컨텍스트는
  // await getUserMedia 뒤에 생기므로 제스처 문맥을 벗어나 있다 → 안 깨우면 analyser가 계속
  // 0만 뱉고, 말을 해도 감지 못 해 6초 뒤 no_speech로 취소된다(iOS에서 기능이 통째로 죽는 경로).
  void ctx.resume?.();
  const source = ctx.createMediaStreamSource(session.stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  // 일부 브라우저는 destination까지 연결된 그래프만 렌더링한다 → analyser가 데이터를 못 받는다.
  // gain 0을 거쳐 연결해 소리는 안 나가면서 그래프만 살린다(에코·하울링 방지).
  const mute = ctx.createGain();
  mute.gain.value = 0;
  analyser.connect(mute);
  mute.connect(ctx.destination);
  session.audioCtx = ctx;

  const buf = new Float32Array(analyser.fftSize);
  let noiseFloor = Infinity;
  let sawSpeech = false;
  let lastLoudAt = Date.now();

  session.levelTimer = setInterval(() => {
    if (session.cancelled) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    noiseFloor = rms < noiseFloor ? rms : Math.min(noiseFloor * FLOOR_RISE, rms);
    const threshold = Math.max(SPEECH_MIN_RMS, noiseFloor * SPEECH_OVER_FLOOR);

    const now = Date.now();
    if (rms > threshold) {
      sawSpeech = true;
      lastLoudAt = now;
      return;
    }
    // 말이 한 번도 없었다 → 잘못 눌렀거나 마이크가 안 잡히는 것. 전사에 보내지 않고 끝낸다.
    if (!sawSpeech && now - session.startedAt > NO_SPEECH_TIMEOUT_MS) {
      onAutoStop?.('no_speech');
      return;
    }
    // 말하다가 조용해졌다 → 끝난 것으로 보고 바로 전사(사장이 버튼을 다시 안 눌러도 된다).
    if (sawSpeech && now - lastLoudAt > SILENCE_AFTER_SPEECH_MS) {
      onAutoStop?.('silence');
    }
  }, LEVEL_POLL_MS);
}

function teardown(session: Session) {
  if (session.autoStopTimer) clearTimeout(session.autoStopTimer);
  session.autoStopTimer = null;
  if (session.levelTimer) clearInterval(session.levelTimer);
  session.levelTimer = null;
  // AudioContext는 안 닫으면 탭당 개수 제한(~6)에 걸려 이후 녹음이 조용히 실패한다.
  try { void session.audioCtx?.close?.(); } catch { /* 무시 */ }
  session.audioCtx = null;
  // 트랙을 안 멈추면 탭에 마이크 사용중 표시가 남는다(사용자 신뢰 직결).
  try {
    session.stream?.getTracks?.().forEach((t: any) => t.stop());
  } catch {
    /* 무시 — 이미 정리됨 */
  }
  if (current === session) current = null;
}

/**
 * 녹음 시작. 권한 프롬프트가 여기서 뜨므로 반드시 사용자 제스처(탭) 안에서 호출해야 한다
 * (iOS Safari는 제스처 밖 getUserMedia를 거부한다).
 *
 * onAutoStop: 사용자가 정지 버튼을 안 눌러도 끝나는 세 경우를 알린다.
 *   'silence'    말이 끝나고 조용해짐 → 호출부는 그대로 전사하면 된다(주 경로)
 *   'max_length' 60초 캡 도달       → 전사
 *   'no_speech'  아무 말도 안 잡힘   → 전사하지 말고 버린다
 */
export async function startRecording(onAutoStop?: (reason: AutoStopReason) => void): Promise<void> {
  if (!supportsVoice()) throw new VoiceError('unsupported');
  if (current) await cancelRecording(); // 이전 세션 잔존 방지

  let stream: any;
  try {
    stream = await (globalThis as any).navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e: any) {
    // NotAllowedError/SecurityError = 사용자 거부 또는 비보안 출처. 나머지는 장치 문제.
    const name = e?.name ?? '';
    throw new VoiceError(
      name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'failed',
      name,
    );
  }

  const mimeType = pickMimeType();
  const MR = (globalThis as any).MediaRecorder;
  const recorder = new MR(stream, mimeType ? { mimeType } : undefined);
  // 완료 신호는 시작 시점에 한 번만 건다 — 누가(사용자/타이머/무음감지) 멈추든 같은 신호를 기다린다.
  let markStopped: () => void = () => {};
  const stopped = new Promise<void>((res) => { markStopped = res; });
  const session: Session = {
    recorder,
    stream,
    chunks: [],
    startedAt: Date.now(),
    autoStopTimer: null,
    cancelled: false,
    audioCtx: null,
    levelTimer: null,
    stopped,
  };
  recorder.ondataavailable = (ev: any) => {
    if (ev?.data?.size > 0) session.chunks.push(ev.data);
  };
  recorder.onstop = () => markStopped();
  // 레코더가 죽어도 영원히 기다리지 않게 — 에러도 '완료'로 풀고, 빈 chunk 는 아래에서 no_audio 로 걸린다.
  recorder.onerror = () => markStopped();
  current = session;
  recorder.start();

  // 자동 종료가 두 번 불리지 않게(무음 판정이 100ms마다 돌고, 최대길이 타이머와도 겹칠 수 있다).
  let notified = false;
  const notifyOnce = (reason: AutoStopReason) => {
    if (notified || session.cancelled) return;
    notified = true;
    if (session.levelTimer) { clearInterval(session.levelTimer); session.levelTimer = null; }
    onAutoStop?.(reason);
  };
  startLevelMonitor(session, notifyOnce);

  // 길이 하드캡 — 무음 감지가 못 잡는 경우(계속 시끄러운 곳, 레벨 감지 불가 브라우저)의 최후 방어선.
  session.autoStopTimer = setTimeout(() => {
    try {
      if (recorder.state === 'recording') recorder.stop();
    } catch {
      /* 무시 */
    }
    notifyOnce('max_length');
  }, MAX_RECORD_MS);
}

/** 녹음 중인가(화면 상태 복구용). */
export function isRecording(): boolean {
  return !!current && current.recorder?.state === 'recording';
}

/** 녹음 취소 — 결과를 버리고 마이크를 놓는다. */
export async function cancelRecording(): Promise<void> {
  const session = current;
  if (!session) return;
  session.cancelled = true;
  try {
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  } catch {
    /* 무시 */
  }
  teardown(session);
}

/** 녹음 정지 → 16kHz 모노 WAV base64. 실패는 VoiceError 로 던진다(조용히 빈 값 금지). */
export async function stopRecording(): Promise<RecordingResult> {
  const session = current;
  if (!session) throw new VoiceError('failed', 'no_session');

  const durationMs = Date.now() - session.startedAt;
  const { recorder } = session;
  let blob: Blob;
  try {
    // 아직 녹음 중이면 여기서 멈추고, 최대길이 타이머가 이미 멈춰놨으면 그대로 완료만 기다린다.
    // 어느 쪽이든 ★반드시 stopped(=onstop) 를 기다린다 — state 만 보고 chunk 를 읽으면
    // 마지막 dataavailable 이 도착하기 전이라 빈 blob 이 나온다(실측).
    if (recorder.state !== 'inactive') recorder.stop();
    await session.stopped;
    blob = new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' });
  } catch (e: any) {
    teardown(session);
    throw new VoiceError('failed', e?.message ?? 'recorder_stop_failed');
  }
  teardown(session);

  if (session.cancelled) throw new VoiceError('failed', 'cancelled');
  if (durationMs < MIN_RECORD_MS) throw new VoiceError('too_short');
  if (!blob || blob.size === 0) throw new VoiceError('no_audio');

  try {
    const { base64, durationMs: decodedMs } = await blobToWavBase64(blob);
    if (!base64) throw new VoiceError('no_audio');
    return { base64, mimeType: 'audio/wav', durationMs: decodedMs || durationMs };
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    throw new VoiceError('failed', (e as Error)?.message);
  }
}
