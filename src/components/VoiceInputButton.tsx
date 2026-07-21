import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { transcribeAudio } from '@/lib/ai';
// 플랫폼 구현은 Metro 가 고른다(웹=recorder.web.ts / 네이티브=recorder.ts). 여기선 구분하지 않는다.
import {
  supportsVoice,
  startRecording,
  stopRecording,
  cancelRecording,
  isRecording,
} from '@/lib/voice/recorder';
import { VoiceError, MAX_RECORD_MS } from '@/lib/voice/shared';
import { showToast } from '@/lib/store/useToastStore';
import { track, reportError } from '@/lib/analytics/track';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/* ───────────────────────────────────────────────────────────
 * 음성 입력(받아쓰기) 버튼 — 마이크 탭 → 녹음 → 다시 탭 → 텍스트가 입력창에 채워진다.
 *
 * 시장 표준(ChatGPT 앱·iOS 키보드 받아쓰기)과 동일한 '토글식 받아쓰기'.
 *  · 카톡식 홀드-투-토크(음성 파일 전송)가 아니다 — 우리는 텍스트가 결과물이다.
 *  · 자동 전송하지 않는다. 오인식은 사용자가 보내기 전에 고칠 수 있어야 한다.
 *  · 실패 시 mock 문장으로 채우지 않는다(=자기가 말한 줄 알고 그대로 보내는 무음 오염).
 *
 * 지원 안 되는 환경(네이티브 앱 등)에서는 null 을 렌더 — '눌렀는데 아무 일 없음'을 만들지 않는다.
 * ─────────────────────────────────────────────────────────── */

export type VoiceInputButtonProps = {
  /** 전사 결과. 부모가 기존 입력값 뒤에 이어붙인다(덮어쓰기 금지). */
  onText: (text: string) => void;
  disabled?: boolean;
  /** 매장 고유명사(메뉴·직원 이름 등) — 발음이 비슷할 때 이 표기를 우선하게 하는 힌트. */
  hints?: string[];
  /** 계측용 화면 이름(coach · work_chat …). */
  surface: string;
};

type Phase = 'idle' | 'recording' | 'transcribing';

const ERROR_MESSAGE: Record<string, string> = {
  permission: '마이크 사용을 허용해 주세요. 주소창의 자물쇠 아이콘에서 바꿀 수 있어요.',
  too_short: '너무 짧아요. 버튼을 누른 뒤 또박또박 말씀해 주세요.',
  no_audio: '소리가 녹음되지 않았어요. 마이크를 확인해 주세요.',
  unsupported: '이 브라우저에서는 음성 입력을 쓸 수 없어요.',
  not_ready: '음성 입력을 준비 중이에요. 잠시 후 다시 눌러 주세요.',
  failed: '음성 입력에 실패했어요. 잠시 후 다시 시도해 주세요.',
};

// 엣지가 돌려준 거절 사유별 안내. 'failed'(네트워크·서버 오류)는 ERROR_MESSAGE 로 떨어진다.
const EDGE_REJECT_MESSAGE: Record<string, string> = {
  mock_mode: '데모 모드에서는 음성 입력이 동작하지 않아요.',
  unsupported_audio: '이 기기의 녹음 형식을 지원하지 않아요. 타이핑으로 입력해 주세요.',
  audio_too_large: '녹음이 너무 길어요. 짧게 나눠서 말씀해 주세요.',
  audio_not_accepted: '이 기기의 녹음을 처리하지 못했어요. 타이핑으로 입력해 주세요.',
};

function mmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function VoiceInputButton({ onText, disabled, hints, surface }: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  // 언마운트 후 setState 방지 + 마이크 잔존 방지(화면을 닫아도 트랙은 반드시 놓는다).
  const aliveRef = useRef(true);
  // 녹음 시작 시각 — 렌더에 쓰지 않고 타이머만 읽는다(이벤트 핸들러에서 세팅).
  const startedAtRef = useRef(0);
  // 전사 진입 중복 방지 잠금(자동 정지 ↔ 사용자 정지 레이스).
  const finishingRef = useRef(false);

  // supportsVoice()는 환경 판정이라 렌더마다 바뀌지 않는다.
  const [enabled] = useState(() => supportsVoice());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // 진행 중인 세션이 있으면 반드시 놓는다 — 화면을 닫았는데 탭에 마이크 표시가 남으면 신뢰가 깨진다.
      // 컴포넌트 상태가 아니라 recorder 모듈의 실제 상태를 본다(외부 시스템이 진실).
      if (isRecording()) void cancelRecording();
    };
  }, []);

  // 녹음 중 경과 타이머. 사용자가 60초 캡에 걸리기 전에 스스로 끊을 수 있게 항상 보인다.
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  const fail = useCallback((kind: string, e?: unknown) => {
    showToast(ERROR_MESSAGE[kind] ?? ERROR_MESSAGE.failed, 'warn');
    track('voice_input', { surface, result: 'error', reason: kind });
    if (e && kind === 'failed') reportError('voice.input.failed', e, { surface });
  }, [surface]);

  const finish = useCallback(async () => {
    // 자동 정지(60초)와 사용자의 정지 탭이 겹치면 두 번 들어올 수 있다 → 한 번만.
    // setPhase는 비동기라 상태로는 못 막는다(ref가 진짜 잠금).
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPhase('transcribing');
    try {
      const rec = await stopRecording();
      const out = await transcribeAudio({
        audioBase64: rec.base64,
        mimeType: rec.mimeType,
        durationMs: rec.durationMs,
        ...(hints && hints.length > 0 ? { hints } : {}),
      });
      if (!aliveRef.current) return;
      // 엣지가 명시적으로 거절한 경우(포맷·크기·데모모드)는 "안 들렸어요"로 뭉뚱그리지 않는다 —
      // 사용자가 더 크게 말해봐야 해결되지 않는 문제라 안내가 틀리면 계속 헛시도하게 된다.
      if (out.error) {
        showToast(EDGE_REJECT_MESSAGE[out.error] ?? ERROR_MESSAGE.failed, 'warn');
        track('voice_input', { surface, result: 'error', reason: out.error });
        return;
      }
      if (out.empty || !out.text) {
        showToast('말소리가 잘 안 들렸어요. 다시 한 번 말씀해 주세요.', 'warn');
        track('voice_input', { surface, result: 'empty', duration_ms: rec.durationMs });
        return;
      }
      onText(out.text);
      track('voice_input', { surface, result: 'ok', duration_ms: rec.durationMs, chars: out.text.length });
    } catch (e) {
      if (!aliveRef.current) return;
      fail(e instanceof VoiceError ? e.kind : 'failed', e);
    } finally {
      finishingRef.current = false;
      if (aliveRef.current) setPhase('idle');
    }
  }, [hints, onText, surface, fail]);

  // 취소 — 사용자가 ✕ 를 눌렀거나(reason 없음), 말이 한 번도 안 잡혀 자동으로 접었을 때.
  const abort = useCallback(async (reason?: 'no_speech') => {
    await cancelRecording();
    if (aliveRef.current) setPhase('idle');
    if (reason === 'no_speech') showToast('말소리가 안 들려서 멈췄어요. 마이크를 확인하고 다시 눌러 주세요.', 'warn');
    track('voice_input', { surface, result: reason ?? 'cancelled' });
  }, [surface]);

  const begin = useCallback(async () => {
    try {
      // 자동 종료 — 사장님은 말을 끝내고 버튼을 다시 누르는 걸 잊는다. 그때 60초를 꽉 채워
      // 녹음되면 침묵까지 업로드돼 느리고 비싸다. 말이 끝나면(무음 2.5초) 알아서 전사한다.
      await startRecording((reason) => {
        if (!aliveRef.current) return;
        if (reason === 'no_speech') {
          // 아무 말도 안 잡혔다 → 서버에 보낼 게 없다. 왕복 없이 여기서 끝낸다.
          void abort('no_speech');
          return;
        }
        void finish();
      });
      if (!aliveRef.current) {
        void cancelRecording();
        return;
      }
      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase('recording');
    } catch (e) {
      fail(e instanceof VoiceError ? e.kind : 'failed', e);
    }
  }, [finish, fail, abort]);

  if (!enabled) return null;

  if (phase === 'transcribing') {
    return (
      <View style={s.btn} accessibilityLabel="음성을 글자로 옮기는 중">
        <ActivityIndicator size="small" color={InkColors.ink3} />
      </View>
    );
  }

  if (phase === 'recording') {
    const near = elapsed > MAX_RECORD_MS - 10_000; // 남은 10초부터 경고색
    // ✕(취소)와 정지 알약은 형제 Pressable — 중첩 button 금지(RNW에서 웹 <button> 중첩 위반).
    return (
      <View style={s.recRow}>
        <Pressable
          onPress={() => void abort()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="녹음 취소"
          style={({ pressed }) => [s.cancelBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={18} color={InkColors.ink2} />
        </Pressable>
        <Pressable
          onPress={() => void finish()}
          accessibilityRole="button"
          accessibilityLabel="녹음 마치고 글자로 옮기기 — 말이 끝나면 자동으로도 멈춰요"
          style={({ pressed }) => [s.stopPill, pressed && { opacity: 0.85 }]}
        >
          <View style={[s.dot, near && { backgroundColor: BrandColors.warn }]} />
          <Text style={s.timer}>{mmss(elapsed)}</Text>
          <Ionicons name="stop" size={13} color={InkColors.bubbleText} />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => void begin()}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="음성으로 입력"
      style={({ pressed }) => [s.btn, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name="mic-outline" size={22} color={InkColors.ink2} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  // 사진 첨부 버튼(coachStyles.attachBtn)과 같은 발자국 — 입력바 정렬이 흔들리지 않게.
  btn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  cancelBtn: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  stopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.brand,
  },
  dot: { width: 8, height: 8, borderRadius: Radius.pill, backgroundColor: BrandColors.bad },
  timer: {
    fontSize: 13,
    fontWeight: '700',
    color: InkColors.bubbleText,
    // 고정폭 대신 최소폭 — textScale이 커져도 글자가 잘리지 않는다.
    minWidth: 30,
    textAlign: 'center',
  },
});
