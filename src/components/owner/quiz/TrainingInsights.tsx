/**
 * 퀴즈 현황 — /owner/training(1층 대시보드) 안의 섹션. **새 라우트를 만들지 않는다**(IA 정본).
 *
 * 전부 이미 있는 데이터로만 계산한다: course_entries(0111) · knowhow_understanding(0111) ·
 * training_courses · knowhow_quiz_stats(0103) · quiz_items.
 *
 * ★ 개인별 오답 이력은 만들지 않는다. knowhow_quiz_stats 에 staff_id 가 없는 건 의도된 설계다(0103).
 *   여기서 보이는 개인 정보는 "이수 여부"뿐이고, 오답·소요시간은 만들지도 보여주지도 않는다.
 *
 * ★2026-08-07 — '다른 코스 것만' 게이트를 걷어냈다.
 *   호출부가 `courses.filter(c => c.key !== activeKey)` 를 넘겼기 때문에 **코스가 하나뿐인 매장에서는
 *   섹션 자체가 렌더되지 않았다** — 사장이 "인사이트가 안 보인다"고 한 것의 직접 원인이다.
 *   중복 걱정은 층 분리로 해소됐다: 노하우 행 목록은 2층(`/owner/quiz-list`)으로 내려갔고
 *   여기 남은 것은 집계뿐이다. 코스별 이수만 **활성 코스를 건너뛴다**(위 진행 링이 같은 말을 한다).
 */

import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import type { CourseEntryRow, UnderstandingRow } from '@/lib/db';
import type { QuizRow } from '@/lib/quiz/useQuizBoard';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { SectionLabel } from '@/components/SectionLabel';

const DAY_MS = 24 * 60 * 60 * 1000;

export function TrainingInsights({
  courses,
  activeCourseId,
  rows,
  riskOf,
  courseEntries,
  understanding,
  staff,
  now,
  onOpenFilter,
}: {
  /** 소유 매장의 코스 **전부**. 활성 코스를 빼서 넘기지 않는다(그게 옛 버그의 원인이었다). */
  courses: TrainingCourse[];
  /** 위 진행 링이 이미 말한 코스 — '코스별 이수'에서만 건너뛴다. */
  activeCourseId: string | null;
  /** 전 코스 기준 노하우 행(useQuizBoard.buildRows(null)) — 집계를 여기서 다시 하지 않는다. */
  rows: QuizRow[];
  /** 이 노하우를 얼마나 먼저 손봐야 하나(높을수록 먼저). 판정은 코드가 한다 — 사장 입력 없음. */
  riskOf: (entryId: string, preset?: string | null) => number;
  courseEntries: CourseEntryRow[];
  understanding: UnderstandingRow[];
  staff: { id: string; name: string }[];
  now: number;
  /** 지표 → 2층 목록의 그 거르기로. 숫자만 늘어놓지 않는다(기획 §2). */
  onOpenFilter: (status: 'no_one' | 'missed') => void;
}) {
  /**
   * ② 아무도 모르는 노하우 — 문항은 있는데 확인한 직원이 0인 노하우.
   * 문항이 아예 없는 것은 여기서 세지 않는다 — 그건 위 경고행('문항 없는 노하우')의 몫이고,
   * 한 노하우가 두 줄에 걸치면 사장이 같은 것을 두 번 손대게 된다.
   * 정렬은 riskOf 가 정한다(사고 나는 자리부터).
   */
  const noOne = useMemo(
    () =>
      rows
        .filter((r) => r.quizCount > 0 && r.passedIds.length === 0)
        .map((r) => ({ ...r, score: riskOf(r.entryId) }))
        .sort((a, b) => (b.score - a.score) || a.text.localeCompare(b.text, 'ko')),
    [rows, riskOf],
  );

  // ── ① 코스별 이수 현황 — 그 코스의 노하우를 전부 확인한 직원 수. 점수가 아니라 도달 여부만 센다.
  const progress = useMemo(
    () =>
      courses
        .filter((c) => c.id !== activeCourseId)
        .map((c) => {
          const items = courseEntries.filter((e) => e.courseId === c.id);
          const passedNames: string[] = [];
          const pendingNames: string[] = [];
          for (const p of staff) {
            const done = items.length > 0 && items.every((it) => {
              const row = understanding.find((u) => u.entryId === it.entryId && u.staffId === p.id);
              if (!row) return false;
              if (!c.due_days) return true;
              const t = Date.parse(row.verifiedAt);
              return Number.isFinite(t) && now - t <= c.due_days * DAY_MS;
            });
            (done ? passedNames : pendingNames).push(p.name);
          }
          return { course: c, itemCount: items.length, passedNames, pendingNames };
        }),
    [courses, activeCourseId, courseEntries, staff, understanding, now],
  );

  // ── ③ 다시 확인할 때가 된 사람 — 주기가 있는 코스에서 마지막 확인이 주기를 넘긴 직원 수.
  const dueSoon = useMemo(
    () =>
      courses
        .filter((c) => !!c.due_days)
        .map((c) => {
          const ids = new Set(courseEntries.filter((e) => e.courseId === c.id).map((e) => e.entryId));
          const staffIds = new Set<string>();
          for (const u of understanding) {
            if (!ids.has(u.entryId)) continue;
            const t = Date.parse(u.verifiedAt);
            if (!Number.isFinite(t) || now - t > (c.due_days as number) * DAY_MS) staffIds.add(u.staffId);
          }
          return { course: c, count: staffIds.size };
        })
        .filter((x) => x.count > 0),
    [courses, courseEntries, understanding, now],
  );

  /**
   * ⑤ 자주 틀리는 노하우 top 3 — 개인 비난이 아니라 "노하우가 헷갈리게 적혔을 수 있어요" 신호(0103).
   * 판정(표본 5회 이상·오답률 40% 이상)은 `useQuizBoard` 가 이미 했다 — missPct>0 이면 기준을 넘긴 것이다.
   */
  const confusing = useMemo(
    () => [...rows].filter((r) => r.missPct > 0).sort((a, b) => b.missPct - a.missPct).slice(0, 3),
    [rows],
  );

  // 할 말이 없으면 섹션 제목까지 통째로 안 그린다 — 빈 카드 한 장도 사장 화면에서는 요소 하나다.
  const nothing =
    noOne.length === 0 && progress.every((p) => p.itemCount === 0) && dueSoon.length === 0 && confusing.length === 0;
  if (nothing) return null;

  return (
    <View style={{ gap: Space.sm }}>
      <SectionLabel title="퀴즈 현황" />

      {/* ② 아무도 모르는 노하우 — 사장이 나가면 그대로 끊기는 지식. 가장 행동 유발적인 숫자라 맨 위.
          앰버 배너로 쌓지 않는다(2026-08-04): 경고색이 브랜드 노랑과 섞여 화면 최대 면적을 먹었다.
          같은 흰 카드 안의 리스트로 내리고, 카드 전체를 눌러 2층의 '아무도 모름' 거르기로 간다. */}
      {noOne.length > 0 && (
        <Pressable
          onPress={() => onOpenFilter('no_one')}
          style={({ pressed }) => [tst.card, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`아무도 모르는 노하우 ${noOne.length}개 보기`}
        >
          <View style={tst.block}>
            <Text style={tst.blockTitle}>아직 아무도 모르는 노하우 {noOne.length}개</Text>
            <Text style={tst.blockMeta}>사장님이 자리를 비우면 그대로 끊기는 노하우예요.</Text>
          </View>
          {noOne.slice(0, 3).map((h) => (
            <View key={h.entryId} style={[tst.block, tst.blockTop]}>
              <Text style={tst.blockLine} numberOfLines={1}>{h.text}</Text>
              <Text style={tst.blockMeta} numberOfLines={1}>
                문제 {h.quizCount}개 · 직원 {staff.length}명 아직 확인 전
              </Text>
            </View>
          ))}
          <View style={[tst.moreRow, tst.blockTop]}>
            <Text style={tst.moreText}>
              {noOne.length > 3 ? `그리고 ${noOne.length - 3}개 더 · 전부 보기` : '전부 보기'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </View>
        </Pressable>
      )}

      {/* ① 코스별 이수 현황 — 활성 코스는 위 진행 링이 이미 말했다 */}
      {progress.some((p) => p.itemCount > 0) && (
        <View style={tst.card}>
          {progress
            .filter((p) => p.itemCount > 0)
            .map((p, i) => (
              <View key={p.course.id} style={[tst.block, i > 0 && tst.blockTop]}>
                <Text style={tst.blockTitle}>{p.course.name}</Text>
                {/* 통과자가 0이면 "0명 통과"를 쓰지 않는다(2026-08-04) — 같은 화면에서 0이 반복되면
                    아직 시작 안 한 매장이 '망가진 화면'으로 읽힌다. 1명이라도 생기면 숫자로 전환된다. */}
                <Text style={tst.blockLine}>
                  {p.passedNames.length === 0 ? (
                    '아직 시작 전'
                  ) : (
                    <>직원 {staff.length}명 중 <Text style={tst.strong}>{p.passedNames.length}명</Text> 통과</>
                  )}
                </Text>
                {p.pendingNames.length > 0 ? (
                  p.passedNames.length > 0 ? (
                    <Text style={tst.blockMeta} numberOfLines={2}>아직 안 끝난 직원 · {p.pendingNames.join(', ')}</Text>
                  ) : null
                ) : staff.length > 0 ? (
                  <Text style={[tst.blockMeta, { color: BrandColors.goodText }]}>전원 통과</Text>
                ) : (
                  <Text style={tst.blockMeta}>아직 직원이 없어요</Text>
                )}
              </View>
            ))}
        </View>
      )}

      {/* ③ 다시 확인할 때가 된 사람 */}
      {dueSoon.length > 0 && (
        <View style={tst.card}>
          {dueSoon.map((d, i) => (
            <View key={d.course.id} style={[tst.block, i > 0 && tst.blockTop]}>
              <Text style={tst.blockTitle}>{d.course.name}</Text>
              <Text style={tst.blockLine}>
                <Text style={tst.strong}>{d.count}명</Text> 다시 확인할 때가 됐어요
              </Text>
              <Text style={tst.blockMeta}>{d.course.due_days}일마다 다시 물어보는 퀴즈예요</Text>
            </View>
          ))}
        </View>
      )}

      {/* ⑤ 자주 틀리는 노하우 top 3 — 사람이 아니라 글을 고치라는 신호 */}
      {confusing.length > 0 && (
        <Pressable
          onPress={() => onOpenFilter('missed')}
          style={({ pressed }) => [tst.card, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`자주 틀리는 노하우 ${confusing.length}개 보기`}
        >
          <View style={tst.block}>
            <Text style={tst.blockTitle}>자주 틀리는 노하우</Text>
            <Text style={tst.blockMeta}>노하우가 헷갈리게 적혔을 수 있어요. 글을 다듬으면 오답이 줄어요.</Text>
          </View>
          {confusing.map((c) => (
            <View key={c.entryId} style={[tst.block, tst.blockTop]}>
              <Text style={tst.blockLine} numberOfLines={2}>{c.text}</Text>
              <Text style={tst.blockMeta}>오답률 {c.missPct}%</Text>
            </View>
          ))}
          <View style={[tst.moreRow, tst.blockTop]}>
            <Text style={tst.moreText}>전부 보기</Text>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </View>
        </Pressable>
      )}
    </View>
  );
}

const tst = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, ...Elevation.e2,
  },
  block: { paddingVertical: Space.sm + 2, gap: 2 },
  blockTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  blockTitle: { fontSize: 13, fontWeight: '800', color: InkColors.ink3 },
  blockLine: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22 },
  blockMeta: { fontSize: 13, color: InkColors.ink2, fontWeight: '600', lineHeight: 19 },
  strong: { fontWeight: '900', color: InkColors.ink },

  moreRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 48 },
  moreText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
});
