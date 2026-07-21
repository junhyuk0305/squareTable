// lib/voice/recorder.web.ts
// 웹(브라우저·PWA) 녹음 구현. getUserMedia + MediaRecorder + AnalyserNode.
// 네이티브 구현은 recorder.ts(expo-audio) — Metro 가 플랫폼별로 골라 넣고, 화면은 둘을 구분하지 않는다.
// 자동 종료 규칙(임계값·대기시간)은 shared.ts 의 SpeechGate 하나뿐 — 여기선 레벨만 재서 먹인다.

import { blobToWavBase64 } from './wav';
import {
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  LEVEL_POLL_MS,
  SpeechGate,
  VoiceError,
  type AutoStopReason,
  type RecordingResult,
  type VoiceRecorderModule,
} from './shared';

/** 이 환경에서 음성 입력을 켤 수 있는가. false면 마이크 버튼을 아예 숨긴다. */
export function supportsVoice(): boolean {
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

/** 라이브 입력 레벨을 재서 SpeechGate 에 먹인다(판정 규칙 자체는 shared.ts). */
function startLevelMonitor(session: Session, onAutoStop: (reason: AutoStopReason) => void) {
  const AudioCtx = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!AudioCtx) return; // 레벨 감지 불가 → 최대길이 캡만으로 동작(기능이 죽지는 않는다)
  const ctx = new AudioCtx();
  // Safari는 사용자 제스처 밖에서 만든 AudioContext를 suspended로 둔다. 이 컨텍스트는
  // await getUserMedia 뒤에 생기므로 제스처 문맥을 벗어나 있다 → 안 깨우면 analyser가 계속
  // 0만 뱉고, 말을 해도 감지 못 해 no_speech로 취소된다(iOS에서 기능이 통째로 죽는 경로).
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
  const gate = new SpeechGate(session.startedAt);
  session.levelTimer = setInterval(() => {
    if (session.cancelled) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const reason = gate.push(Math.sqrt(sum / buf.length), Date.now());
    if (reason) onAutoStop(reason);
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
 *   'max_length' 최대길이 도달       → 전사
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

  // 자동 종료가 두 번 불리지 않게(무음 판정이 주기적으로 돌고, 최대길이 타이머와도 겹칠 수 있다).
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

// 계약 준수 확인 — 네이티브 구현(recorder.ts)과 형태가 어긋나면 여기서 타입 에러가 난다.
const _contract: VoiceRecorderModule = { supportsVoice, startRecording, stopRecording, cancelRecording, isRecording };
void _contract;
