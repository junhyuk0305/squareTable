import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Collapse } from '@/components/Collapse';
import { ProgressPill, type ProgressTone } from '@/components/blocks/ProgressPill';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 직원 퀴즈 카드의 항목 상태 — passed=통과 · next=다음 차례 · todo=대기 · due=주기 도래 · asked=관리자 요청. */
export type TrainingCardItem = {
  /** 0111 부터 항목은 **노하우**다(playbook_entries.id). 예전엔 업무 id 였다. */
  id: string;
  /** 노하우 제목. */
  text: string;
  state: 'passed' | 'next' | 'todo' | 'due' | 'asked';
};

/**
 * 이 카드가 어느 코스인가 — 값은 코스 행(0108 training_courses)에서 그대로 온다.
 * 예전의 kind:'first'|'regular' 는 DB 에 없는 이름이라 호출부가 코스 key 를 몰래 매핑해야 했다.
 */
export type TrainingCardCourse = {
  /** training_courses.key — 카드 식별용(호출부 React key). */
  key: string;
  /** training_courses.name — 카드 제목. 코스가 여러 종류라 고정 제목을 쓰면 전부 같은 이름으로 뜬다. */
  name: string;
  /** null = 1회성(한 번 통과하면 끝) · N = N일마다 다시 확인. 카드의 말투가 이 값으로 갈린다. */
  dueDays: number | null;
  /**
   * 내가 받은 발송의 마감일 "YYYY-MM-DD"(0139 quiz_assignments.due_on). null = 마감 없음.
   * ★사장이 "3일 안에"로 정해도 직원 화면에 안 보이면 그건 사장만 아는 숫자다(2026-08-12 수정).
   */
  dueOn?: string | null;
};

/**
 * 마감 꼬리표. **색 단독으로 구분하지 않는다** — 문구 자체가 상태를 말한다(복잡도 §4).
 * 재촉하지 않는다: 지난 것도 "안 했어요"가 아니라 사실만 적는다(워딩 §6 평가 금지).
 */
function deadlineLabel(dueOn: string | null | undefined, todayYmd: string): { text: string; tone: 'plain' | 'soon' | 'past' } | null {
  if (!dueOn) return null;
  if (dueOn < todayYmd) return { text: '기한이 지났어요', tone: 'past' };
  if (dueOn === todayYmd) return { text: '오늘까지', tone: 'soon' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueOn);
  return { text: m ? `${Number(m[2])}월 ${Number(m[3])}일까지` : `${dueOn}까지`, tone: 'plain' };
}

/**
 * 펼친 목록의 갈래 — **한 줄씩 상태칩이 붙던 평평한 목록을 갈래로 나눈 것**(데모 §12).
 * 예전에는 '처음 배우는 것'과 '다시 확인할 것'과 '사장님이 콕 집어 보낸 것'이 한 줄 간격으로
 * 섞여 있어서 칩 색을 하나하나 읽어야 구분이 됐다. 갈래를 제목으로 올리면 색 없이도 읽힌다
 * (색 단독으로 상태를 구분하지 않는다 — 여기서는 **제목이 그 라벨**이라 행에 칩을 다시 붙이지 않는다).
 *
 * ★상태값은 호출부(WorkBoard.trainingCards)가 정한 것을 그대로 담기만 한다 — 여기서 다시 판정하지 않는다.
 */
const ITEM_GROUPS: { label: string; states: TrainingCardItem['state'][] }[] = [
  // 사람이 기다리는 것이 맨 위 — 카드 위쪽의 '다음 한 개' 우선순위와 같은 순서다.
  { label: '사장님 요청', states: ['asked'] },
  { label: '새로 배정됨', states: ['next', 'todo'] },
  { label: '다시 확인할 노하우', states: ['due'] },
  { label: '통과', states: ['passed'] },
];

/**
 * TrainingCard — 직원 업무 채팅 상단의 퀴즈 카드(코스 1개 = 카드 1장).
 * 위에는 "다음 한 개"(순서의 외부화) + 진행 알약 + 지난번 결과 한 줄, 펼치면 전체 항목이 **갈래별로** 보인다.
 * 문제 풀이는 자발 — 페널티 없음. 1회성 코스는 전부 통과하면, 주기 코스는 다시 확인할 게 없으면 사라진다.
 */
export function TrainingCard({
  course,
  items,
  lastResult,
  onOpenKnowhow,
  onStartCheck,
}: {
  course: TrainingCardCourse;
  items: TrainingCardItem[];
  /**
   * 이 카드의 노하우들 중 **내가 마지막으로 푼 응시 1건**(0112). 없으면 줄 자체가 없다.
   * 집계는 `lastQuizAttemptOf`(useWorkStore) 가 한다 — 카드는 받은 값을 그리기만 한다.
   */
  lastResult?: { total: number; correct: number } | null;
  /** 항목 id = 노하우 id(0111). */
  onOpenKnowhow: (entryId: string) => void;
  onStartCheck: (entryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // KST 오늘 "YYYY-MM-DD". 마감은 날짜 비교라 시각이 필요 없다(서버 due_on 도 KST 날짜).
  // 렌더 중 Date.now() 금지(컴파일러 순수성) → 마운트 1회. 날짜가 바뀌는 순간은 앱이 다시 뜬다.
  const [kstToday] = useState(() => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));
  // 요청(asked)이 주기(due)보다 먼저 — 사람이 기다리는 것부터.
  const next = items.find((it) => it.state === 'asked') ?? items.find((it) => it.state === 'next' || it.state === 'due');
  if (!next) return null;

  // 1회성(due_days 없음)이면 "처음 배우는 중", 주기가 있으면 "다시 확인하는 중" — 코스 행 하나로 갈린다.
  const oneShot = course.dueDays === null;
  // 제목은 코스 이름 그대로 — 종류가 여러 개라 '첫 출근'/'포지션 바뀔 때'가 구분돼야 한다.
  const title = course.name;
  /*
   * 진행 표기 — **배정받은 것 중 몇 개를 했나**(데모 §12). 예전엔 잔여("3개 남았어요")만 말해서
   * 전체가 몇 개인지가 카드에 없었다(뤼이드 잔여 카운터는 응시 화면에 그대로 남아 있다 —
   * `UnderstandingCheckSheet` 의 "N문제 남았어요").
   *  · 알약은 새로 그리지 않고 `ProgressPill`(D7) 을 그대로 쓴다.
   *  · ★한 개도 안 했으면 `0/5` 가 아니라 상태어다(R1-1 · 진행·통과의 0은 숫자로 쓰지 않는다).
   *  · ★빨강(behind)을 쓰지 않는다 — 주기가 돌아온 것은 직원이 잘못한 게 아니다(재촉 금지).
   *    이 카드가 여러 장 뜨는 것도 아니라 색으로 급함을 다툴 자리가 아니다.
   */
  const passedCount = items.filter((it) => it.state === 'passed').length;
  const progressText = passedCount > 0 ? `${passedCount}/${items.length} 통과` : '아직 시작 전';
  const progressTone: ProgressTone = passedCount > 0 ? 'progress' : 'neutral';
  const ctaLabel = oneShot ? '혼자 할 수 있어요' : '다시 확인하기';
  const deadline = deadlineLabel(course.dueOn, kstToday);

  return (
    <View style={st.card}>
      <View style={st.head}>
        <Ionicons name={oneShot ? 'school-outline' : 'refresh-outline'} size={16} color={InkColors.ink} />
        <Text style={st.title}>{title}</Text>
        <ProgressPill text={progressText} tone={progressTone} />
      </View>

      <Text style={st.next} numberOfLines={2}>
        {oneShot ? '다음 퀴즈' : next.state === 'asked' ? '사장님이 요청했어요' : '다시 확인할 노하우'} · {next.text}
      </Text>

      {/* 마감 — 사장이 정한 "언제까지"를 직원도 안다. 없으면 줄 자체가 없다(마감 없는 퀴즈가 기본). */}
      {deadline ? (
        <View style={st.dueRow}>
          <Ionicons
            name={deadline.tone === 'past' ? 'alert-circle-outline' : 'time-outline'}
            size={14}
            color={deadline.tone === 'past' ? BrandColors.badText : deadline.tone === 'soon' ? '#8a5a12' : InkColors.ink3}
          />
          <Text
            style={[
              st.dueText,
              deadline.tone === 'soon' && { color: '#8a5a12' },
              deadline.tone === 'past' && { color: BrandColors.badText },
            ]}
          >
            {deadline.text}
          </Text>
        </View>
      ) : null}

      {/* 지난번 결과 — 사실만 한 줄(평가 금지). 푼 적이 없으면 줄 자체가 없다. */}
      {lastResult ? (
        <Text style={st.lastText} numberOfLines={1}>
          {lastResult.correct === lastResult.total
            ? '지난번 퀴즈 · 통과했어요'
            : `지난번 퀴즈 · ${lastResult.total}개 중 ${lastResult.correct}개 맞았어요`}
        </Text>
      ) : null}

      <View style={st.btnRow}>
        <Pressable
          onPress={() => onOpenKnowhow(next.id)}
          style={({ pressed }) => [st.softBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="노하우 읽기"
        >
          <Ionicons name="book-outline" size={15} color={InkColors.ink} />
          <Text style={st.softBtnText}>노하우 읽기</Text>
        </Pressable>
        <Pressable
          onPress={() => onStartCheck(next.id)}
          style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Ionicons name="ribbon-outline" size={15} color="#FFFFFF" />
          <Text style={st.ctaText}>{ctaLabel}</Text>
        </Pressable>
      </View>

      {/* 전체 항목 — 펼침은 아래로(Reveal 규칙). 행 탭 = 그 항목의 노하우 읽기. */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [st.expandRow, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={expanded ? '전체 항목 접기' : '전체 항목 보기'}
      >
        <Text style={st.expandText}>{expanded ? '접기' : `전체 ${items.length}개 보기`}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={InkColors.ink2} />
      </Pressable>
      {expanded && (
        <Collapse style={st.itemList}>
          {ITEM_GROUPS.map((g) => {
            // 번호는 **코스 순서**(배우는 순서)라 갈래로 나눠도 원래 자리 번호를 그대로 들고 간다.
            const rows = items.map((it, i) => ({ it, no: i + 1 })).filter((r) => g.states.includes(r.it.state));
            if (rows.length === 0) return null; // 빈 갈래는 제목도 안 뜬다
            return (
              <View key={g.label} style={st.group}>
                <Text style={st.groupLabel}>{g.label} · {rows.length}개</Text>
                {rows.map(({ it, no }) => (
                  <Pressable
                    key={it.id}
                    onPress={() => onOpenKnowhow(it.id)}
                    style={({ pressed }) => [st.itemRow, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${it.text} 노하우 읽기`}
                  >
                    <Text style={st.itemNum}>{no}</Text>
                    <Text style={st.itemText} numberOfLines={1}>{it.text}</Text>
                  </Pressable>
                ))}
              </View>
            );
          })}
        </Collapse>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    marginHorizontal: Space.gutter, marginTop: Space.sm, marginBottom: Space.xs,
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.md, gap: Space.xs, ...Elevation.e2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  title: { flex: 1, fontSize: 13, fontWeight: '800', color: InkColors.ink },
  next: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
  // 마감 꼬리표 — 상태 라벨이라 본문 15sp 하한 대상이 아니다(복잡도 §4 "보조").
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  dueText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3, lineHeight: 18 },
  // 지난번 결과 — 마감 꼬리표와 같은 급의 보조 표기(본문 15sp 하한 대상 아님).
  lastText: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  softBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 48,
    paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  softBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  cta: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 48,
    borderRadius: Radius.md, backgroundColor: InkColors.ink,
  },
  ctaText: { fontSize: 13.5, fontWeight: '800', color: '#FFFFFF' },

  expandRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: Space.xs, paddingVertical: Space.sm, minHeight: 40,
  },
  expandText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  // 갈래 사이 간격. 행 간격은 group 이 갖는다(예전엔 여기 하나가 행 간격이었다).
  itemList: { gap: Space.md },
  group: { gap: Space.xs },
  groupLabel: { fontSize: 12, fontWeight: '900', color: InkColors.ink3 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.xs + 2, minHeight: 36 },
  itemNum: { width: 18, fontSize: 12, fontWeight: '800', color: InkColors.ink3, textAlign: 'center' },
  itemText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink, minWidth: 0 },
});
