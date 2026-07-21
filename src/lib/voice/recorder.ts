// lib/voice/recorder.ts
// 네이티브(iOS·Android) 녹음 구현. expo-audio.
// 웹 구현은 recorder.web.ts — Metro 가 플랫폼별로 골라 넣으므로 화면은 둘을 구분하지 않는다.
// (TypeScript 는 이 파일을 '@/lib/voice/recorder' 로 해석한다 → 두 구현이 같은 계약을
//  만족하는지는 각 파일 끝의 _contract 로 강제된다.)
//
// ★ expo-audio 는 recorder 인스턴스를 만드는 명령형 API(createAudioRecorder 같은 것)를
//   문서화하지 않았다. 문서상 유일한 경로가 useAudioRecorder 훅이라, 앱 루트에서 훅으로 만든
//   인스턴스를 여기에 bind 해서 쓴다(VoiceRecorderBinder). bind 전에는 supportsVoice()=false
//   → 마이크 버튼이 안 그려진다(눌렀는데 아무 일 없는 상태 금지).

import { Platform } from 'react-native';
// 이 파일은 네이티브 전용(웹은 recorder.web.ts)이라 expo-audio 를 정적으로 import 해도
// 웹 번들에 들어가지 않는다. enum 을 직접 써서 오타·잘못된 값이 타입 단계에서 걸리게 한다.
import { AudioQuality, IOSOutputFormat, type AudioRecorder, type RecordingOptions } from 'expo-audio';

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

/**
 * 녹음 포맷 — 엣지가 받는 형식(Gemini 지원 목록)으로만 뽑는다.
 *   iOS     : LINEAR PCM = WAV. 엣지의 결정적 비발화 게이트가 그대로 걸린다.
 *   Android : AndroidOutputFormat 에 LINEAR PCM 이 없다 → AAC(ADTS). 엣지가 PCM 을 못 읽으므로
 *             비발화 차단은 아래 클라이언트 게이트(SpeechGate)가 단독으로 책임진다.
 * 둘 다 16kHz 모노 — 받아쓰기엔 충분하고 업로드가 가벼워진다.
 */
export const NATIVE_RECORDING_OPTIONS: RecordingOptions = {
  extension: Platform.OS === 'ios' ? '.wav' : '.aac',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true, // ← 무음 자동종료의 전제(이게 false 면 metering 이 안 온다)
  android: { outputFormat: 'aac_adts', audioEncoder: 'aac', sampleRate: 16_000 },
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
    sampleRate: 16_000,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64_000 },
};

const NATIVE_MIME: RecordingResult['mimeType'] = Platform.OS === 'ios' ? 'audio/wav' : 'audio/aac';

// ── 앱 루트에서 주입되는 recorder 인스턴스 ───────────────────
let bound: AudioRecorder | null = null;
/** 앱 루트(VoiceRecorderBinder)가 훅으로 만든 인스턴스를 넘겨준다. */
export function bindRecorder(rec: AudioRecorder | null) {
  bound = rec;
}

/**
 * 네이티브 빌드에는 expo-audio 가 항상 들어있으므로 지원 여부는 플랫폼만 본다.
 * ⚠️ 여기서 bound 를 보면 안 된다 — 호출부(VoiceInputButton)는 이 값을 첫 렌더에 한 번만 읽는데
 * bind 는 루트의 effect 에서 일어난다. 딥링크로 화면에 바로 진입하면 아직 bind 전이라
 * 마이크 버튼이 그 화면에서 영영 숨는다. 준비 여부는 실제로 누른 순간(startRecording)에 본다.
 */
export function supportsVoice(): boolean {
  return Platform.OS !== 'web';
}

type Session = {
  startedAt: number;
  cancelled: boolean;
  levelTimer: ReturnType<typeof setInterval> | null;
  autoStopTimer: ReturnType<typeof setTimeout> | null;
};
let current: Session | null = null;

function teardown(session: Session) {
  if (session.levelTimer) clearInterval(session.levelTimer);
  session.levelTimer = null;
  if (session.autoStopTimer) clearTimeout(session.autoStopTimer);
  session.autoStopTimer = null;
  if (current === session) current = null;
}

/**
 * metering → 0~1 선형 레벨.
 * ⚠️ expo-audio 문서는 metering 의 단위·범위를 명시하지 않는다. 실측·플랫폼 관례상 dBFS
 * (무음 -160 ~ 최대 0)로 보고 선형 진폭으로 되돌린다. 혹시 이미 0~1 선형이면 그 값을 그대로 쓴다
 * (양수는 dBFS 일 수 없으므로 이 판별은 안전하다). 어느 쪽이든 SpeechGate 는 "배경 대비 배수"로
 * 판정하므로 스케일이 조금 달라도 동작한다.
 */
function toLinearLevel(metering: number | undefined): number {
  if (typeof metering !== 'number' || Number.isNaN(metering)) return 0;
  if (metering > 0) return Math.min(1, metering);       // 이미 선형(0~1)
  if (metering <= -160) return 0;                        // 사실상 무음
  return Math.min(1, Math.pow(10, metering / 20));       // dBFS → 진폭
}

export async function startRecording(onAutoStop?: (reason: AutoStopReason) => void): Promise<void> {
  const rec = bound;
  if (Platform.OS === 'web') throw new VoiceError('unsupported');
  if (!rec) throw new VoiceError('not_ready');
  if (current) await cancelRecording();

  // 권한 — 거부면 여기서 끝낸다(녹음을 시작해놓고 빈 파일을 만드는 것보다 낫다).
  const { AudioModule, setAudioModeAsync } = await import('expo-audio');
  const perm = await AudioModule.requestRecordingPermissionsAsync();
  if (!perm.granted) throw new VoiceError('permission');

  // iOS: 무음 스위치가 켜져 있어도 녹음되게 + 녹음 세션 활성화.
  try {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  } catch {
    /* 오디오 모드 설정 실패가 녹음 자체를 막지는 않는다 — 계속 진행 */
  }

  try {
    await rec.prepareToRecordAsync(NATIVE_RECORDING_OPTIONS);
    rec.record();
  } catch (e: any) {
    throw new VoiceError('failed', e?.message ?? 'prepare_failed');
  }

  const session: Session = { startedAt: Date.now(), cancelled: false, levelTimer: null, autoStopTimer: null };
  current = session;

  let notified = false;
  const notifyOnce = (reason: AutoStopReason) => {
    if (notified || session.cancelled) return;
    notified = true;
    if (session.levelTimer) { clearInterval(session.levelTimer); session.levelTimer = null; }
    onAutoStop?.(reason);
  };

  // 무음 자동종료 — 웹과 같은 SpeechGate 를 쓴다(규칙은 shared.ts 한 곳).
  const gate = new SpeechGate(session.startedAt);
  session.levelTimer = setInterval(() => {
    if (session.cancelled) return;
    let metering: number | undefined;
    try {
      metering = rec.getStatus()?.metering;
    } catch {
      return; // 상태를 못 읽으면 이번 틱은 건너뛴다(최대길이 캡이 최후 방어선)
    }
    const reason = gate.push(toLinearLevel(metering), Date.now());
    if (reason) notifyOnce(reason);
  }, LEVEL_POLL_MS);

  // 길이 하드캡 — 여기선 레코더를 멈추지 않고 알리기만 한다(정지는 stopRecording 이 단독 담당).
  session.autoStopTimer = setTimeout(() => notifyOnce('max_length'), MAX_RECORD_MS);
}

export function isRecording(): boolean {
  if (!current || current.cancelled) return false;
  try {
    return bound?.getStatus()?.isRecording ?? false;
  } catch {
    return false;
  }
}

export async function cancelRecording(): Promise<void> {
  const session = current;
  if (!session) return;
  session.cancelled = true;
  teardown(session);
  try {
    await bound?.stop();
  } catch {
    /* 무시 — 결과를 버릴 참이다 */
  }
  await releaseAudioSession();
}

/** iOS 는 녹음 모드를 켜둔 채로 두면 이후 재생 음량이 작아진다 → 끝나면 되돌린다. */
async function releaseAudioSession() {
  if (Platform.OS !== 'ios') return;
  try {
    const { setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({ allowsRecording: false });
  } catch {
    /* 무시 */
  }
}

export async function stopRecording(): Promise<RecordingResult> {
  const session = current;
  const rec = bound;
  if (!session || !rec) throw new VoiceError('failed', 'no_session');

  const durationMs = Date.now() - session.startedAt;
  teardown(session);

  try {
    await rec.stop();
  } catch (e: any) {
    await releaseAudioSession();
    throw new VoiceError('failed', e?.message ?? 'stop_failed');
  }
  await releaseAudioSession();

  if (session.cancelled) throw new VoiceError('failed', 'cancelled');
  if (durationMs < MIN_RECORD_MS) throw new VoiceError('too_short');

  const uri = rec.uri;
  if (!uri) throw new VoiceError('no_audio');

  try {
    // SDK 56 파일 API — 레거시 readAsStringAsync 는 deprecated.
    const { File } = await import('expo-file-system');
    const base64 = await new File(uri).base64();
    if (!base64) throw new VoiceError('no_audio');
    return { base64, mimeType: NATIVE_MIME, durationMs };
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    throw new VoiceError('failed', (e as Error)?.message ?? 'read_failed');
  }
}

// 계약 준수 확인 — 웹 구현(recorder.web.ts)과 형태가 어긋나면 여기서 타입 에러가 난다.
const _contract: VoiceRecorderModule = { supportsVoice, startRecording, stopRecording, cancelRecording, isRecording };
void _contract;
