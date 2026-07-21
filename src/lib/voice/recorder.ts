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
};

// 동시에 하나만 — 두 화면이 겹쳐 뜨더라도 마이크는 한 세션만 잡는다.
let current: Session | null = null;

/** 브라우저가 실제로 만들어줄 수 있는 컨테이너를 고른다(디코딩은 어차피 우리가 WAV로 바꾼다). */
function pickMimeType(): string | undefined {
  const MR = (globalThis as any).MediaRecorder;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MR?.isTypeSupported?.(t));
}

function teardown(session: Session) {
  if (session.autoStopTimer) clearTimeout(session.autoStopTimer);
  session.autoStopTimer = null;
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
 * onAutoStop: MAX_RECORD_MS 도달로 자동 정지됐을 때 UI가 상태를 맞출 수 있게 알림.
 */
export async function startRecording(onAutoStop?: () => void): Promise<void> {
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
  const session: Session = {
    recorder,
    stream,
    chunks: [],
    startedAt: Date.now(),
    autoStopTimer: null,
    cancelled: false,
  };
  recorder.ondataavailable = (ev: any) => {
    if (ev?.data?.size > 0) session.chunks.push(ev.data);
  };
  current = session;
  recorder.start();

  // 길이 하드캡 — 주머니 속에서 계속 녹음되는 사고를 막는다.
  session.autoStopTimer = setTimeout(() => {
    try {
      if (recorder.state === 'recording') recorder.stop();
    } catch {
      /* 무시 */
    }
    onAutoStop?.();
  }, MAX_RECORD_MS);
}

/** 녹음 중인가(화면 상태 복구용). */
export function isRecording(): boolean {
  return !!current && current.recorder?.state === 'recording';
}

/** 경과 시간(ms). 녹음 중이 아니면 0. */
export function elapsedMs(): number {
  return current ? Date.now() - current.startedAt : 0;
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
  const blob = await new Promise<Blob>((resolve, reject) => {
    const { recorder } = session;
    if (recorder.state === 'inactive') {
      // 자동 정지가 이미 걸린 경우 — 남은 chunk 로 바로 만든다.
      resolve(new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' }));
      return;
    }
    recorder.onstop = () => resolve(new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' }));
    recorder.onerror = (e: any) => reject(new VoiceError('failed', e?.error?.name ?? 'recorder_error'));
    try {
      recorder.stop();
    } catch (e: any) {
      reject(new VoiceError('failed', e?.message));
    }
  }).finally(() => teardown(session));

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
