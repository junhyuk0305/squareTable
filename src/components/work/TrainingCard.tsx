import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Collapse } from '@/components/Collapse';
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
};

const STATE_CHIP: Record<TrainingCardItem['state'], { label: string; color: string; bg: string }> = {
  passed: { label: '통과', color: BrandColors.goodText, bg: '#E6F1EA' },
  next: { label: '다음', color: InkColors.ink, bg: InkColors.cream },
  todo: { label: '대기', color: InkColors.ink3, bg: InkColors.bgSoft },
  due: { label: '다시 확인', color: '#8a5a12', bg: BrandColors.warnSoft },
  asked: { label: '사장님 요청', color: '#8a5a12', bg: BrandColors.warnSoft },
};

/**
 * TrainingCard — 직원 업무 채팅 상단의 퀴즈 카드(코스 1개 = 카드 1장).
 * 위에는 "다음 한 개"(순서의 외부화), 펼치면 전체 항목과 상태가 보인다(색+텍스트 병기).
 * 문제 풀이는 자발 — 페널티 없음. 1회성 코스는 전부 통과하면, 주기 코스는 다시 확인할 게 없으면 사라진다.
 */
export function TrainingCard({
  course,
  items,
  onOpenKnowhow,
  onStartCheck,
}: {
  course: TrainingCardCourse;
  items: TrainingCardItem[];
  /** 항목 id = 노하우 id(0111). */
  onOpenKnowhow: (entryId: string) => void;
  onStartCheck: (entryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 요청(asked)이 주기(due)보다 먼저 — 사람이 기다리는 것부터.
  const next = items.find((it) => it.state === 'asked') ?? items.find((it) => it.state === 'next' || it.state === 'due');
  if (!next) return null;

  // 1회성(due_days 없음)이면 "처음 배우는 중", 주기가 있으면 "다시 확인하는 중" — 코스 행 하나로 갈린다.
  const oneShot = course.dueDays === null;
  const dueCount = items.filter((it) => it.state === 'due' || it.state === 'asked').length;
  // 제목은 코스 이름 그대로 — 종류가 여러 개라 '첫 출근'/'포지션 바뀔 때'가 구분돼야 한다.
  const title = course.name;
  // ★완료가 아니라 **잔여**를 센다(뤼이드 튜터 레퍼런스 leveltest_05). 잔여는 0이 되는 순간
  //   카드가 사라지므로 "0/5 통과" 같은 0 전시가 구조적으로 생기지 않는다(R1-1의 상위 해법).
  const leftCount = oneShot ? items.filter((it) => it.state !== 'passed').length : dueCount;
  const badge = `${leftCount}개 남았어요`;
  const ctaLabel = oneShot ? '혼자 할 수 있어요' : '다시 확인하기';

  return (
    <View style={st.card}>
      <View style={st.head}>
        <Ionicons name={oneShot ? 'school-outline' : 'refresh-outline'} size={16} color={InkColors.ink} />
        <Text style={st.title}>{title}</Text>
        <Text style={[st.progress, !oneShot && { color: '#8a5a12' }]}>{badge}</Text>
      </View>

      <Text style={st.next} numberOfLines={2}>
        {oneShot ? '다음 퀴즈' : next.state === 'asked' ? '사장님이 요청했어요' : '다시 확인할 노하우'} · {next.text}
      </Text>

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
          {items.map((it, i) => {
            const chip = STATE_CHIP[it.state];
            return (
              <Pressable
                key={it.id}
                onPress={() => onOpenKnowhow(it.id)}
                style={({ pressed }) => [st.itemRow, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`${it.text} 노하우 읽기`}
              >
                <Text style={st.itemNum}>{i + 1}</Text>
                <Text style={st.itemText} numberOfLines={1}>{it.text}</Text>
                <Text style={[st.chip, { color: chip.color, backgroundColor: chip.bg }]}>{chip.label}</Text>
              </Pressable>
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
  progress: { fontSize: 12, fontWeight: '800', color: BrandColors.goodText },
  next: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
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
  // 카드가 gap 으로 벌리던 항목 간격 — Collapse 로 한 겹 감싸면서 이 안쪽으로 옮겨 온다(간격 유지).
  itemList: { gap: Space.xs },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.xs + 2, minHeight: 36 },
  itemNum: { width: 18, fontSize: 12, fontWeight: '800', color: InkColors.ink3, textAlign: 'center' },
  itemText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink, minWidth: 0 },
  chip: {
    fontSize: 11, fontWeight: '900', paddingHorizontal: Space.xs + 2, paddingVertical: 2,
    borderRadius: Radius.pill, overflow: 'hidden',
  },
});
