import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { SectionLabel } from '@/components/SectionLabel';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Heatmap, type HeatCell, type HeatGroup, type HeatLegend } from '@/components/blocks/Heatmap';
import { RollupRows, type RollupRow } from '@/components/blocks/RollupRows';
import { Appear, stagger } from '@/components/Appear';
import { useUnknownQueueStore, answerableQuestions } from '@/lib/store/useUnknownQueueStore';
import { useSuggestionStore } from '@/lib/store/useSuggestionStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useChatStore } from '@/lib/store/useChatStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { getSectionMeta } from '@/lib/utils/category';
import { showToast } from '@/lib/store/useToastStore';
import { searchPlaybook } from '@/lib/rag';
import { useCopyToClipboard, canCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, PlaybookSuggestion, UnknownQuery } from '@/types';

/**
 * 히트맵 범례 — **직원 축**(§7-8 표의 세 번째 열). 색은 "내가 아는가" 하나뿐이고, 사장 축의
 * '다들 틀림'(빨강)은 여기 없다. 없는 축은 범례에도 안 나온다(Heatmap 이 셀을 보고 정한다).
 */
const MY_HEAT_LEGEND: HeatLegend = {
  empty: '아직 안 풀었다',
  scale: ['내가 아는 노하우', '앎'],
  stale: '통과 뒤 바뀜',
  miss: '',
};

/**
 * JuniorMySpace — 노하우 탭 '내 공간'(직원 전용, S1 ③).
 * 히어로 = 내가 아는 노하우 히트맵(H5, 2026-08-27) · ① 도와줄 수 있는 매장 질문(D4: 누가 답하든 됨)
 * → 답하기 시트(기존 노하우 지정=즉시 해결 / 새 답=사장 승인) · '내 기록' 롤업 3행(답한 질문 · 보낸 제안 ·
 * 물어본 것)을 눌러 아래로 펼친다. 전부 자기 목록이고 랭킹이 아니다(D5).
 * 사장 화면엔 세그먼트가 없으므로 직원 전용.
 */
export function JuniorMySpace({ me }: { me: string }) {
  const queue = useUnknownQueueStore((s) => s.queue);
  const resolveUq = useUnknownQueueStore((s) => s.resolve);
  const suggestions = useSuggestionStore((s) => s.suggestions);
  const submitSuggestion = useSuggestionStore((s) => s.submit);
  const history = useChatStore((s) => s.history);
  const entries = usePlaybookStore((s) => s.entries);
  // 이 뷰가 그리는 원격 소스 넷 — 하나라도 안 왔으면 본문을 마운트하지 않는다.
  // ★훅은 각각 먼저 부르고 그 다음에 AND 한다(&& 안에서 훅 호출 = 렌더마다 훅 개수가 달라짐).
  const queueLoaded = useUnknownQueueStore((s) => s.loaded);
  const suggestionsLoaded = useSuggestionStore((s) => s.loaded);
  const historyLoaded = useChatStore((s) => s.loaded);
  const entriesLoaded = usePlaybookStore((s) => s.loaded);
  // ★히트맵의 색 원장(2026-08-27) — 내 퀴즈 통과 기록. 이 화면의 **다섯 번째** 원격 소스가 됐다.
  //   게이트에 안 넣으면 히트맵이 "전부 안 풀었음"(점선 격자)으로 먼저 뜬 뒤 색이 채워진다.
  const understanding = useWorkStore((s) => s.understanding);
  const workLoaded = useWorkStore((s) => s.loaded);
  const userName = useSessionStore((s) => s.userName);
  const storeName = useSessionStore((s) => s.storeName);
  const { copied, copy } = useCopyToClipboard();

  // 제안·내 채팅을 로드·구독한다(미답질문 큐는 컨테이너 junior/chat 가 배지용으로 이미 hydrate·subscribe 중).
  useEffect(() => {
    const sg = useSuggestionStore.getState();
    void sg.hydrate();
    const offSg = sg.subscribe();
    if (me) void useChatStore.getState().hydrate(me);
    // 퀴즈 통과 기록(히트맵 색) — 업무 탭이 이미 채워 뒀으면 coalesce 가 재요청을 삼킨다.
    void useWorkStore.getState().hydrate();
    return offSg;
  }, [me]);

  const [answerFor, setAnswerFor] = useState<UnknownQuery | null>(null);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);
  // 기록 리스트는 첫 노출을 캡(복잡도 원칙: 리스트 첫 노출 5±2)하고 '더 보기'로 아래로 펼친다.
  const [showAllAnswered, setShowAllAnswered] = useState(false);
  const [showAllProposals, setShowAllProposals] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const publishedEntries = useMemo(() => entries.filter((e) => e.status === 'published'), [entries]);

  // 도와줄 수 있는 질문 — 배지와 동일한 SSOT 판정(answerableQuestions).
  // 제안을 함께 넘겨 이미 누가 답을 올린(승인 대기) 질문은 빠지게 한다 — 같은 질문 중복 답변 방지.
  const answerable = useMemo(() => answerableQuestions(queue, me, suggestions), [queue, me, suggestions]);
  // 제안은 상태 변화가 있는 것(검토 중·반려)을 위로 — 등록된 건 기여 배너가 이미 말해준다.
  const myProposals = useMemo(() => {
    const weight = (st: PlaybookSuggestion['status']) => (st === 'pending' ? 0 : st === 'rejected' ? 1 : 2);
    return suggestions
      .filter((s) => s.proposer_id === me)
      .sort((a, b) => weight(a.status) - weight(b.status) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }, [suggestions, me]);
  const myAnswered = useMemo(
    () => queue.filter((u) => u.answered_by === me).sort((a, b) => (b.asked_at ?? '').localeCompare(a.asked_at ?? '')),
    [queue, me],
  );
  const myQuestions = useMemo(
    () => [...history].sort((a, b) => (b.asked_at ?? '').localeCompare(a.asked_at ?? '')),
    [history],
  );

  // ── 히트맵(H5 · §7-8의 **세 번째 축**) — 색 = 내가 아는 노하우.
  //    상자 = 발행 노하우 1개 · 그룹 = 카테고리(section) · 색은 2단계뿐이다(안다 / 아직).
  //    "몇 명이 아는가"는 사장 축이라 여기 없다 — 이 화면은 **본인 것만** 본다(감시원칙 D1~D5).
  //    주황 테두리 = 내가 통과한 **뒤에** 노하우가 바뀐 것. 원장은 updated_at 과 내 verified_at 비교라
  //    지어낸 판정이 아니다(R4). 빨강(다들 틀림)은 사장 지표라 여기서는 아예 안 쓴다 —
  //    쓰지 않는 축은 범례에도 안 나온다(Heatmap 이 셀을 보고 정한다).
  const myPassedAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of understanding) {
      if (u.staffId !== me) continue;
      const prev = m.get(u.entryId);
      if (!prev || (u.verifiedAt ?? '') > prev) m.set(u.entryId, u.verifiedAt ?? '');
    }
    return m;
  }, [understanding, me]);
  const knownCount = useMemo(
    () => publishedEntries.filter((e) => myPassedAt.has(e.id)).length,
    [publishedEntries, myPassedAt],
  );
  const heatGroups: HeatGroup[] = useMemo(() => {
    const by = new Map<string, HeatCell[]>();
    for (const e of publishedEntries) {
      const passedAt = myPassedAt.get(e.id);
      const changed = !!passedAt && !!e.updated_at && e.updated_at > passedAt;
      const name = getSectionMeta(e.section).label;
      const cells = by.get(name) ?? [];
      cells.push({
        id: e.id,
        title: e.title,
        level: passedAt ? 4 : 0,
        status: passedAt ? (changed ? '통과한 뒤 내용이 바뀌었어요' : '퀴즈로 확인함') : '아직 안 풀었어요',
        stale: changed,
      });
      by.set(name, cells);
    }
    // 아직 안 푼 비율이 높은 카테고리부터 — 다음에 볼 곳이 위로 온다.
    const todo = (cells: HeatCell[]) => cells.filter((c) => c.level === 0).length / Math.max(1, cells.length);
    return [...by]
      .map(([name, cells]) => ({ name, cells }))
      .sort((a, b) => todo(b.cells) - todo(a.cells) || a.name.localeCompare(b.name, 'ko'));
  }, [publishedEntries, myPassedAt]);

  // 내 기록 롤업(L5) — 어느 줄을 펼쳤나. 기본은 접힘(펼침은 아래로).
  const [openRecord, setOpenRecord] = useState<'answered' | 'proposals' | 'questions' | null>(null);

  const onResolveWith = async (uqId: string, entryId: string) => {
    setAnswerFor(null);
    const ok = await resolveUq(uqId, entryId);
    if (ok) showToast('답으로 남겼어요 · 다음 사람은 바로 봐요', 'good');
  };
  const onNewAnswer = async (uqId: string, text: string) => {
    setAnswerFor(null);
    const ok = await submitSuggestion({ kind: 'new', text, sourceUqId: uqId });
    if (ok) showToast('사장님이 승인하면 노하우에 추가돼요', 'good');
  };

  // 내 기여 내보내기 — 화면에 쌓인 내 노하우·답한 질문·제안을 텍스트로 직렬화해 클립보드로.
  // (웹 우선 = OwnerKnowhowBrowse '매뉴얼 내보내기'와 동일 패턴. 네이티브는 canCopy=false라 버튼 숨김.)
  const onExport = () => {
    void copy(
      buildMyContributionText({
        userName: userName || '나',
        storeName: storeName || '우리 매장',
        date: new Date().toLocaleDateString('ko-KR'),
        proposals: myProposals,
        answered: myAnswered,
        entryById,
      }),
    );
  };

  // 전부 도착 전엔 로딩만 — "지금은 도와줄 질문이 없어요"가 먼저 스치거나 기록 섹션이
  // 없음→있음으로 하나씩 튀어나오는 것을 막는다(08-07 정본 §0-1). 훅은 위에서 전부 호출한 뒤다.
  const ready = queueLoaded && suggestionsLoaded && historyLoaded && entriesLoaded && workLoaded;
  if (!ready) {
    return (
      <View style={s.flex}>
        <ScreenLoading label="내 공간을 불러오고 있어요…" />
      </View>
    );
  }

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      {/* ── 히어로 — 내가 아는 노하우 히트맵(H5). 노하우가 0개면 그리지 않는다(빈 격자 금지).
             ★2026-08-27 오밀조밀 확산 6-4. 옛 판본은 히어로가 없고 groupCard 4장이 연달아 있었고,
               그 사이를 MiniStats 숫자 3칸이 끊고 있었다 — 숫자 3개는 대상이 없어 아무 말도 못 했다.
               머리줄(n/m)이 '내가 쌓은 노하우'를 대신하고, 나머지 둘은 아래 롤업이 대상과 함께 말한다. ── */}
      {publishedEntries.length > 0 && (
        <Appear delay={stagger(0)}>
          <Heatmap
            head={{
              value: `${knownCount}`,
              unit: `/${publishedEntries.length}`,
              title: '내가 아는 노하우',
              aside: '나만 볼 수 있어요',
            }}
            groups={heatGroups}
            legend={MY_HEAT_LEGEND}
            hint="상자 하나 = 노하우 하나 · 길게 누르면 이름이 보여요"
            onPressCell={(id) => {
              const e = entryById.get(id);
              if (e) setDetailEntry(e);
            }}
          />
        </Appear>
      )}

      {/* ① 도와줄 수 있는 질문 (D4) */}
      <SectionLabel icon="hand-left-outline" title="도와줄 수 있는 질문" hint={answerable.length ? `${answerable.length}건` : undefined} />
      {answerable.length === 0 ? (
        <Text style={s.empty}>지금은 도와줄 질문이 없어요.</Text>
      ) : (
        <View style={s.list}>
          {answerable.map((u, i) => (
            <Appear key={u.id} delay={stagger(i)}>
              <Pressable onPress={() => setAnswerFor(u)} style={({ pressed }) => [s.qCard, pressed && { opacity: 0.85 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.qText} numberOfLines={2}>{u.query_text}</Text>
                  <Text style={s.qMeta}>{u.junior_name}님이 물었어요{u.similar_queries_count > 0 ? ` · 같은 질문 ${u.similar_queries_count + 1}회` : ''}</Text>
                </View>
                <View style={s.qCta}><Text style={s.qCtaText}>답하기</Text></View>
              </Pressable>
            </Appear>
          ))}
        </View>
      )}

      {/* 내 기여 내보내기 — 내보낼 게 있고 복사가 되는 환경(웹)에서만 노출. */}
      {canCopyToClipboard() && (myProposals.length > 0 || myAnswered.length > 0) && (
        <Pressable
          onPress={onExport}
          style={({ pressed }) => [s.exportBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="내 기여 내보내기"
        >
          <Ionicons name={copied ? 'checkmark' : 'download-outline'} size={14} color={copied ? BrandColors.good : InkColors.ink2} />
          <Text style={[s.exportBtnText, copied && { color: BrandColors.goodText }]}>{copied ? '복사됐어요' : '내 기여 내보내기'}</Text>
        </Pressable>
      )}

      {/* ── 내 기록 — 블록 L5(RollupRows). 2026-08-27: 섹션 3개(답한 질문·보낸 제안·물어본 것)가
             각자 제목+카드였다(같은 형태 3연속). 셋은 **대등한 지표**라 §7-4 B 그대로 롤업 행으로 묶고,
             행을 누르면 그 목록이 **아래로 펼쳐진다**(시트·모달 아님).
             각 행은 대표 대상 1줄을 갖는다(R2) — 숫자 1은 대상 없이는 아무 말도 안 한다. ── */}
      {(myAnswered.length > 0 || myProposals.length > 0 || myQuestions.length > 0) && (
        <>
          <SectionLabel icon="albums-outline" title="내 기록" />
          <RollupRows
            rows={[
              ...(myAnswered.length > 0
                ? [{
                    key: 'answered',
                    title: '내가 답한 질문',
                    count: myAnswered.length,
                    unit: '건' as const,
                    target: myAnswered[0]?.query_text,
                    onPress: () => setOpenRecord((v) => (v === 'answered' ? null : 'answered')),
                  } satisfies RollupRow]
                : []),
              ...(myProposals.length > 0
                ? [{
                    key: 'proposals',
                    title: '보낸 제안',
                    count: myProposals.length,
                    unit: '건' as const,
                    // 검토 중·반려가 위로 정렬돼 있으므로 첫 줄이 곧 "지금 신경 쓸 것"이다.
                    hot: myProposals.some((p) => p.status === 'rejected'),
                    target: myProposals[0]
                      ? `${myProposals[0].text} · ${myProposals[0].status === 'approved' ? '반영됨' : myProposals[0].status === 'rejected' ? '반려' : '검토 중'}`
                      : undefined,
                    onPress: () => setOpenRecord((v) => (v === 'proposals' ? null : 'proposals')),
                  } satisfies RollupRow]
                : []),
              ...(myQuestions.length > 0
                ? [{
                    key: 'questions',
                    title: '내가 물어본 것',
                    count: myQuestions.length,
                    unit: '건' as const,
                    target: myQuestions[0]?.query_text,
                    onPress: () => setOpenRecord((v) => (v === 'questions' ? null : 'questions')),
                  } satisfies RollupRow]
                : []),
            ]}
          />
        </>
      )}

      {/* ③ 내가 답한 질문 — 롤업에서 펼쳤을 때만. 카드 1장 + 헤어라인 행(낱개 보더 카드 반복 = 시각 소음) */}
      {openRecord === 'answered' && myAnswered.length > 0 && (
        <>
          <View style={s.groupCard}>
            {(showAllAnswered ? myAnswered : myAnswered.slice(0, 3)).map((u, i) => {
              const e = u.resolved_with_entry_id ? entryById.get(u.resolved_with_entry_id) : undefined;
              return (
                <Appear key={u.id} delay={stagger(i)}>
                  <Pressable
                    disabled={!e}
                    onPress={() => e && setDetailEntry(e)}
                    style={({ pressed }) => [s.groupRow, i > 0 && s.rowDivider, pressed && e && { opacity: 0.7 }]}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={BrandColors.good} />
                    <Text style={s.rowText} numberOfLines={1}>{u.query_text}</Text>
                    {e ? <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} /> : null}
                  </Pressable>
                </Appear>
              );
            })}
            {!showAllAnswered && myAnswered.length > 3 && (
              <MoreRow count={myAnswered.length - 3} onPress={() => setShowAllAnswered(true)} />
            )}
          </View>
        </>
      )}

      {/* ② 내가 보낸 제안 — 롤업에서 펼쳤을 때만. 검토 중·반려가 위(정렬은 myProposals에서) */}
      {openRecord === 'proposals' && myProposals.length > 0 && (
        <>
          <View style={s.groupCard}>
            {(showAllProposals ? myProposals : myProposals.slice(0, 3)).map((sug, i) => (
              <Appear key={sug.id} delay={stagger(i)}>
                <View style={i > 0 ? s.rowDivider : undefined}>
                  <View style={s.groupRow}>
                    <Ionicons name={sug.status === 'approved' ? 'checkmark-circle' : sug.status === 'rejected' ? 'close-circle' : 'time-outline'} size={16} color={sug.status === 'approved' ? BrandColors.good : sug.status === 'rejected' ? BrandColors.bad : InkColors.ink3} />
                    <Text style={s.rowText} numberOfLines={1}>{sug.text}</Text>
                    <Text style={[s.statusTag, sug.status === 'approved' && { color: BrandColors.goodText }, sug.status === 'rejected' && { color: BrandColors.badText }]}>
                      {sug.status === 'approved' ? '반영됨' : sug.status === 'rejected' ? '반려' : '검토 중'}
                    </Text>
                  </View>
                  {sug.status === 'rejected' && !!sug.owner_note && (
                    <Text style={s.rejectNote}>사장님 메모 · {sug.owner_note}</Text>
                  )}
                </View>
              </Appear>
            ))}
            {!showAllProposals && myProposals.length > 3 && (
              <MoreRow count={myProposals.length - 3} onPress={() => setShowAllProposals(true)} />
            )}
          </View>
        </>
      )}

      {/* ④ 내 질문 이력 — 롤업에서 펼쳤을 때만. 예외(답 기다리는 중)만 강조, 답 받음은 흐린 메타로 */}
      {openRecord === 'questions' && myQuestions.length > 0 && (
        <>
          <View style={s.groupCard}>
            {(showAllQuestions ? myQuestions.slice(0, 20) : myQuestions.slice(0, 5)).map((q, i) => {
              const answered = !!q.resolved_at || (q.matched_entry_ids?.length ?? 0) > 0;
              return (
                <Appear key={q.id} delay={stagger(i)}>
                  <View style={[s.groupRow, i > 0 && s.rowDivider]}>
                    <Ionicons name="help-circle-outline" size={16} color={InkColors.ink3} />
                    <Text style={s.rowText} numberOfLines={1}>{q.query_text}</Text>
                    {answered ? <Text style={s.doneMeta}>답 받음</Text> : <Text style={s.waitTag}>답 기다리는 중</Text>}
                  </View>
                </Appear>
              );
            })}
            {!showAllQuestions && myQuestions.length > 5 && (
              <MoreRow count={Math.min(myQuestions.length, 20) - 5} onPress={() => setShowAllQuestions(true)} />
            )}
          </View>
        </>
      )}

      <View style={{ height: 24 }} />

      {answerFor && (
        <AnswerSheet
          uq={answerFor}
          entries={publishedEntries}
          onResolve={onResolveWith}
          onNewAnswer={onNewAnswer}
          onClose={() => setAnswerFor(null)}
        />
      )}
      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />
    </ScrollView>
  );
}

/** 기록 리스트 공용 '더 보기' 행 — 아래로 펼침(시트·모달 금지). */
function MoreRow({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.moreRow, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`${count}건 더 보기`}
    >
      <Text style={s.moreText}>{count}건 더 보기</Text>
      <Ionicons name="chevron-down" size={14} color={InkColors.ink2} />
    </Pressable>
  );
}

/** 내 기여를 사람이 읽는 텍스트로 직렬화 — 승인된 노하우·답한 질문·검토 중 제안 순. */
function buildMyContributionText(args: {
  userName: string;
  storeName: string;
  date: string;
  proposals: PlaybookSuggestion[];
  answered: UnknownQuery[];
  entryById: Map<string, PlaybookEntry>;
}): string {
  const { userName, storeName, date, proposals, answered, entryById } = args;
  const lines: string[] = [`${userName}님의 노하우 기여`, `${storeName} · ${date}`, ''];

  const approved = proposals.filter((p) => p.status === 'approved');
  if (approved.length) {
    lines.push(`■ 내가 쌓은 노하우 (${approved.length})`);
    approved.forEach((p, i) => lines.push(`${i + 1}. ${p.text}`));
    lines.push('');
  }
  if (answered.length) {
    lines.push(`■ 내가 답한 질문 (${answered.length})`);
    answered.forEach((u, i) => {
      const e = u.resolved_with_entry_id ? entryById.get(u.resolved_with_entry_id) : undefined;
      lines.push(`${i + 1}. ${u.query_text}${e ? ` → ${e.title}` : ''}`);
    });
    lines.push('');
  }
  const pending = proposals.filter((p) => p.status === 'pending');
  if (pending.length) {
    lines.push(`■ 검토 중인 제안 (${pending.length})`);
    pending.forEach((p, i) => lines.push(`${i + 1}. ${p.text}`));
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** 질문 답하기 시트 — 기존 노하우에서 찾아 지정(즉시 해결) 또는 새로 답 남기기(사장 승인). */
function AnswerSheet({
  uq,
  entries,
  onResolve,
  onNewAnswer,
  onClose,
}: {
  uq: UnknownQuery;
  entries: PlaybookEntry[];
  onResolve: (uqId: string, entryId: string) => void;
  onNewAnswer: (uqId: string, text: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [line, setLine] = useState('');
  const results = useMemo(
    () => (q.trim() ? searchPlaybook(q, entries, { topK: 5, threshold: 0 }).candidates.map((c) => c.entry) : []),
    [q, entries],
  );

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '82%' }}>
      <View style={s.sheetHead}>
        <Text style={s.sheetKicker}>이 질문에 답하기</Text>
        <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={20} color={InkColors.ink2} /></Pressable>
      </View>
      <ScrollView style={s.sheetScroll} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.qBox}><Text style={s.qBoxText}>{uq.query_text}</Text></View>

        <Text style={s.sheetLabel}>이미 있는 노하우에서 찾기</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="노하우 검색" placeholderTextColor={InkColors.ink3} style={s.inp} />
        {q.trim().length > 0 && (
          <View style={s.results}>
            {results.length === 0 ? (
              <Text style={s.resultEmpty}>맞는 노하우가 없어요 — 아래에 새로 답을 남겨주세요</Text>
            ) : (
              results.map((e) => (
                <Pressable key={e.id} onPress={() => onResolve(uq.id, e.id)} style={({ pressed }) => [s.resultRow, pressed && { backgroundColor: InkColors.paper }]} accessibilityRole="button" accessibilityLabel={`${e.title} 이 노하우로 답하기`}>
                  <Ionicons name="checkmark-circle-outline" size={17} color={BrandColors.good} />
                  <Text style={s.resultText} numberOfLines={1}>{e.title}</Text>
                  <Text style={s.resultPick}>이걸로 답</Text>
                </Pressable>
              ))
            )}
          </View>
        )}

        <View style={s.divider} />

        <Text style={s.sheetLabel}>찾는 답이 없으면 — 새로 남기기</Text>
        <TextInput value={line} onChangeText={setLine} placeholder="한 줄로 답을 적어주세요" placeholderTextColor={InkColors.ink3} style={[s.inp, s.inpMulti]} multiline />
        <Text style={s.sheetHint}>사장님이 승인하면 노하우에 추가돼 다음 사람이 바로 봐요.</Text>
        <Pressable
          onPress={() => onNewAnswer(uq.id, line.trim())}
          disabled={!line.trim()}
          style={({ pressed }) => [s.cta, !line.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="사장님께 답 보내기"
        >
          <Text style={s.ctaText}>사장님께 답 보내기</Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.sm },
  empty: { fontSize: 15, color: InkColors.ink2, paddingVertical: 14, textAlign: 'center' },
  list: { gap: Space.sm, marginBottom: Space.sm },

  qCard: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: Space.md, ...Elevation.e1 },
  qText: { fontSize: 14, fontWeight: '700', color: InkColors.ink, lineHeight: 20 },
  qMeta: { fontSize: 11.5, color: InkColors.ink3, marginTop: 3, fontWeight: '600' },
  qCta: { backgroundColor: InkColors.ink, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  qCtaText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },


  exportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginBottom: Space.xs },
  exportBtnText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },

  // 기록 섹션 = 카드 1장 + 헤어라인 행 (허브 '오늘'과 같은 문법)
  groupCard: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: Space.md, marginBottom: Space.sm, ...Elevation.e1 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rejectNote: { fontSize: 12, color: InkColors.ink2, fontWeight: '600', lineHeight: 17, backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm, paddingHorizontal: Space.sm, paddingVertical: Space.xs, marginBottom: Space.md },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
  statusTag: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  doneMeta: { fontSize: 11, fontWeight: '600', color: InkColors.ink3 },
  waitTag: { fontSize: 10.5, fontWeight: '800', color: BrandColors.warnText, backgroundColor: BrandColors.warnSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, overflow: 'hidden' },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderTopWidth: 1, borderTopColor: InkColors.line, paddingVertical: Space.sm },
  moreText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  // 답변 시트
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  sheetKicker: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sheetScroll: { flex: 1, paddingHorizontal: 16 },
  qBox: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 13, marginBottom: 14 },
  qBoxText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
  sheetLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 7 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.bg },
  inpMulti: { minHeight: 68, textAlignVertical: 'top', lineHeight: 20 },
  results: { marginTop: 6, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: InkColors.paper },
  resultText: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
  resultPick: { fontSize: 11.5, fontWeight: '800', color: BrandColors.goodText },
  // 검색 결과 없음 = 본문(simplicity-voice §4: 빈 화면 문구) → 꼬리표용 ink3(2.55:1) 금지.
  resultEmpty: { fontSize: 12.5, color: InkColors.ink2, paddingHorizontal: 12, paddingVertical: 12 },
  divider: { height: 1, backgroundColor: InkColors.line, marginVertical: 18 },
  sheetHint: { fontSize: 11.5, color: InkColors.ink3, marginTop: 7 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
