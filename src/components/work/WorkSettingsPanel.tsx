import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Appear } from '@/components/Appear';
import { Vanish } from '@/components/Vanish';
import { resolveDayparts, sanitizeDayparts, newDaypart, newRoutine, type Daypart } from '@/lib/store/daypartLabels';
import { TaskComposerModal } from '@/components/work/TaskComposerModal';
import type { Member } from '@/components/work/MentionInput';
import { todayStr } from '@/lib/utils/attendance';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 업무 설정 — 업무 카테고리(데이파트) + 카테고리별 루틴 업무 + 루틴 담당자. 사장·매니저 전용.
 * 매장 공유 설정(schedule_config.dayparts)이라 직원 화면·모든 채팅방에 같은 내용이 반영된다.
 *
 * (2026-08-12) 바텀시트 `DaypartSettingsSheet` + 담당자별 보드 `AssignBoard` 를 이 한 화면으로 합쳤다.
 *  · 둘은 같은 것을 두 번 만지는 자리였다 — 루틴의 정의는 카테고리 설정에, 그 루틴의 담당은 보드에 있었다.
 *  · 시트는 카테고리 4개 × 루틴 4개면 입력칸 20개가 한 번에 쏟아졌다 → **2단 드릴다운**으로 끊는다.
 *    1단 = 카테고리 목록(이름·루틴 수·순서) / 2단 = 그 카테고리의 루틴과 담당자.
 *
 * 로컬 편집(items) → '저장'에서 sanitizeDayparts(이름 없는 카테고리·빈 루틴 정리) 후 한 번에 반영.
 * 카테고리를 지워도 그 카테고리의 기존 할일은 사라지지 않는다 — 할일 화면의 '기타' 그룹이 흡수한다.
 */
export function WorkSettingsPanel({
  members,
  me,
  onSaved,
}: {
  /** 담당자 후보(사장 포함 매장 명부). 루틴 편집 시트가 그대로 받으므로 Member 전체를 받는다. */
  members: Member[];
  me: string;
  /** 저장 완료 → 할일 화면으로 복귀(시트 시절의 '저장하면 닫힌다'와 같은 심성모형). */
  onSaved: () => void;
}) {
  const dayparts = useScheduleStore((s) => s.config.dayparts);
  const setConfig = useScheduleStore((s) => s.setConfig);
  const templates = useWorkStore((s) => s.templates);

  const [items, setItems] = useState<Daypart[]>(() => resolveDayparts(dayparts));
  const [openId, setOpenId] = useState<string | null>(null); // null = 1단(카테고리 목록)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null); // 사라짐 애니메이션 중인 루틴 id

  const taskCountFor = (id: string) => templates.filter((t) => t.section === id).length;
  const nameOf = (id: string) => (id === me ? '나' : members.find((m) => m.id === id)?.name ?? '직원');

  const openIdx = items.findIndex((d) => d.id === openId);
  const open = openIdx >= 0 ? items[openIdx] : null;

  // ── 카테고리 편집 ──
  const setLabel = (i: number, v: string) => setItems((p) => p.map((d, idx) => (idx === i ? { ...d, label: v } : d)));
  const move = (i: number, dir: -1 | 1) =>
    setItems((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = p.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addDaypart = () => {
    const d = newDaypart();
    setItems((p) => [...p, d]);
    setOpenId(d.id); // 새 카테고리는 곧바로 이름·루틴을 적는 자리로 들어간다(빈 행만 남는 것 방지).
  };
  const removeDaypart = (id: string) => {
    setItems((p) => p.filter((d) => d.id !== id));
    setConfirmDelete(null);
    setOpenId(null);
  };

  // ── 루틴 편집(2단) ──
  const patchOpen = (fn: (d: Daypart) => Daypart) => setItems((p) => p.map((d, idx) => (idx === openIdx ? fn(d) : d)));
  const removeRoutine = (ri: number) => patchOpen((d) => ({ ...d, routines: d.routines.filter((_, k) => k !== ri) }));

  /**
   * 루틴 편집기 — null 이면 닫힘. `at: -1` = 새로 추가.
   * 예전엔 제목만 인라인 한 줄이었고(설명·시간을 적을 자리가 없었다), 칸을 그냥 늘리면
   * 루틴 4개짜리 카테고리에서 입력칸이 12개로 쏟아진다. 그래서 **할일 추가와 같은 시트**로 옮겼다.
   */
  const [routineEdit, setRoutineEdit] = useState<{ at: number } | null>(null);
  const editingRoutine = routineEdit && routineEdit.at >= 0 ? open?.routines[routineEdit.at] : undefined;

  const saveRoutine = (d: { text: string; description?: string; remindAt?: string; assigneeId?: string }) => {
    if (!routineEdit) return;
    // 빈 값은 키를 만들지 않는다 — sanitizeDayparts 가 저장하는 모양과 같게 유지한다(qa:daypart 진리표).
    const next = {
      text: d.text,
      ...(d.description ? { description: d.description } : null),
      ...(d.remindAt ? { remindAt: d.remindAt } : null),
      ...(d.assigneeId ? { assigneeId: d.assigneeId } : null),
    };
    patchOpen((dp) =>
      routineEdit.at < 0
        ? { ...dp, routines: [...dp.routines, { ...newRoutine(), ...next }] }
        : { ...dp, routines: dp.routines.map((r, k) => (k === routineEdit.at ? { id: r.id, ...next } : r)) },
    );
    setRoutineEdit(null);
  };

  const save = () => {
    // setConfig 는 결과를 돌려주지만 실패 배너·롤백은 guardWrite 가 처리한다.
    void setConfig({ dayparts: sanitizeDayparts(items) });
    onSaved();
  };
  // 담당자 칩은 루틴 편집 시트(TaskComposerModal)가 그린다 — 여기서 다시 만들지 않는다.

  return (
    <View style={s.wrap}>
      {open ? (
        // ── 2단: 이 카테고리의 루틴 업무 ──────────────────────────
        <>
          <Pressable onPress={() => setOpenId(null)} style={({ pressed }) => [s.backRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Ionicons name="chevron-back" size={17} color={InkColors.ink2} />
            <Text style={s.backText}>업무 카테고리</Text>
          </Pressable>

          <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
            <Text style={s.fieldLabel}>카테고리 이름</Text>
            <TextInput
              value={open.label}
              onChangeText={(v) => setLabel(openIdx, v)}
              placeholder="오픈"
              placeholderTextColor={InkColors.ink3}
              style={s.labelInp}
              maxLength={12}
            />

            <Text style={[s.fieldLabel, { marginTop: Space.lg }]}>루틴 업무</Text>
            <Text style={s.fieldHint}>여기 적어두면 매일 할일에 자동으로 떠요. 담당자를 고르면 이름이 붙고, 다른 사람도 그대로 볼 수 있어요.</Text>

            {open.routines.length === 0 && <Text style={s.empty}>아직 루틴 업무가 없어요. 매일 하는 일을 적어보세요.</Text>}

            {open.routines.map((r, ri) => (
              <Vanish key={r.id} hidden={leaving === r.id} onDone={() => { removeRoutine(ri); setLeaving(null); }} style={s.routineCard}>
                <View style={s.routineHead}>
                  <View style={s.bullet} />
                  {/* 행 전체가 '고치기' 버튼 — 제목·설명·시간·담당을 시트에서 한 번에 짓는다. */}
                  <Pressable
                    onPress={() => setRoutineEdit({ at: ri })}
                    style={({ pressed }) => [s.routineMain, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.text || '이름 없는 루틴'} 수정`}
                  >
                    <Text style={[s.routineText, !r.text && s.routineTextEmpty]} numberOfLines={1}>
                      {r.text || '이름 없는 루틴'}
                    </Text>
                    {/* 무엇이 설정돼 있는지 한 줄 요약 — 시트를 열지 않고도 보인다. */}
                    <Text style={s.routineMeta} numberOfLines={1}>
                      {[
                        r.remindAt ?? null,
                        r.assigneeId ? `담당 ${nameOf(r.assigneeId)}` : null,
                        r.description?.trim() ? r.description.trim() : null,
                      ].filter(Boolean).join(' · ') || '설명·시간 없음'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => setLeaving(r.id)} hitSlop={6} style={s.iconBtn} accessibilityRole="button" accessibilityLabel={`${r.text || '이름 없는 루틴'} 삭제`}>
                    <Ionicons name="close" size={16} color={InkColors.ink3} />
                  </Pressable>
                </View>
              </Vanish>
            ))}

            <Pressable onPress={() => setRoutineEdit({ at: -1 })} style={({ pressed }) => [s.addDashed, pressed && { opacity: 0.7 }]}>
              <Ionicons name="add" size={16} color={InkColors.ink} />
              <Text style={s.addDashedText}>루틴 업무 추가</Text>
            </Pressable>

            {confirmDelete === open.id ? (
              <View style={s.confirmBar}>
                <Text style={s.confirmText}>
                  ‘{open.label.trim() || '이 카테고리'}’를 삭제할까요?
                  {taskCountFor(open.id) > 0 ? ` 이 카테고리 할일 ${taskCountFor(open.id)}개는 ‘기타’로 모여요.` : ''}
                </Text>
                <View style={s.confirmBtns}>
                  <Pressable onPress={() => setConfirmDelete(null)} style={({ pressed }) => [s.cCancel, pressed && { opacity: 0.8 }]}>
                    <Text style={s.cCancelText}>그대로 두기</Text>
                  </Pressable>
                  <Pressable onPress={() => removeDaypart(open.id)} style={({ pressed }) => [s.cDel, pressed && { opacity: 0.85 }]}>
                    <Text style={s.cDelText}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setConfirmDelete(open.id)} style={({ pressed }) => [s.delRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                <Ionicons name="trash-outline" size={15} color={BrandColors.badText} />
                <Text style={s.delText}>이 카테고리 삭제</Text>
              </Pressable>
            )}
          </ScrollView>
        </>
      ) : (
        // ── 1단: 카테고리 목록 ────────────────────────────────────
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
          <Text style={s.lead}>매장 흐름에 맞게 업무 카테고리를 짜고, 카테고리마다 매일 하는 루틴 업무와 담당자를 정해요. 매장 전체에 공통 적용돼요.</Text>

          <View style={s.list}>
            {items.map((d, i) => (
              <Appear key={d.id} delay={i * 30}>
                <View style={[s.row, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                  <Pressable onPress={() => setOpenId(d.id)} style={({ pressed }) => [s.rowMain, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{d.label.trim() || '이름 없는 카테고리'}</Text>
                      <Text style={s.rowMeta}>
                        {d.routines.length === 0 ? '루틴 업무 없음' : `루틴 업무 ${d.routines.length}개`}
                        {d.routines.some((r) => r.assigneeId) ? ` · 담당 ${d.routines.filter((r) => r.assigneeId).length}개` : ''}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={s.orderBtns}>
                    <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={s.iconBtn} accessibilityLabel="위로">
                      <Ionicons name="chevron-up" size={20} color={i === 0 ? InkColors.line : InkColors.ink2} />
                    </Pressable>
                    <Pressable onPress={() => move(i, 1)} disabled={i === items.length - 1} hitSlop={6} style={s.iconBtn} accessibilityLabel="아래로">
                      <Ionicons name="chevron-down" size={20} color={i === items.length - 1 ? InkColors.line : InkColors.ink2} />
                    </Pressable>
                  </View>
                </View>
              </Appear>
            ))}
          </View>

          <Pressable onPress={addDaypart} style={({ pressed }) => [s.addDashed, pressed && { opacity: 0.7 }]}>
            <Ionicons name="add" size={16} color={InkColors.ink} />
            <Text style={s.addDashedText}>카테고리 추가</Text>
          </Pressable>
        </ScrollView>
      )}

      <View style={s.foot}>
        <Pressable onPress={save} style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}>
          <Text style={s.saveText}>저장</Text>
        </Pressable>
      </View>

      {/* 루틴 편집 — 할일 추가와 같은 시트를 '루틴 모드'로 쓴다. 루틴에 없는 칸(언제·카테고리·노하우)은 감춰진다. */}
      {routineEdit && open && (
        <TaskComposerModal
          routineMode
          routineSectionLabel={open.label.trim() || '이 카테고리'}
          onSubmitRoutine={saveRoutine}
          onClose={() => setRoutineEdit(null)}
          // 루틴을 TaskTemplate 모양으로 싸서 넘긴다 — 컴포저의 프리필 경로를 그대로 재사용한다.
          editTemplate={
            editingRoutine
              ? {
                  id: editingRoutine.id,
                  section: open.id,
                  text: editingRoutine.text,
                  ...(editingRoutine.description ? { description: editingRoutine.description } : null),
                  ...(editingRoutine.remindAt ? { remindAt: editingRoutine.remindAt } : null),
                  ...(editingRoutine.assigneeId ? { ownerId: editingRoutine.assigneeId } : null),
                  scope: 'shared' as const,
                }
              : undefined
          }
          // 루틴 모드에선 안 쓰이는 경로들 — 시그니처를 채우기 위한 no-op.
          onSubmit={() => {}}
          isOwner
          me={me}
          today={todayStr()}
          members={members}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { flex: 1 },
  scrollPad: { paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.xl },

  lead: { fontSize: 13, color: InkColors.ink2, lineHeight: 19, marginBottom: Space.lg },

  // 1단 — 카테고리 행
  list: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: InkColors.line },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.lg, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  rowMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  orderBtns: { flexDirection: 'row', alignItems: 'center' },

  // 2단 — 헤더/필드
  backRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.lg, paddingVertical: Space.md },
  backText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  fieldLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, marginBottom: Space.sm },
  fieldHint: { fontSize: 12.5, color: InkColors.ink3, lineHeight: 18, marginBottom: Space.md },
  empty: { fontSize: 13, color: InkColors.ink3, lineHeight: 19, marginBottom: Space.md },
  labelInp: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
    fontSize: 15,
    fontWeight: '700',
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },

  // 2단 — 루틴 카드(텍스트 + 담당자 칩)
  routineCard: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: '#FFFFFF',
    padding: Space.md,
    marginBottom: Space.sm,
  },
  routineHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  routineMain: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', gap: 1 },
  routineText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  routineTextEmpty: { color: InkColors.ink3, fontWeight: '600' },
  routineMeta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  bullet: { width: 5, height: 5, borderRadius: Radius.pill, backgroundColor: InkColors.ink3 },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  chipRow: { gap: Space.xs, paddingTop: Space.sm },
  chip: { paddingHorizontal: Space.md, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  chipOn: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.gold },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.ink, fontWeight: '800' },

  addDashed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: InkColors.ink3,
    borderRadius: Radius.md,
    paddingVertical: Space.md,
    marginTop: Space.md,
  },
  addDashedText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },

  delRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, paddingVertical: Space.lg, marginTop: Space.md },
  delText: { fontSize: 13, fontWeight: '800', color: BrandColors.badText },
  confirmBar: { marginTop: Space.lg, padding: Space.md, borderRadius: Radius.sm, backgroundColor: BrandColors.badSoft, borderWidth: 1, borderColor: BrandColors.bad },
  confirmText: { fontSize: 12.5, color: BrandColors.badText, fontWeight: '700', lineHeight: 18 },
  confirmBtns: { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm, justifyContent: 'flex-end' },
  cCancel: { paddingHorizontal: Space.lg, paddingVertical: Space.sm, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  cCancelText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  cDel: { paddingHorizontal: Space.lg, paddingVertical: Space.sm, borderRadius: Radius.sm, backgroundColor: BrandColors.badSolid },
  cDelText: { fontSize: 12.5, fontWeight: '800', color: '#FFFFFF' },

  foot: { paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.lg, borderTopWidth: 1, borderTopColor: InkColors.line, backgroundColor: InkColors.cream },
  saveBtn: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: Space.lg, alignItems: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
