/**
 * 훈련 현황 — /owner/training 안의 섹션. **새 라우트를 만들지 않는다**(IA 정본).
 *
 * 전부 이미 있는 데이터로만 계산한다: training_items · understanding · training_courses ·
 * knowhow_quiz_stats(0103) · quiz_items.
 *
 * ★ 개인별 오답 이력은 만들지 않는다. knowhow_quiz_stats 에 staff_id 가 없는 건 의도된 설계다(0103).
 *   여기서 보이는 개인 정보는 "이수 여부"뿐이고, 점수·오답·소요시간은 만들지도 보여주지도 않는다.
 */

import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import type { TrainingItemRow, UnderstandingRow } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { SectionLabel } from '@/components/SectionLabel';

/** 오답 잦음 판정(0103) — training.tsx 와 같은 임계를 쓴다. 바꿀 땐 두 곳을 같이 바꾼다. */
const QUIZ_MISS_MIN_ATTEMPTS = 5;
const QUIZ_MISS_RATE = 0.4;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InsightHole = { templateId: string; text: string; courseName: string };

export function TrainingInsights({
  courses,
  training,
  taskTextOf,
  entryIdsOf,
  entryTitleOf,
  understanding,
  staff,
  quizStats,
  quizCountOf,
  now,
  onFixHole,
}: {
  courses: TrainingCourse[];
  training: TrainingItemRow[];
  taskTextOf: (templateId: string) => string | undefined;
  entryIdsOf: (templateId: string) => string[];
  entryTitleOf: (entryId: string) => string | undefined;
  understanding: UnderstandingRow[];
  staff: { id: string; name: string }[];
  quizStats: Record<string, { attempts: number; misses: number }>;
  /** 그 노하우에 붙은 '나가는' 문항 수(보관 제외). */
  quizCountOf: (entryId: string) => number;
  now: number;
  onFixHole: (hole: InsightHole) => void;
}) {
  // ── ④ 문항 재고 — 코스에 담겼는데 문항이 0개인 업무. 훈련이 실제로 작동 안 하는 구멍이라 맨 위에 둔다.
  const holes = useMemo(() => {
    const seen = new Set<string>();
    const out: InsightHole[] = [];
    for (const c of courses) {
      for (const row of training.filter((t) => t.course === c.key)) {
        if (seen.has(row.templateId)) continue;
        const ids = entryIdsOf(row.templateId);
        const count = ids.reduce((n, id) => n + quizCountOf(id), 0);
        if (count > 0) continue;
        seen.add(row.templateId);
        out.push({ templateId: row.templateId, text: taskTextOf(row.templateId) ?? '업무', courseName: c.name });
      }
    }
    return out;
  }, [courses, training, entryIdsOf, quizCountOf, taskTextOf]);

  // ── ① 코스별 이수 현황 — 그 코스의 업무를 전부 확인한 직원 수. 점수가 아니라 도달 여부만 센다.
  const progress = useMemo(
    () =>
      courses.map((c) => {
        const items = training.filter((t) => t.course === c.key);
        const passedNames: string[] = [];
        const pendingNames: string[] = [];
        for (const p of staff) {
          const done = items.length > 0 && items.every((it) => {
            const row = understanding.find((u) => u.templateId === it.templateId && u.staffId === p.id);
            if (!row) return false;
            if (!c.due_days) return true;
            const t = Date.parse(row.verifiedAt);
            return Number.isFinite(t) && now - t <= c.due_days * DAY_MS;
          });
          (done ? passedNames : pendingNames).push(p.name);
        }
        return { course: c, itemCount: items.length, passedNames, pendingNames };
      }),
    [courses, training, staff, understanding, now],
  );

  // ── ③ 다시 확인할 때가 된 사람 — 주기가 있는 코스에서 마지막 확인이 주기를 넘긴 직원 수.
  const dueSoon = useMemo(
    () =>
      courses
        .filter((c) => !!c.due_days)
        .map((c) => {
          const items = training.filter((t) => t.course === c.key);
          const ids = new Set(items.map((i) => i.templateId));
          const staffIds = new Set<string>();
          for (const u of understanding) {
            if (!ids.has(u.templateId)) continue;
            const t = Date.parse(u.verifiedAt);
            if (!Number.isFinite(t) || now - t > (c.due_days as number) * DAY_MS) staffIds.add(u.staffId);
          }
          return { course: c, count: staffIds.size };
        })
        .filter((x) => x.count > 0),
    [courses, training, understanding, now],
  );

  // ── ② 헷갈리는 노하우 top 3 — 개인 비난이 아니라 "노하우가 헷갈리게 적혔을 수 있어요" 신호(0103).
  const confusing = useMemo(
    () =>
      Object.entries(quizStats)
        .filter(([, s]) => s.attempts >= QUIZ_MISS_MIN_ATTEMPTS && s.misses / s.attempts >= QUIZ_MISS_RATE)
        .map(([entryId, s]) => ({ entryId, pct: Math.round((s.misses / s.attempts) * 100), title: entryTitleOf(entryId) }))
        .filter((x) => !!x.title)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3),
    [quizStats, entryTitleOf],
  );

  const nothing = holes.length === 0 && progress.every((p) => p.itemCount === 0) && dueSoon.length === 0 && confusing.length === 0;

  return (
    <View style={{ gap: Space.sm }}>
      <SectionLabel title="퀴즈 현황" />

      {nothing ? (
        <View style={tst.card}>
          <Text style={tst.empty}>업무를 담고 문제를 만들면 여기에 현황이 쌓여요</Text>
        </View>
      ) : null}

      {/* ④ 문항 재고 — 가장 중요. 눈에 띄게 두고 누르면 바로 문제를 만들러 간다. */}
      {holes.length > 0 && (
        <View style={tst.holeCard}>
          <View style={tst.holeHead}>
            <Ionicons name="alert-circle-outline" size={16} color={BrandColors.warn} />
            <Text style={tst.holeTitle}>문제가 없는 업무 {holes.length}개</Text>
          </View>
          <Text style={tst.holeSub}>담겨 있지만 낼 문제가 없어서 직원에게 퀴즈가 안 나가요</Text>
          {holes.slice(0, 5).map((h) => (
            <Pressable
              key={h.templateId}
              onPress={() => onFixHole(h)}
              style={({ pressed }) => [tst.holeRow, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${h.text} 문제 만들기`}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={tst.holeRowText} numberOfLines={1}>{h.text}</Text>
                <Text style={tst.holeRowMeta} numberOfLines={1}>{h.courseName}</Text>
              </View>
              <Text style={tst.holeCta}>문제 만들기</Text>
            </Pressable>
          ))}
          {holes.length > 5 ? <Text style={tst.holeRowMeta}>그리고 {holes.length - 5}개 더 있어요</Text> : null}
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
                <Text style={tst.blockLine}>
                  직원 {staff.length}명 중 <Text style={tst.strong}>{p.passedNames.length}명</Text> 통과
                </Text>
                {p.pendingNames.length > 0 ? (
                  <Text style={tst.blockMeta} numberOfLines={2}>아직 안 끝난 직원 · {p.pendingNames.join(', ')}</Text>
                ) : staff.length > 0 ? (
                  <Text style={[tst.blockMeta, { color: BrandColors.good }]}>전원 통과</Text>
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
  empty: { fontSize: 15, color: InkColors.ink3, textAlign: 'center', paddingVertical: Space.md, lineHeight: 21 },

  holeCard: {
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.lg, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: Space.lg, paddingVertical: Space.md, gap: Space.xs,
  },
  holeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  holeTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  holeSub: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 21 },
  holeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48,
    borderTopWidth: 1, borderTopColor: BrandColors.warnBorder, paddingVertical: Space.sm,
  },
  holeRowText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  holeRowMeta: { fontSize: 12, color: InkColors.ink2, fontWeight: '600', marginTop: 1 },
  holeCta: { fontSize: 13, fontWeight: '800', color: InkColors.ink, textDecorationLine: 'underline' },
});
