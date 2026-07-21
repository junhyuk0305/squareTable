// lib/voice/shared.ts
// 웹·네이티브 녹음 구현이 공유하는 계약(타입·상수·판정 규칙). 플랫폼 코드는 여기에 두지 않는다.
//
// 왜 분리했나: 녹음 방식은 플랫폼마다 완전히 다르지만(웹=MediaRecorder, 네이티브=expo-audio)
// "언제 자동으로 멈추는가 / 어떤 실패를 사용자에게 뭐라고 말하는가"는 하나여야 한다.
// 임계값이 두 파일에 복제되면 한쪽만 고쳐져 플랫폼별로 다르게 동작한다(SSOT).

/** 한 번에 녹음 가능한 최대 길이. 넘으면 자동 정지(비용·페이로드 상한과 연동). */
export const MAX_RECORD_MS = 60_000;
/** 이보다 짧으면 오발화(잘못 눌렀다 뗌)로 보고 전사에 보내지 않는다. */
export const MIN_RECORD_MS = 600;

// ── 자동 종료(무음 감지) ─────────────────────────────────────
// 사장님은 말을 끝내고 버튼을 다시 누르는 걸 잊는다. 그러면 최대길이까지 계속 녹음돼
// 뒤에 붙은 침묵·잡음까지 업로드된다(느리고, 비싸고, 오인식도 늘어난다).
/** 말이 한 번 시작된 뒤, 이만큼 조용하면 "끝났다"로 보고 자동 정지 → 바로 전사. */
export const SILENCE_AFTER_SPEECH_MS = 2_500;
/**
 * 시작하고 이 시간까지 말이 한 번도 안 잡히면 자동 취소(전사에 보내지 않는다).
 * 마이크를 누르고 무슨 말을 할지 정리하는 시간이 있으므로 넉넉히 — 말이 시작되면 이 타이머는
 * 무의미해지니(그 뒤엔 SILENCE_AFTER_SPEECH_MS 가 담당) 길게 잡아도 손해가 없다.
 */
export const NO_SPEECH_TIMEOUT_MS = 10_000;
/** 레벨 측정 주기. 무음 판정 해상도 = 이 값. */
export const LEVEL_POLL_MS = 100;

// ── 발화/비발화 판정 ─────────────────────────────────────────
// 고정 임계값 하나로는 안 된다 — 자동 이득(AGC)이 조용할 때 배경 소음을 끌어올려서 시끄러운
// 매장에선 무음 구간도 임계값을 넘어버린다(→ 영영 안 멈춤). 배경 소음 바닥을 계속 추적하고
// "바닥 대비 몇 배"로 판정한다. 바닥은 내려갈 땐 즉시, 올라갈 땐 천천히(FLOOR_RISE) 따라가
// 순간적인 말소리를 바닥으로 착각하지 않는다.
//
// ⚠️ 단위 주의: 웹(AnalyserNode)은 0~1 선형 RMS 를 주고, 네이티브(expo-audio metering)는
// 단위가 문서화되어 있지 않다(dBFS 로 관측됨). 그래서 절대 하한(SPEECH_MIN_LEVEL)은 웹 전용이고,
// 플랫폼 공통 규칙은 "바닥 대비 배수" 쪽이다. 네이티브 구현은 dB → 선형으로 바꿔 같은 규칙을 태운다.
export const SPEECH_MIN_LEVEL = 0.012;  // 선형 RMS 기준 절대 하한(조용한 방)
export const SPEECH_OVER_FLOOR = 2.5;   // 배경 소음 대비 이 배수 이상이어야 '말'
export const FLOOR_RISE = 1.02;         // 바닥은 천천히 오른다(소음 증가 추종)

/** 자동 종료 사유 — 호출부가 "전사할 것 / 버릴 것"을 구분한다. */
export type AutoStopReason = 'silence' | 'max_length' | 'no_speech';

export type RecordingResult = {
  /** 오디오 base64(헤더 포함 파일 전체). */
  base64: string;
  /** 엣지가 허용하는 형식만. 웹·iOS=WAV, Android=AAC(ADTS). */
  mimeType: 'audio/wav' | 'audio/aac';
  durationMs: number;
};

/** 호출부가 사용자에게 그대로 보여줄 수 있는 실패 사유. */
export type VoiceErrorKind =
  | 'unsupported'      // 이 환경에서 녹음 불가
  | 'permission'       // 마이크 권한 거부
  | 'too_short'        // 너무 짧게 눌렀다 뗌
  | 'no_audio'         // 캡처된 오디오가 없음
  | 'not_ready'        // 네이티브 레코더가 아직 바인딩되지 않음
  | 'failed';          // 그 외

export class VoiceError extends Error {
  kind: VoiceErrorKind;
  constructor(kind: VoiceErrorKind, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

/**
 * 말/비말 판정기. 웹·네이티브가 각자 측정한 "선형 레벨(0~1)"을 먹여 같은 규칙으로 판정한다.
 * 이 클래스가 자동 종료 규칙의 단일 진실원천 — 플랫폼 구현은 레벨을 재서 넣기만 한다.
 */
export class SpeechGate {
  private floor = Infinity;
  private sawSpeech = false;
  private lastLoudAt: number;
  constructor(private startedAt: number) {
    this.lastLoudAt = startedAt;
  }
  /** 레벨 한 프레임 투입 → 자동 종료해야 하면 사유를, 아니면 null 을 돌려준다. */
  push(level: number, now: number): AutoStopReason | null {
    this.floor = level < this.floor ? level : Math.min(this.floor * FLOOR_RISE, level);
    const threshold = Math.max(SPEECH_MIN_LEVEL, this.floor * SPEECH_OVER_FLOOR);
    if (level > threshold) {
      this.sawSpeech = true;
      this.lastLoudAt = now;
      return null;
    }
    // 말이 한 번도 없었다 → 잘못 눌렀거나 마이크가 안 잡히는 것. 전사에 보내지 않고 끝낸다.
    if (!this.sawSpeech && now - this.startedAt > NO_SPEECH_TIMEOUT_MS) return 'no_speech';
    // 말하다가 조용해졌다 → 끝난 것으로 보고 바로 전사(버튼을 다시 안 눌러도 된다).
    if (this.sawSpeech && now - this.lastLoudAt > SILENCE_AFTER_SPEECH_MS) return 'silence';
    return null;
  }
}

/** 녹음 어댑터가 지켜야 할 계약. 웹·네이티브 구현이 이 형태를 만족해야 한다. */
export type VoiceRecorderModule = {
  supportsVoice: () => boolean;
  startRecording: (onAutoStop?: (reason: AutoStopReason) => void) => Promise<void>;
  stopRecording: () => Promise<RecordingResult>;
  cancelRecording: () => Promise<void>;
  isRecording: () => boolean;
};
