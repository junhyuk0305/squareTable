import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ToastAndroid } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';

import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { getCategoryMeta } from '@/lib/utils/category';
import { confirmAction } from '@/lib/utils/confirm';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { buildPlaybookEntry, isAnswersPublishable, type WizardAnswers } from '@/lib/utils/buildEntry';

import { RoutineFlow } from '@/components/wizard/RoutineFlow';
import { EventFlow } from '@/components/wizard/EventFlow';
import { ContextFlow } from '@/components/wizard/ContextFlow';
import { KnowhowFlow } from '@/components/wizard/KnowhowFlow';
import { VoiceAnswerSheet } from '@/components/VoiceAnswerSheet';

import type { Category } from '@/types';

/** "N시간 전" 포맷. 데모용 — 1시간 미만이면 "방금 전", 24시간 이상이면 "어제/N일 전" */
function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMin = Math.max(0, Math.floor((now - then) / 60000));
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const hours = Math.floor(diffMin / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '어제';
    return `${days}일 전`;
  } catch {
    return '방금 전';
  }
}

function showToast(msg: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  }
  // iOS/web은 화면에 띄우는 컴포넌트로 처리 (아래 ToastView)
}

export default function AnswerWizardScreen() {
  const { uqId } = useLocalSearchParams<{ uqId: string }>();
  const router = useRouter();

  const navigation = useNavigation();
  const uq = useUnknownQueueStore((s) => (uqId ? s.getById(uqId) : undefined));
  const resolve = useUnknownQueueStore((s) => s.resolve);
  const addEntry = usePlaybookStore((s) => s.add);
  const allowLeave = useRef(false); // 발행/확인된 이탈은 확인창 생략

  // 진행률 (flow 내부 step을 받아오기 위한 callback)
  const [progress, setProgress] = useState<{ step: number; total: number }>({ step: 1, total: 4 });
  const [toast, setToast] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false); // 음성 1터치 답변 시트
  const submittedRef = useRef(false); // 더블탭/중복 완료 → 엔트리 중복 생성 방지

  const onStepChange = useCallback((step: number, total: number) => {
    setProgress({ step, total });
  }, []);

  // 모든 훅은 early return 이전에 호출. uq가 없으면 빈 문자열.
  const relTime = useMemo(() => (uq ? formatRelative(uq.asked_at) : ''), [uq?.asked_at]);

  // toast 자동 사라짐
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // 작성 중(2단계 이상 진입) 답변이 있으면 뒤로가기 시 확인 — 입력 소실 방지.
  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (progress.step <= 1 || submittedRef.current || allowLeave.current) return;
      e.preventDefault();
      confirmAction('나가기', '작성 중인 답변이 있어요. 저장 없이 나갈까요?', '나가기').then((ok) => {
        if (ok) {
          allowLeave.current = true;
          navigation.dispatch(e.data.action);
        }
      });
    });
    return unsub;
  }, [navigation, progress.step]);

  // 발행 공통 경로 — 위저드 완료/음성 답변이 모두 거친다.
  // answers를 buildPlaybookEntry로 정규화 → 노하우 발행 + resolve + 토스트 + 복귀.
  const publishAnswers = useCallback(
    (answers: WizardAnswers) => {
      if (!uq || submittedRef.current) return;
      // 품질 게이트 — 내용이 비면 발행하지 않고 보완을 요구한다.
      if (!isAnswersPublishable(uq, answers)) {
        const m = '답변 내용이 비어 있어요 — 할 일이나 멘트를 한 가지라도 채워주세요';
        showToast(m);
        setToast(m);
        return;
      }
      submittedRef.current = true;
      const entry = buildPlaybookEntry(uq, answers);
      addEntry(entry);
      resolve(uq.id, entry.id);

      const msg = '사장님 답변이 알바 챗봇에 반영됐어요';
      showToast(msg);
      setToast(msg);

      // 짧은 토스트 노출 후 인박스로 복귀
      setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/owner/inbox');
        }
      }, 1200);
    },
    [uq, addEntry, resolve, router],
  );

  const onComplete = publishAnswers;

  // 음성 1터치 답변 — 발화 한 줄을 '할 행동' step으로 정규화해 같은 발행 경로를 탄다.
  const onVoiceSubmit = useCallback(
    (answerText: string) => {
      publishAnswers({ actions: [answerText.trim()] });
    },
    [publishAnswers],
  );

  // UQ 없음 / 이미 처리됨
  if (!uq) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyTitle}>이미 처리된 질문입니다</Text>
          <Text style={styles.emptyHint}>
            해당 질문은 다른 답변으로 해결되었거나 삭제되었어요.
          </Text>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/owner/inbox');
            }}
            style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.emptyBtnText}>인박스로 돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const meta = getCategoryMeta(uq.presumed_category);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* 카테고리 컬러 strip */}
      <View style={[styles.strip, { backgroundColor: meta.color }]} />

      {/* 헤더 */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.catEmoji}>{meta.emoji}</Text>
          <Text style={[styles.catLabel, { color: meta.color }]}>{meta.label}</Text>
        </View>

        {/* 진행률 점 */}
        <View style={styles.dots}>
          {Array.from({ length: progress.total }).map((_, i) => {
            const active = i < progress.step;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: active ? meta.color : InkColors.line,
                    width: active ? 22 : 8,
                  },
                ]}
              />
            );
          })}
          <Text style={styles.dotText}>
            {progress.step}/{progress.total}
          </Text>
        </View>

        {/* 알바 질문 인용 */}
        <Text style={styles.quote}>“{uq.query_text}”</Text>
        <Text style={styles.askedBy}>
          {uq.junior_name} 알바가 {relTime}에 물어봤어요
        </Text>

        {/* 음성 1터치 빠른 답변 진입 — 위저드 대신 말로 한 줄 답하고 바로 발행 */}
        <Pressable
          onPress={() => setVoiceOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="음성으로 빠르게 답하기"
          style={({ pressed }) => [styles.voiceCta, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="mic-outline" size={16} color={InkColors.ink} />
          <Text style={styles.voiceCtaText}>음성으로 빠르게 답하기</Text>
        </Pressable>
      </View>

      {/* 본문: 카테고리별 Flow 분기 */}
      <View style={styles.flowWrap}>
        <FlowSwitch
          category={uq.presumed_category}
          uq={uq}
          onComplete={onComplete}
          onStepChange={onStepChange}
        />
      </View>

      {/* 음성 1터치 답변 시트 (프레임캡은 시트 내부에서 처리) */}
      <VoiceAnswerSheet
        visible={voiceOpen}
        uq={uq}
        onClose={() => setVoiceOpen(false)}
        onSubmit={onVoiceSubmit}
      />

      {/* Toast (iOS/web 호환) */}
      {toast && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={styles.toast}>
            <Text style={styles.toastEmoji}>✓</Text>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function FlowSwitch({
  category,
  uq,
  onComplete,
  onStepChange,
}: {
  category: Category;
  uq: Parameters<typeof buildPlaybookEntry>[0];
  onComplete: (a: WizardAnswers) => void;
  onStepChange: (step: number, total: number) => void;
}) {
  switch (category) {
    case 'Routine':
      return <RoutineFlow uq={uq} onComplete={onComplete} onStepChange={onStepChange} />;
    case 'Event':
      return <EventFlow uq={uq} onComplete={onComplete} onStepChange={onStepChange} />;
    case 'Context':
      return <ContextFlow uq={uq} onComplete={onComplete} onStepChange={onStepChange} />;
    case 'Know-how':
      return <KnowhowFlow uq={uq} onComplete={onComplete} onStepChange={onStepChange} />;
    default:
      return <RoutineFlow uq={uq} onComplete={onComplete} onStepChange={onStepChange} />;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  strip: { height: 6, width: '100%' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catEmoji: { fontSize: 22 },
  catLabel: { fontSize: 22, fontWeight: '800' },

  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotText: { marginLeft: 6, fontSize: 11, fontWeight: '700', color: InkColors.ink3 },

  quote: {
    fontSize: 18,
    fontStyle: 'italic',
    color: InkColors.ink,
    fontWeight: '600',
    lineHeight: 26,
    marginTop: 4,
  },
  askedBy: { fontSize: 12, color: InkColors.ink3 },

  voiceCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: BrandColors.yellowSoft,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
  },
  voiceCtaText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  flowWrap: { flex: 1, backgroundColor: '#FFFFFF' },

  // empty
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  emptyHint: { fontSize: 14, color: InkColors.ink3, textAlign: 'center', maxWidth: 280 },
  emptyBtn: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    backgroundColor: InkColors.ink,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },

  // toast
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: InkColors.ink,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    maxWidth: '90%',
  },
  toastEmoji: {
    color: BrandColors.good,
    fontWeight: '800',
    fontSize: 16,
  },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
