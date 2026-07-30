import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { OwnerCoachChat } from '@/components/OwnerCoachChat';
import { PublishConfirmSheet } from '@/components/owner/PublishConfirmSheet';
import { PublishCrossStoreNudge } from '@/components/owner/PublishCrossStoreNudge';
import { Appear } from '@/components/Appear';
import { EmptyState } from '@/components/EmptyState';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { buildDirectUq } from '@/lib/utils/buildEntry';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

import type { Category, PlaybookEntry } from '@/types';

const VALID: Category[] = ['Routine', 'Event', 'Context', 'Know-how'];

/**
 * owner/coach — 대화형 노하우 입력 단일 화면.
 *  · ?uqId=…      → 인박스 답변 모드(알바 질문 컨텍스트, 발행 시 resolve)
 *  · ?category=…  → 직접 등록(콜드스타트)에서 카테고리 프리셋
 *  · ?seed=…      → 입력 프리필
 * 기존 capture/add/answer 위저드를 모두 대체한다.
 */
export default function OwnerCoachScreen() {
  const router = useRouter();
  const { uqId, category: catParam, seed, sugId, feedId, srcTemplate } = useLocalSearchParams<{ uqId?: string; category?: string; seed?: string; sugId?: string; feedId?: string; srcTemplate?: string }>();

  const addEntry = usePlaybookStore((s) => s.add);
  const resolve = useUnknownQueueStore((s) => s.resolve);
  // 채팅 메시지 승격(§4.1)에서 넘어온 경우: 발행 성공 시 원본 메시지에 흔적을 남겨 재승격 넛지를 끈다.
  const markPromoted = useWorkStore((s) => s.markPromoted);
  // 완료 캡처(②) 제안이면: 발행·승인 후 그 출처 업무에 결과 노하우를 자동 첨부(0069/0070).
  const attachKnowhow = useWorkStore((s) => s.attachKnowhow);
  // 알바 제안(신규)에서 넘어온 경우: 실제로 발행됐을 때만 그 제안을 '반영(승인)'한다.
  const approveSuggestion = useSuggestionStore((s) => s.approve);
  // 제안 검토 모드(신규 제안 승인) — 제안자 이름을 말풍선 메타로. 인박스 답변(③ uqId 동반)은 질문 컨텍스트 우선.
  const reviewSug = useSuggestionStore((s) => (sugId ? s.suggestions.find((x) => x.id === sugId) : undefined));
  const realUq = useUnknownQueueStore((s) => (uqId ? s.getById(uqId) : undefined));
  // uqId 진입(인박스 답변·③ 제안→질문 자동해결)인데 큐가 아직 로드 안 됐으면 여기서 당긴다
  // — 제안 화면에서 바로 넘어오면 인박스를 안 거쳐 realUq 가 비어 "이미 처리됨" 데드엔드가 뜰 수 있다.
  useEffect(() => {
    if (uqId) void useUnknownQueueStore.getState().hydrate();
  }, [uqId]);

  const isInboxAnswer = typeof uqId === 'string' && uqId.length > 0;
  // 답변 가능 = 인박스 모드 + 질문이 여전히 '대기' 상태. (이미 해결/보관됐으면 답변 막아 중복 resolve 방지)
  const answerable = isInboxAnswer && !!realUq && realUq.status === 'pending_owner_answer';

  const [toast, setToast] = useState<string | null>(null);
  const [toastErr, setToastErr] = useState(false); // 실패 토스트(성공과 시각 구분·네비 안 함)

  // 발행 넛지(S3 #1): 사장이 매장 2개 이상이면 발행 직후 "다른 내 매장에도?"를 제안. 대상=내 소유 다른 매장.
  const stores = useSessionStore((s) => s.stores);
  const activeUnit = useSessionStore((s) => s.unitId);
  const nudgeTargets = useMemo(
    () => stores.filter((st) => st.role === 'owner' && st.unit_id !== activeUnit).map((st) => ({ unit_id: st.unit_id, store_name: st.store_name })),
    [stores, activeUnit],
  );
  const [nudgeIds, setNudgeIds] = useState<string[] | null>(null); // 발행된 entryIds(넛지 대상). null=넛지 없음.

  // 직접 등록용 합성 uq (capture/add와 동일 패턴). 인박스 모드면 실제 uq 사용.
  const initialCategory: string = useMemo(() => {
    if (isInboxAnswer && realUq) return realUq.presumed_category;
    return (VALID.includes(catParam as Category) ? (catParam as Category) : 'Routine');
  }, [isInboxAnswer, realUq, catParam]);

  const rid = useId();
  // 직접 등록용 합성 uq — 스캐폴드는 buildDirectUq(SSOT). 인수인계서 화면과 공유해 드리프트 방지.
  const syntheticUq = useMemo(
    () => buildDirectUq(initialCategory, typeof seed === 'string' ? seed : '', `direct_${rid}`),
    [seed, initialCategory, rid],
  );

  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 발행 직후 resolve가 answerable을 false로 뒤집어도, 데드엔드 빈 화면으로 가지 않고
  // 성공 토스트를 보여준 뒤 네비게이션하도록 표시(인박스 답변 토스트 유실 방지).
  const [justPublished, setJustPublished] = useState(false);

  const navAfter = useCallback(() => {
    // 발행 후 도착지를 진입 경로와 무관하게 고정 — 인박스 답변은 인박스로,
    // 직접 등록은 '쌓였다'는 피드백 루프를 닫기 위해 노하우 보관함으로 보낸다.
    navTimer.current = setTimeout(() => {
      router.replace(isInboxAnswer ? '/owner/inbox' : '/owner/knowledge');
    }, 1100);
  }, [router, isInboxAnswer]);

  // 발행 후처리 공통 — 노하우 저장이 서버에 실제로 반영된 뒤에만 성공 토스트+네비.
  // (예전엔 DB 실패와 무관하게 항상 "반영됐어요"를 띄우고 이탈해, 질문이 pending으로 남아
  //  알바 챗봇 학습 루프가 조용히 끊겼다 — 리포트 P1-7.)
  // 저장이 서버에 실제 반영된 뒤에만 성공 토스트+네비. 성공 여부(boolean)를 반환해
  // 호출 컴포넌트(OwnerCoachChat)가 실패 시 발행 잠금(publishedRef)을 풀어 재시도를 허용한다.
  const finishPublish = useCallback(
    async (entryIds: string[], addOk: boolean, okMsg: string): Promise<boolean> => {
      if (!addOk) {
        setToastErr(true);
        setToast('저장에 실패했어요. 연결을 확인하고 다시 시도해 주세요.');
        return false;
      }
      // 저장은 성공 — 이제 인박스 질문 상태(resolve)까지 확인. justPublished 로 데드엔드 가드 우회.
      setJustPublished(true);
      let resolveOk = true;
      if (answerable && realUq) resolveOk = await resolve(realUq.id, entryIds[0]);
      if (sugId) approveSuggestion(sugId, entryIds[0]);
      // 완료 캡처(②) 출처 업무가 있으면 그 업무에 자동 첨부 — 업무→노하우 루프를 닫는다(발행 성공 시에만).
      if (srcTemplate) void attachKnowhow(srcTemplate, [entryIds[0]]);
      // 채팅 승격이면 원본 메시지에 흔적(promotedEntryId) → 칩/시트가 다시 안 뜬다(발행 성공한 경우만).
      if (feedId) markPromoted(feedId, entryIds[0]);
      if (!resolveOk) {
        setToastErr(true);
        setToast('노하우는 저장됐어요. 다만 질문 반영에 실패했어요 — 받은 질문에서 다시 시도해 주세요.');
        return false;
      }
      setToastErr(false);
      setToast(okMsg);
      // 매장 2개 이상이면 "다른 매장에도?" 넛지를 띄우고 네비는 넛지 닫힘까지 미룬다. 아니면 바로 이동.
      if (nudgeTargets.length > 0 && entryIds.length > 0) setNudgeIds(entryIds);
      else navAfter();
      return true;
    },
    [answerable, realUq, resolve, sugId, approveSuggestion, srcTemplate, attachKnowhow, feedId, markPromoted, navAfter, nudgeTargets],
  );

  // ── 저장 전 확인(겹침·챕터) ──
  // 노하우가 창고에 들어가는 길목이 여기 하나뿐이라, 문지기도 여기 하나만 둔다.
  // 시트는 Promise로 답을 돌려준다: null=취소(발행 잠금 해제 → 재시도 가능), {section}=진행.
  const [pending, setPending] = useState<{
    entries: PlaybookEntry[];
    resolve: (r: { section: string | null } | null) => void;
  } | null>(null);

  const askBeforePublish = useCallback(
    (entries: PlaybookEntry[]) =>
      new Promise<{ section: string | null } | null>((resolve) => setPending({ entries, resolve })),
    [],
  );

  // 시트가 닫히는 세 경로(취소·저장·기존 수정)가 전부 여기를 지나 pending을 비운다 —
  // resolve를 빠뜨리면 발행 잠금이 걸린 채 영영 안 풀린다(사장이 저장을 못 하게 됨).
  const settle = useCallback(
    (r: { section: string | null } | null) => {
      pending?.resolve(r);
      setPending(null);
    },
    [pending],
  );

  const onPublished = useCallback(
    async (entry: PlaybookEntry): Promise<boolean> => {
      const decision = await askBeforePublish([entry]);
      if (!decision) return false; // 취소 — 저장 안 함(잠금 해제되어 다시 시도 가능)
      const ok = await addEntry({ ...entry, section: decision.section });
      return finishPublish([entry.id], ok, isInboxAnswer ? '답변이 직원 챗봇에 반영됐어요' : '새 노하우가 저장됐어요');
    },
    [addEntry, finishPublish, isInboxAnswer, askBeforePublish],
  );

  // 다중 분리 발행 — 각 노하우를 저장. 엔트리별 성공여부(boolean[])를 반환해 호출부(publishEach)가
  // 성공분만 잠그고 재시도가 성공분을 중복 저장하지 않게 한다(F4, handover save()와 동일 방식).
  const onPublishedMany = useCallback(
    async (entries: PlaybookEntry[]): Promise<boolean[]> => {
      if (entries.length === 0) return [];
      // 분리 발행은 한 대화에서 나온 묶음이라 챕터를 한 번만 묻고 전부에 같이 적용한다.
      const decision = await askBeforePublish(entries);
      // 취소는 실패가 아니다 — 실패 토스트 없이 조용히 잠금만 풀어 다시 시도할 수 있게 둔다.
      if (!decision) return entries.map(() => false);
      const results = await Promise.all(entries.map((e) => addEntry({ ...e, section: decision.section })));
      const okCount = results.filter(Boolean).length;
      if (results.every(Boolean)) {
        // 전체 성공 — 성공 토스트 + (인박스면) resolve + 네비.
        await finishPublish(entries.map((e) => e.id), true, `${entries.length}개의 노하우가 저장됐어요`);
      } else if (okCount > 0) {
        // 부분 성공 — 성공분은 저장됨(재시도가 중복 안 하도록 publishEach가 제외). 남은 실패분만 안내(네비 안 함).
        setJustPublished(true);
        setToastErr(false);
        setToast(`${okCount}개는 저장됐어요. 남은 항목만 다시 시도해 주세요.`);
      } else {
        await finishPublish([], false, ''); // 전부 실패 — 실패 토스트.
      }
      return results;
    },
    [addEntry, finishPublish, askBeforePublish],
  );

  // 인박스 모드인데 질문이 이미 처리/삭제/보관됨 → 빈 상태(데드엔드·중복 답변 방지).
  // 단, 방금 내가 발행해서 resolve된 경우는 제외(토스트 노출 후 정상 네비게이션).
  if (isInboxAnswer && !answerable && !justPublished) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ title: '질문 답변' }} />
        <EmptyState
          emoji="📭"
          title="이미 처리된 질문이에요"
          body="다른 답변으로 해결되었거나 보관됐어요."
          cta={{
            label: '받은 질문으로 돌아가기',
            onPress: () => (router.canGoBack() ? router.back() : router.replace('/owner/inbox')),
          }}
        />
      </SafeAreaView>
    );
  }

  const uq = isInboxAnswer && realUq ? realUq : syntheticUq;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: isInboxAnswer ? '질문 답변' : sugId ? '제안 검토' : '노하우 추가' }} />

      <OwnerCoachChat
        uq={uq}
        isInboxAnswer={isInboxAnswer}
        initialCategory={initialCategory}
        seedText={typeof seed === 'string' ? seed : undefined}
        reviewProposal={!isInboxAnswer && sugId ? { name: reviewSug?.proposer_name ?? '직원' } : undefined}
        onPublished={onPublished}
        onPublishedMany={onPublishedMany}
      />

      <PublishConfirmSheet
        visible={!!pending}
        entries={pending?.entries ?? []}
        onCancel={() => settle(null)}
        onConfirm={(section) => settle({ section })}
        onEditExisting={(entryId) => {
          settle(null); // 저장은 접고 기존 노하우 수정으로 — 중복이 안 생긴다.
          router.push(`/owner/edit/${entryId}`);
        }}
      />

      {nudgeIds && (
        <PublishCrossStoreNudge
          entryIds={nudgeIds}
          targets={nudgeTargets}
          onClose={() => { setNudgeIds(null); navAfter(); }}
        />
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Appear offsetY={20} duration={240}>
            <View style={styles.toast}>
              <Text style={[styles.toastCheck, toastErr && styles.toastCheckErr]}>{toastErr ? '!' : '✓'}</Text>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          </Appear>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: InkColors.cream },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 18, borderRadius: Radius.md, maxWidth: '90%',
  },
  toastCheck: { color: BrandColors.yellow, fontWeight: '800', fontSize: 16 },
  toastCheckErr: { color: BrandColors.accent },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});
