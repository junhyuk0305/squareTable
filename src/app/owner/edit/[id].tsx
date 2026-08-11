import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { OwnerCoachChat } from '@/components/OwnerCoachChat';
import { Appear } from '@/components/Appear';
import { BottomSheet } from '@/components/BottomSheet';
import { EmptyState } from '@/components/EmptyState';
import { VerifyBadge } from '@/components/VerifyBadge';
import { formatRelative } from '@/components/coach/coachUtils';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useWorkStore, understandingOf } from '@/lib/store/useWorkStore';
import { useQuizBoard } from '@/lib/quiz/useQuizBoard';
import { confirmAction } from '@/lib/utils/confirm';
import { UNSECTIONED, sectionOptions } from '@/lib/config/sections';
import { getSectionMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER, Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock, UnknownQuery } from '@/types';

/**
 * owner/edit/[id] — 대화형 노하우 수정.
 * 기존 6칸 폼을 폐기하고 등록과 동일한 코치챗을 '수정 모드'로 띄운다.
 *  · 기존 노하우 카드를 먼저 보여주고
 *  · 사장이 말로 고치면 patchSquare로 부분 패치(나머지 보존)
 *  · 저장 시 기존 엔트리 update(version+1) → 재색인까지 스토어가 처리.
 */
export default function EditKnowledgeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const loaded = usePlaybookStore((s) => s.loaded);
  const entry = usePlaybookStore((s) => (id ? s.getById(id) : undefined));

  // 스토어 hydrate 전(콜드 진입/새로고침)엔 '삭제됨' 대신 로딩 표시 — 데이터 도착 후 판단.
  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <View style={styles.empty}>
          <ActivityIndicator color={InkColors.ink3} />
        </View>
      </SafeAreaView>
    );
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <EmptyState
          title="이미 삭제된 노하우예요."
          cta={{ label: '돌아가기', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  // key=id로 다른 노하우로 파라미터가 바뀌면 채팅이 새 엔트리로 재마운트된다.
  return <ConversationalEdit key={entry.id} entry={entry} />;
}

function ConversationalEdit({ entry }: { entry: PlaybookEntry }) {
  const router = useRouter();
  const update = usePlaybookStore((s) => s.update);
  const remove = usePlaybookStore((s) => s.remove);
  const entries = usePlaybookStore((s) => s.entries);
  const userName = useSessionStore((s) => s.userName);
  const industry = useSessionStore((s) => s.industry);

  // 카테고리(= section) 변경 — 저장 시 고른 카테고리를 여기서도 바꿀 수 있다(발행 시트와 같은 선택지).
  const customs = usePlaybookStore((s) => s.customCategories);
  const [catOpen, setCatOpen] = useState(false);
  const catMeta = getSectionMeta(entry.section);
  const catOptions = useMemo(
    () => sectionOptions(industry, [...entries.map((e) => e.section), ...customs.map((c) => c.label)]),
    [industry, entries, customs],
  );
  const pickCategory = (name: string | null) => {
    setCatOpen(false);
    if ((entry.section?.trim() || null) === name) return;
    update(entry.id, { section: name });
  };

  const [toast, setToast] = useState<string | null>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rid = useId();

  // 코치챗은 uq 컨텍스트를 요구한다 — 수정 모드에선 발행에 안 쓰이는 합성 uq.
  const syntheticUq = useMemo<UnknownQuery>(
    () => ({
      id: `edit_${rid}`,
      junior_id: '',
      junior_name: '사장님',
      query_text: entry.title,
      asked_at: entry.created_at,
      presumed_category: entry.category,
      presumed_subcategory: entry.subcategory || '일반',
      match_attempted: false,
      best_match_confidence: 0,
      best_match_entry_id: null,
      status: 'pending_owner_answer',
      fallback_action: '',
      owner_notified_at: entry.created_at,
      owner_will_answer: true,
      similar_queries_count: 0,
      ai_general_answer: '',
    }),
    [rid, entry],
  );

  // 대화형 수정 결과 저장 — patch가 다루지 않는 내부 칸(quagmire/uncover/result/do/template)은 보존.
  const onUpdated = useCallback(
    (square: SquareBlock, extras: { title: string; keywords: string[] }) => {
      const mergedSquare: SquareBlock = {
        ...entry.square, // 보존: quagmire·uncover·result·extract.do·template
        situation: square.situation,
        action: square.action,
        extract: { ...entry.square.extract, dont: square.extract.dont },
        ...(square.standard ? { standard: square.standard } : {}),
      };
      update(entry.id, {
        title: extras.title.trim() || entry.title,
        square: mergedSquare,
        search_keywords: extras.keywords.length ? extras.keywords.slice(0, 8) : entry.search_keywords,
        version: entry.version + 1,
        updated_at: new Date().toISOString(),
        // 사장이 직접 다듬어 저장 = 우리 매장 기준 검증 완료. 미검증(업종 표준값) 꼬리표를 뗀다.
        needs_review: false,
        verification: { state: 'owner_verified', verified_by: userName, verified_at: new Date().toISOString() },
      });
      setToast('수정 저장됨 (v' + (entry.version + 1) + ')');
      navTimer.current = setTimeout(() => router.back(), 1000);
    },
    [entry, update, userName, router],
  );

  const del = useCallback(async () => {
    // 되돌릴 수 없는 작업 → 삭제 전 확인(앱 내 빨강 모달).
    if (await confirmAction('노하우 삭제', '이 노하우를 삭제할까요? 되돌릴 수 없어요.', '삭제', { destructive: true, icon: 'trash-outline' })) {
      remove(entry.id);
      router.back();
    }
  }, [entry.id, remove, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '노하우 수정',
          headerRight: () => (
            // 우측 끝 여백은 헤더 표준(HEADER_EDGE_GUTTER) — 좌측 back 화살표와 좌우 대칭.
            <Pressable
              onPress={del}
              hitSlop={10}
              style={({ pressed }) => [{ paddingLeft: Space.sm, paddingRight: HEADER_EDGE_GUTTER, paddingVertical: 4 }, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="노하우 삭제"
            >
              <Ionicons name="trash-outline" size={20} color={BrandColors.warn} />
            </Pressable>
          ),
        }}
      />

      {/* 카테고리 바 — 매뉴얼에서 묶이는 분류를 여기서 바로 바꾼다. */}
      <Pressable
        onPress={() => setCatOpen(true)}
        style={({ pressed }) => [styles.catBar, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`카테고리 ${catMeta.label}, 변경`}
      >
        <Text style={styles.catBarLabel}>카테고리</Text>
        <View style={[styles.catDot, { backgroundColor: catMeta.color }]} />
        <Text style={styles.catBarValue}>{catMeta.label}</Text>
        <Ionicons name="chevron-down" size={14} color={InkColors.ink3} />
      </Pressable>

      <OwnerCoachChat
        uq={syntheticUq}
        isInboxAnswer={false}
        initialCategory={entry.category}
        editEntry={entry}
        onUpdated={onUpdated}
        onPublished={() => {}}
        docHeader={<KnowhowDoc entry={entry} />}
      />

      {catOpen && (
        <BottomSheet visible onClose={() => setCatOpen(false)} sheetStyle={styles.catSheet}>
          <Text style={styles.catSheetTitle}>카테고리 변경</Text>
          <Text style={styles.catSheetHint}>매뉴얼에서 묶이는 단위예요</Text>
          <View style={styles.catChips}>
            {catOptions.map((name) => {
              const m = getSectionMeta(name);
              const on = (entry.section?.trim() || UNSECTIONED) === name;
              return (
                <Pressable
                  key={name}
                  onPress={() => pickCategory(name)}
                  style={({ pressed }) => [styles.catChip, on && styles.catChipOn, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`카테고리 ${name}`}
                >
                  <View style={[styles.catDot, { backgroundColor: m.color }]} />
                  <Text style={[styles.catChipText, on && styles.catChipTextOn]}>{name}</Text>
                </Pressable>
              );
            })}
            {/* 미분류(기타)로 되돌리기 */}
            <Pressable
              onPress={() => pickCategory(null)}
              style={({ pressed }) => [
                styles.catChip,
                !entry.section?.trim() && styles.catChipOn,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: !entry.section?.trim() }}
              accessibilityLabel={`카테고리 ${UNSECTIONED}`}
            >
              <View style={[styles.catDot, { backgroundColor: getSectionMeta(null).color }]} />
              <Text style={[styles.catChipText, !entry.section?.trim() && styles.catChipTextOn]}>{UNSECTIONED}</Text>
            </Pressable>
          </View>
        </BottomSheet>
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Appear offsetY={20} duration={240}>
            <View style={styles.toast}>
              <Text style={styles.toastCheck}>✓</Text>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          </Appear>
        </View>
      )}
    </SafeAreaView>
  );
}

/** 진행바 트랙 높이 — 도형 자체 치수라 간격 토큰 대상이 아니다. */
const PROGRESS_TRACK_H = 5;

/**
 * 노하우 문서 머리말 — 상세 화면의 '읽는 면' 중 **제목·진도·메타**만.
 *
 * ★ 진행바는 '읽음'이 아니라 '통과'다(knowhow_understanding). 여기서 집계하지 않는다 —
 *   문항 수는 useQuizBoard, 통과자는 understandingOf 가 SSOT고 이 블록은 배치만 한다.
 * ★ 문항이 0개면 바를 그리지 않는다 — 빈 바는 0%(아무도 못 맞힘)로 읽힌다.
 *
 * ★ 2026-08-08: **본문(상황·할 일·금지)은 여기서 안 그린다.** 아래 코치챗 카드가 유일한 자리다.
 *   옛 구조는 문서와 카드가 같은 본문을 둘 다 그릴 수 있어 "어느 쪽을 접을지" 판정이 필요했고,
 *   그 판정이 어긋나면 본문이 화면 어디에도 안 남았다(08-07 [치명]). 그릴 수 있는 자리를 하나로 줄여
 *   그 버그 종류를 없앴다. 제목만 이쪽이 들고, 카드는 hideTitle 로 양보한다.
 */
function KnowhowDoc({ entry }: { entry: PlaybookEntry }) {
  const router = useRouter();
  const staff = useStaffStore((s) => s.staff);
  const understanding = useWorkStore((s) => s.understanding);
  const { quizCountOf } = useQuizBoard();

  const quizCount = quizCountOf(entry.id);
  const total = staff.length;
  // 분자·분모는 같은 모집단이어야 한다 — 통과 기록엔 퇴사자가 남아 있어서(명부는 RLS로 제외)
  // 교집합을 안 하면 "직원 2명 중 3명이 통과"가 나온다.
  const staffIds = new Set(staff.map((s) => s.id));
  const passed = understandingOf(understanding, entry.id).filter((r) => staffIds.has(r.staffId)).length;
  const pct = total > 0 ? Math.min(100, Math.round((passed / total) * 100)) : 0;

  const verifiedAt = entry.verification?.verified_at;
  const hits = entry.stats?.query_hits_30d ?? 0;
  const hasMeta = !!entry.verification || !!verifiedAt || hits > 0;

  return (
    <View style={styles.doc}>
      <Text style={styles.docTitle}>{entry.title}</Text>

      {quizCount === 0 ? (
        // 누를 수 있는 것은 이 행 하나뿐 — 문서 블록 자체는 누를 수 없다(중첩 버튼 금지).
        <Pressable
          // 2026-08-11: 코스 목록(?status=no_items)이 사라졌다 → 만들기로 바로 보낸다.
          onPress={() => router.push('/owner/quiz-new' as never)}
          style={({ pressed }) => [styles.quizEmpty, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="아직 문제가 없어요, 만들기"
        >
          <Text style={styles.quizEmptyText}>아직 문제가 없어요 ·</Text>
          <Text style={styles.quizEmptyCta}>만들기</Text>
          <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
        </Pressable>
      ) : total > 0 ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressText}>직원 {total}명 중 {passed}명이 퀴즈를 통과했어요</Text>
        </View>
      ) : null}

      {hasMeta ? (
        <View style={styles.metaRow}>
          {/* 색·라벨은 verifyMeta(SSOT)에서 온다 — 여기서 상태색을 직접 쓰지 않는다. */}
          {entry.verification ? <VerifyBadge state={entry.verification.state} /> : null}
          {verifiedAt ? <Text style={styles.metaChip}>{formatRelative(verifiedAt)}</Text> : null}
          {hits > 0 ? <Text style={styles.metaChip}>최근 30일 {hits}번 쓰임</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  // 문서 머리말 + 본문 표(상세의 읽는 면)
  doc: { gap: Space.md },
  docTitle: { fontSize: 17, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.3 },
  progressWrap: { gap: Space.xs },
  progressTrack: {
    height: PROGRESS_TRACK_H, borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.good },
  // 숫자만 있는 배지가 아니라 읽어서 판단하는 문장이라 본문 15sp 하한을 그대로 적용한다.
  progressText: { fontSize: 15, color: InkColors.ink2 },
  quizEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: Space.xs, alignSelf: 'flex-start',
    // 누를 수 있는 행이라 최소 터치 타깃 48.
    minHeight: 48, paddingVertical: Space.sm, paddingHorizontal: Space.md,
    borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft,
  },
  quizEmptyText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  quizEmptyCta: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.xs },
  metaChip: {
    fontSize: 11, fontWeight: '800', color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, overflow: 'hidden',
    paddingVertical: Space.xs, paddingHorizontal: Space.sm,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  // 카테고리 바(헤더 아래) + 변경 시트
  catBar: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    marginHorizontal: Space.gutter, marginTop: Space.sm, marginBottom: Space.xs,
    paddingVertical: Space.sm, paddingHorizontal: Space.md, minHeight: 40,
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, backgroundColor: InkColors.bg,
    alignSelf: 'flex-start',
  },
  catBarLabel: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 },
  catBarValue: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  catDot: { width: 8, height: 8, borderRadius: Radius.pill },
  catSheet: { maxHeight: '70%', paddingBottom: Space.xl },
  catSheetTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: Space.gutter, paddingTop: Space.sm },
  catSheetHint: { fontSize: 12.5, color: InkColors.ink3, paddingHorizontal: Space.gutter, marginTop: 2, marginBottom: Space.md },
  catChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, paddingHorizontal: Space.gutter },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40,
    paddingVertical: Space.sm, paddingHorizontal: Space.md,
    borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft,
  },
  catChipOn: { backgroundColor: BrandColors.yellow },
  catChipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  catChipTextOn: { color: InkColors.ink },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 18, borderRadius: Radius.md, maxWidth: '90%',
  },
  toastCheck: { color: BrandColors.yellow, fontWeight: '800', fontSize: 16 },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
