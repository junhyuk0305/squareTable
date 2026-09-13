/**
 * 퀴즈 설정 탭(2026-09-13 사장 요청) — 이름·주기·마감·**배포**를 한 자리에서 고치고 저장 하나로 반영한다.
 *
 * ★왜 탭인가: 전에는 이름·주기가 더보기(⋯) 안 시트였고, 받는 사람을 고치는 자리는 **아무 데도 없었다**
 *   (만들기 5단계에서 한 번 정하면 끝이고, 결과 탭의 '다시 알리기'만 사람을 늘릴 수 있었다).
 *   그래서 결과 탭에 설정이 섞여 있던 것을 갈라, 결과는 결과만 보고 고치는 일은 전부 여기로 모았다.
 *
 * ★배포 섹션은 **한쪽만** 보여준다(내부면 사람, 외부면 링크). 근거는 `training_courses.audience`(0200) —
 *   만들기 1단계의 답이 이제 저장된다. 아직 안 정한 퀴즈(만들던 것)는 여기서 고른다.
 *
 * ★"저장 = 배포"의 뜻을 좁게 못 박는다(서버가 할 수 있는 것만 말한다):
 *   · 새로 체크한 사람 → 오늘 날짜로 배정을 만든다(근무 시간·빈도 상한은 서버가 그대로 판정한다).
 *   · 체크를 푼 사람  → **아직 안 나간** 배정만 취소한다. 이미 받은 사람은 못 뺀다(잠금 + 사유 표기) —
 *     발송 기록은 빈도 상한의 근거라 지우면 "오늘 안 보냈다"가 되어 상한이 깨진다.
 *   · 마감(answer_days)을 바꾸면 **다음 발송부터** 적용된다. 이미 받은 사람의 마감은 받은 날 기준으로
 *     서버가 이미 박아 놨다(claim_quiz_send). 화면이 그걸 바꿀 수 있는 척하지 않는다.
 */
import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import {
  upsertTrainingCourse,
  insertQuizAssignments,
  cancelPendingQuizAssignmentsFor,
} from '@/lib/db';
import { todayKst } from '@/lib/quiz/schedule';
import { SectionLabel } from '@/components/SectionLabel';
import { QuizDeployPanel } from '@/components/owner/quiz/QuizDeployPanel';
import { PrimaryButton, qst } from '@/components/owner/quiz/kit';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizAssignment, TrainingCourse } from '@/lib/quiz/types';

/** 사장이 직접 정한 고정 주기 — 만들기(B5)·상세와 같은 값이어야 화면끼리 어긋나지 않는다. */
const CYCLES: { label: string; days: number | null }[] = [
  { label: '맡길래요', days: null },
  { label: '한 달마다', days: 30 },
  { label: '3개월마다', days: 90 },
  { label: '6개월마다', days: 180 },
];

/** 마감 선택지 — 달력 대신 칩이다. 이 자리에서 고치는 값은 '며칠 안에'(answer_days) 그 자체다. */
const DEADLINES: { label: string; days: number | null }[] = [
  { label: '마감 없음', days: null },
  { label: '3일 안에', days: 3 },
  { label: '7일 안에', days: 7 },
  { label: '14일 안에', days: 14 },
];

type Audience = 'staff' | 'guest';

export function QuizSettingsPanel({
  course,
  staff,
  sends,
  onSaved,
  onOpenResult,
}: {
  course: TrainingCourse;
  staff: { id: string; name: string }[];
  /** 이 퀴즈의 발송 원장 — 누가 이미 받았나(잠금 판정)와 현재 체크 상태의 출처. */
  sends: QuizAssignment[];
  /** 저장이 끝난 뒤 — 코스·발송 원장을 다시 읽는다. */
  onSaved: () => void;
  onOpenResult: (submissionId: string) => void;
}) {
  const [name, setName] = useState(course.name);
  const [cycle, setCycle] = useState<number | null>(course.due_days ?? null);
  const [deadline, setDeadline] = useState<number | null>(course.answer_days ?? null);
  const [audience, setAudience] = useState<Audience | null>(course.audience ?? null);
  const [busy, setBusy] = useState(false);

  // 이미 나간 사람 = 뺄 수 없는 사람(서버가 pending 만 지운다). 원장 그대로 읽는다.
  const sentIds = useMemo(() => new Set(sends.filter((a) => !!a.sentAt).map((a) => a.userId)), [sends]);
  const ledgerIds = useMemo(() => new Set(sends.map((a) => a.userId)), [sends]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sends.map((a) => a.userId)));

  /*
   * 폼 초기값은 위 useState 초기자 하나뿐이다 — 이펙트로 다시 실어 넣지 않는다.
   * ① 이펙트 안 동기 setState 는 연쇄 렌더를 만든다(이 저장소 lint 규칙이 막는다).
   * ② 저장 뒤 부모가 코스·원장을 다시 읽으면 prop 이 바뀌는데, 그때 폼을 덮어쓰면
   *    사장이 방금 손댄 다른 칸이 되돌아간다.
   * 다른 퀴즈로 이동해 폼을 통째로 비워야 하는 경우는 **부모가 `key={course.id}` 로** 처리한다
   * (React 가 새로 마운트하므로 초기자가 다시 돈다 — 상태 되돌리기 로직을 둘 필요가 없다).
   */

  const toggle = (uid: string) => {
    if (sentIds.has(uid)) return; // 이미 받은 사람은 못 뺀다
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const added = useMemo(() => [...picked].filter((id) => !ledgerIds.has(id)), [picked, ledgerIds]);
  const removed = useMemo(
    () => [...ledgerIds].filter((id) => !picked.has(id) && !sentIds.has(id)),
    [ledgerIds, picked, sentIds],
  );

  const nameChanged = name.trim() !== '' && name.trim() !== course.name;
  const metaChanged =
    nameChanged ||
    cycle !== (course.due_days ?? null) ||
    deadline !== (course.answer_days ?? null) ||
    audience !== (course.audience ?? null);
  const peopleChanged = audience === 'staff' && (added.length > 0 || removed.length > 0);
  const dirty = metaChanged || peopleChanged;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    let ok = true;
    if (metaChanged) {
      ok = await guardWrite(
        upsertTrainingCourse({
          ...course,
          name: name.trim() || course.name,
          due_days: cycle,
          answer_days: deadline,
          audience,
        }),
        () => {},
        '저장하지 못했어요.',
      );
    }
    if (ok && peopleChanged) {
      if (added.length > 0) {
        ok = await guardWrite(
          insertQuizAssignments(course.id, added, todayKst()),
          () => {},
          '받는 사람을 추가하지 못했어요.',
        );
      }
      if (ok && removed.length > 0) {
        ok = await guardWrite(
          cancelPendingQuizAssignmentsFor(course.id, removed),
          () => {},
          '받는 사람을 빼지 못했어요.',
        );
      }
    }
    setBusy(false);
    if (!ok) return;
    onSaved();
    // 무엇이 일어났는지 그대로 말한다 — "저장했어요"만 뜨면 사람이 늘었는지 모른다.
    showToast(
      added.length > 0
        ? `${added.length}명에게 근무 시간에 맞춰 보낼게요`
        : removed.length > 0
          ? '아직 안 나간 배정을 취소했어요'
          : '저장했어요',
      'good',
    );
  };

  return (
    <View style={s.wrap}>
      {/* ── 이름 ─────────────────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={qst.fieldLabel}>퀴즈 이름</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={qst.input}
          placeholder="예) 마감 점검"
          placeholderTextColor={InkColors.ink3}
          maxLength={40}
          returnKeyType="done"
        />
      </View>

      {/* ── 다시 확인 주기 ───────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={qst.fieldLabel}>다시 확인</Text>
        <Text style={qst.fieldHint}>이미 통과한 사람은 그대로예요. 다음 확인부터 바뀐 주기로 돌아가요.</Text>
        <View style={qst.chipWrap}>
          {CYCLES.map((c) => {
            const on = cycle === c.days;
            return (
              <Pressable
                key={c.label}
                onPress={() => setCycle(c.days)}
                style={[qst.chip, on && qst.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={c.label}
              >
                <Text style={[qst.chipText, on && qst.chipTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── 마감 ─────────────────────────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={qst.fieldLabel}>언제까지 풀까요</Text>
        <Text style={qst.fieldHint}>받은 날부터 세요. 바꾸면 다음 발송부터 적용돼요 — 이미 받은 사람의 마감은 그대로예요.</Text>
        <View style={qst.chipWrap}>
          {DEADLINES.map((d) => {
            const on = deadline === d.days;
            return (
              <Pressable
                key={d.label}
                onPress={() => setDeadline(d.days)}
                style={[qst.chip, on && qst.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={d.label}
              >
                <Text style={[qst.chipText, on && qst.chipTextOn]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── 배포 ─────────────────────────────────────────────────────────── */}
      <SectionLabel icon="send-outline" title="배포" />
      {audience == null ? (
        <View style={s.card}>
          <Text style={qst.fieldLabel}>누구에게 낼 퀴즈예요?</Text>
          <Text style={qst.fieldHint}>고르면 그 방식만 보여줘요. 우리 직원은 앱으로, 외부 사람은 링크로 받아요.</Text>
          <View style={qst.chipWrap}>
            <Pressable
              onPress={() => setAudience('staff')}
              style={qst.chip}
              accessibilityRole="button"
              accessibilityLabel="우리 직원"
            >
              <Text style={qst.chipText}>우리 직원</Text>
            </Pressable>
            <Pressable
              onPress={() => setAudience('guest')}
              style={qst.chip}
              accessibilityRole="button"
              accessibilityLabel="외부 사람"
            >
              <Text style={qst.chipText}>외부 사람</Text>
            </Pressable>
          </View>
        </View>
      ) : audience === 'staff' ? (
        <View style={s.card}>
          <Text style={qst.fieldLabel}>받는 사람</Text>
          <Text style={qst.fieldHint}>
            체크하고 저장하면 근무 시간에 맞춰 나가요. 이미 받은 사람은 뺄 수 없어요.
          </Text>
          {staff.length === 0 ? (
            <Text style={s.emptyText}>아직 합류한 직원이 없어요.</Text>
          ) : (
            <View style={s.people}>
              {staff.map((p) => {
                const on = picked.has(p.id);
                const locked = sentIds.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => toggle(p.id)}
                    disabled={locked}
                    style={[s.person, on && s.personOn, locked && s.personLocked]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: locked }}
                    accessibilityLabel={locked ? `${p.name} 이미 받았어요` : p.name}
                  >
                    <View style={[s.check, on && s.checkOn]}>
                      {on ? <Ionicons name="checkmark" size={13} color={InkColors.bubbleText} /> : null}
                    </View>
                    <Text style={s.personName} numberOfLines={1}>{p.name}</Text>
                    {locked ? <Text style={s.lockText}>이미 받았어요</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          {removed.length > 0 ? (
            <Text style={s.warnText}>{removed.length}명의 아직 안 나간 배정을 취소해요.</Text>
          ) : null}
        </View>
      ) : (
        // 외부 사람 — 링크만. 패널이 링크 목록·복사·기간·회수와 '이 링크로 푼 사람'을 그대로 맡는다.
        <QuizDeployPanel course={course} onOpenResult={onOpenResult} />
      )}

      {/* 저장 — 이 탭의 주 액션 하나. 바뀐 게 없으면 누를 수 없다(누를 수 있는데 아무 일도 없는 버튼 금지). */}
      <View style={s.foot}>
        <PrimaryButton
          label={busy ? '저장하는 중…' : added.length > 0 ? `저장하고 ${added.length}명에게 보내기` : '저장'}
          disabled={!dirty || busy}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: Space.md },
  card: {
    gap: Space.xs,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.md,
    ...Elevation.e1,
  },
  people: { gap: Space.xs, marginTop: Space.xs },
  person: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48,
    paddingHorizontal: Space.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  personOn: { borderColor: InkColors.ink2 },
  personLocked: { backgroundColor: InkColors.bgSoft },
  check: {
    width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: InkColors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.paper,
  },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  personName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  lockText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  emptyText: { fontSize: 14, fontWeight: '600', color: InkColors.ink3, paddingVertical: Space.sm },
  warnText: { fontSize: 12.5, fontWeight: '700', color: BrandColors.warnText, marginTop: Space.xs },
  foot: { paddingTop: Space.xs },
});
