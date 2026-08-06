/**
 * 퀴즈 현황 — /owner/training 안의 섹션. **새 라우트를 만들지 않는다**(IA 정본).
 *
 * 전부 이미 있는 데이터로만 계산한다: course_entries(0111) · knowhow_understanding(0111) ·
 * training_courses · knowhow_quiz_stats(0103) · quiz_items.
 *
 * ★ 개인별 오답 이력은 만들지 않는다. knowhow_quiz_stats 에 staff_id 가 없는 건 의도된 설계다(0103).
 *   여기서 보이는 개인 정보는 "이수 여부"뿐이고, 오답·소요시간은 만들지도 보여주지도 않는다.
 */

import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import type { CourseEntryRow, UnderstandingRow } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { SectionLabel } from '@/components/SectionLabel';

/** 오답 잦음 판정(0103) — training.tsx 와 같은 임계를 쓴다. 바꿀 땐 두 곳을 같이 바꾼다. */
const QUIZ_MISS_MIN_ATTEMPTS = 5;
const QUIZ_MISS_RATE = 0.4;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InsightHole = { entryId: string; text: string; courseName: string };

export function TrainingInsights({
  courses,
  excludeEntryIds,
  riskOf,
  courseEntries,
  entryTitleOf,
  understanding,
  staff,
  quizStats,
  quizCountOf,
  now,
  onFixHole,
}: {
  /**
   * ★ 지금 보고 있는 코스는 빼고 넘긴다(호출부에서 필터). 위 목록이 이미 말한 업무를
   * 같은 이름·같은 이유로 또 보여주면 중복이다. 코스가 하나뿐이면 호출부가 아예 안 그린다.
   */
  courses: TrainingCourse[];
  /** 활성 코스에서 이미 다룬 노하우 — '자주 틀리는 노하우'에서 뺀다. */
  excludeEntryIds: Set<string>;
  /** 이 노하우를 얼마나 먼저 손봐야 하나(높을수록 먼저). 판정은 코드가 한다 — 사장 입력 없음. */
  riskOf: (entryId: string, preset?: string | null) => number;
  courseEntries: CourseEntryRow[];
  entryTitleOf: (entryId: string) => string | undefined;
  understanding: UnderstandingRow[];
  staff: { id: string; name: string }[];
  quizStats: Record<string, { attempts: number; misses: number }>;
  /** 그 노하우에 붙은 '나가는' 문항 수(보관 제외). */
  quizCountOf: (entryId: string) => number;
  now: number;
  onFixHole: (hole: InsightHole) => void;
}) {
  // ── ④ 문항 재고 — 코스에 담겼는데 문항이 0개인 노하우. 퀴즈가 실제로 작동 안 하는 구멍이라 맨 위에 둔다.
  // 정렬은 riskOf 가 정한다(사고 나는 자리부터). 이 줄은 사장이 순서를 정한 적이 없는 '할 일'이라
  // 재정렬해도 잃는 뜻이 없다 — 반대로 위 목록의 position 은 직원이 배우는 순서라 건드리지 않는다.
  const holes = useMemo(() => {
    const seen = new Set<string>();
    const out: (InsightHole & { score: number })[] = [];
    for (const c of courses) {
      for (const row of courseEntries.filter((e) => e.courseId === c.id)) {
        if (seen.has(row.entryId)) continue;
        if (quizCountOf(row.entryId) > 0) continue;
        const title = entryTitleOf(row.entryId);
        if (!title) continue;
        seen.add(row.entryId);
        out.push({ entryId: row.entryId, text: title, courseName: c.name, score: riskOf(row.entryId, c.preset) });
      }
    }
    // 동점은 제목으로 갈라 매번 같은 순서가 나오게 한다(결정적).
    return out.sort((a, b) => (b.score - a.score) || a.text.localeCompare(b.text, 'ko'));
  }, [courses, courseEntries, quizCountOf, entryTitleOf, riskOf]);

  // ── ① 코스별 이수 현황 — 그 코스의 노하우를 전부 확인한 직원 수. 점수가 아니라 도달 여부만 센다.
  const progress = useMemo(
    () =>
      courses.map((c) => {
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
    [courses, courseEntries, staff, understanding, now],
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

  // ── ② 헷갈리는 노하우 top 3 — 개인 비난이 아니라 "노하우가 헷갈리게 적혔을 수 있어요" 신호(0103).
  const confusing = useMemo(
    () =>
      Object.entries(quizStats)
        // 활성 코스에서 이미 행 캡션이 오답률을 말한 노하우는 여기서 반복하지 않는다.
        .filter(([entryId]) => !excludeEntryIds.has(entryId))
        .filter(([, s]) => s.attempts >= QUIZ_MISS_MIN_ATTEMPTS && s.misses / s.attempts >= QUIZ_MISS_RATE)
        .map(([entryId, s]) => ({ entryId, pct: Math.round((s.misses / s.attempts) * 100), title: entryTitleOf(entryId) }))
        .filter((x) => !!x.title)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3),
    [quizStats, entryTitleOf, excludeEntryIds],
  );

  // 할 말이 없으면 섹션 제목까지 통째로 안 그린다 — 빈 카드 한 장도 사장 화면에서는 요소 하나다.
  const nothing = holes.length === 0 && progress.every((p) => p.itemCount === 0) && dueSoon.length === 0 && confusing.length === 0;
  if (nothing) return null;

  return (
    <View style={{ gap: Space.sm }}>
      <SectionLabel title="다른 퀴즈 현황" />

      {/* ④ 문항 재고 — 가장 중요. 다만 앰버 배너로 쌓지 않는다(2026-08-04):
          경고 앰버가 브랜드 노랑과 섞여 화면 최대 면적을 먹었고, 위의 업무 목록과 정보가 겹쳤다.
          같은 흰 카드 안의 리스트로 내리고, 행 전체를 눌러 문제를 만들러 간다. */}
      {holes.length > 0 && (
        <View style={tst.card}>
          <View style={tst.block}>
            <Text style={tst.blockTitle}>문제가 없는 노하우 {holes.length}개</Text>
          </View>
          {holes.slice(0, 5).map((h) => (
            <Pressable
              key={h.entryId}
              onPress={() => onFixHole(h)}
              style={({ pressed }) => [tst.holeRow, tst.blockTop, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${h.text} 문제 만들기`}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={tst.holeRowText} numberOfLines={1}>{h.text}</Text>
                <Text style={tst.holeRowMeta} numberOfLines={1}>{h.courseName}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          ))}
          {holes.length > 5 ? (
            <View style={[tst.block, tst.blockTop]}>
              <Text style={tst.blockMeta}>그리고 {holes.length - 5}개 더 있어요</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* ① 코스별 이수 현황 */}
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

      {/* ② 헷갈리는 노하우 top 3 — 사람이 아니라 글을 고치라는 신호 */}
      {confusing.length > 0 && (
        <View style={tst.card}>
          <View style={tst.block}>
            <Text style={tst.blockTitle}>자주 틀리는 노하우</Text>
            <Text style={tst.blockMeta}>노하우가 헷갈리게 적혔을 수 있어요. 글을 다듬으면 오답이 줄어요.</Text>
          </View>
          {confusing.map((c) => (
            <View key={c.entryId} style={[tst.block, tst.blockTop]}>
              <Text style={tst.blockLine} numberOfLines={2}>{c.title}</Text>
              <Text style={tst.blockMeta}>오답률 {c.pct}%</Text>
            </View>
          ))}
        </View>
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

  holeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48,
    paddingVertical: Space.sm,
  },
  holeRowText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  holeRowMeta: { fontSize: 12, color: InkColors.ink2, fontWeight: '600', marginTop: 1 },
});
