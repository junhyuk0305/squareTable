/**
 * 훈련 종류(코스) — 기본 제공 프리셋으로 "바로 만들 수 있게 돕는" 온보딩 + 사장이 직접 만드는 코스.
 *
 * ★ 프리셋은 자동 생성이 아니다(계약 §3). 고르면 코스 행만 생기고, 어떤 업무를 담을지는
 *   사장이 추천 목록에서 체크해서 정한다. 자동으로 채우지 않는다.
 * ★ 새 라우트 0개 — 전부 이 화면 안의 카드/시트.
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import { PRESETS, PRESET_ORDER, recommendTemplates, type QuizPreset, type QuizPresetKey } from '@/lib/quiz/presets';
import { upsertTrainingCourse, deleteTrainingCourse } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

import { SheetHead, Chip, Field, TextField, IntField, PrimaryButton, GhostButton, ErrorNote, qst } from './kit';

/** 프리셋 한 건 — src/lib/quiz/presets.ts 가 SSOT. 여기서는 화면용 별칭만 둔다. */
export type CoursePreset = QuizPreset;

export const PRESET_LIST: CoursePreset[] = PRESET_ORDER.map((k) => PRESETS[k]);

/** 주기 선택지 — 자유 입력 대신 칩(복잡도 원칙). 코스별 due_days 에 들어간다. */
const DUE_OPTIONS = [
  { days: 7, label: '1주' },
  { days: 14, label: '2주' },
  { days: 30, label: '1달' },
  { days: 90, label: '3달' },
] as const;

export function dueLabel(days: number | null | undefined): string {
  if (!days) return '1회성';
  return DUE_OPTIONS.find((o) => o.days === days)?.label ?? `${days}일`;
}

// ────────────────────────────────────────────────────────────────────────────
// 1) 코스가 하나도 없을 때 — 프리셋 고르기
// ────────────────────────────────────────────────────────────────────────────

export function CoursePresetOnboarding({
  takenKeys,
  onPickPreset,
  onCustom,
}: {
  takenKeys: Set<string>;
  onPickPreset: (p: CoursePreset) => void;
  onCustom: () => void;
}) {
  const open = PRESET_LIST.filter((p) => !takenKeys.has(p.key));
  return (
    <View style={cst.onboard}>
      <Text style={cst.onboardLead}>어떤 퀴즈부터 만들까요</Text>
      <Text style={cst.onboardSub}>고르면 종류가 만들어지고, 담을 업무를 바로 골라요</Text>
      {open.map((p) => (
        <Pressable
          key={p.key}
          onPress={() => onPickPreset(p)}
          style={({ pressed }) => [cst.presetCard, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`${p.name} 만들기`}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={cst.presetName}>{p.name}</Text>
            <Text style={cst.presetDesc}>{p.description}</Text>
            <Text style={cst.presetMeta}>
              {p.min_items}~{p.max_items}개 · {p.due_days ? `${dueLabel(p.due_days)}마다 다시 확인` : '한 번 통과하면 끝'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
        </Pressable>
      ))}
      <GhostButton icon="add-circle-outline" label="직접 만들기" onPress={onCustom} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2) 코스 만들기 · 고치기 시트
// ────────────────────────────────────────────────────────────────────────────

export function CourseFormSheet({
  editing,
  preset,
  position,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** 있으면 고치기, 없으면 만들기. */
  editing?: TrainingCourse | null;
  /** 프리셋으로 만들 때. 이름·설명·상한의 기본값이 된다. */
  preset?: CoursePreset | null;
  position: number;
  onClose: () => void;
  onSaved: (course: TrainingCourse) => void;
  onDeleted?: (course: TrainingCourse) => void;
}) {
  const unitId = useSessionStore((s) => s.unitId);
  const [name, setName] = useState(editing?.name ?? preset?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? preset?.description ?? '');
  const [dueDays, setDueDays] = useState<number | null>(editing ? (editing.due_days ?? null) : (preset?.due_days ?? null));
  const [maxItems, setMaxItems] = useState(editing?.max_items ?? preset?.max_items ?? 5);
  const [minItems] = useState(editing?.min_items ?? preset?.min_items ?? 3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const nm = name.trim();
    if (!nm) {
      setErr('퀴즈 종류 이름을 적어 주세요.');
      return;
    }
    setBusy(true);
    const course: TrainingCourse = editing
      ? { ...editing, name: nm, description: description.trim() || null, due_days: dueDays, max_items: maxItems }
      : {
          id: genId('tc'),
          unit_id: unitId,
          // 프리셋 키는 그대로 쓴다 — 기존 first_day/regular 행이 같은 key 로 이어진다.
          key: preset?.key ?? genId('ct'),
          name: nm,
          description: description.trim() || null,
          preset: preset?.key ?? null,
          min_items: minItems,
          max_items: maxItems,
          due_days: dueDays,
          position,
          active: true,
        };
    const ok = await guardWrite(upsertTrainingCourse(course), () => {}, '퀴즈 종류 저장에 실패했어요.');
    setBusy(false);
    if (ok) {
      showToast(editing ? '퀴즈 종류를 고쳤어요' : `${nm}을(를) 만들었어요`, 'good');
      onSaved(course);
    }
  };

  const remove = async () => {
    if (!editing || busy) return;
    setBusy(true);
    const ok = await guardWrite(deleteTrainingCourse(editing.id), () => {}, '퀴즈 종류 삭제에 실패했어요.');
    setBusy(false);
    if (ok) {
      showToast('퀴즈 종류를 삭제했어요 · 업무와 노하우는 남아요', 'good');
      onDeleted?.(editing);
    }
  };

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '80%' }}>
      <SheetHead title={editing ? '퀴즈 종류 설정' : '퀴즈 종류 만들기'} onClose={onClose} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Field label="이름">
          <TextField value={name} onChange={setName} placeholder="예) 주말 마감조" maxLength={20} />
        </Field>
        <Field label="설명" hint="직원이 이 퀴즈를 왜 푸는지 한 줄로">
          <TextField value={description} onChange={setDescription} placeholder="예) 주말에만 오는 분들이 꼭 알아야 하는 것" maxLength={60} multiline />
        </Field>
        <Field label="다시 확인" hint={dueDays ? '정해둔 주기마다 다시 물어봐요' : '한 번 통과하면 다시 묻지 않아요'}>
          <View style={qst.chipWrap}>
            <Chip label="1회성" on={dueDays === null} onPress={() => setDueDays(null)} />
            {DUE_OPTIONS.map((o) => (
              <Chip key={o.days} label={`${o.label}마다`} on={dueDays === o.days} onPress={() => setDueDays(o.days)} />
            ))}
          </View>
        </Field>
        <Field label="담을 업무 수" hint={`최소 ${minItems}개부터 직원에게 보여요`}>
          <IntField value={maxItems} onChange={setMaxItems} min={Math.max(1, minItems)} max={20} unit="개" />
        </Field>
        {err ? <ErrorNote text={err} /> : null}
        {editing ? (
          <View style={{ marginTop: Space.xl }}>
            <GhostButton icon="trash-outline" label="이 퀴즈 종류 삭제" danger disabled={busy} onPress={() => void remove()} />
          </View>
        ) : null}
      </ScrollView>
      <View style={qst.foot}>
        <PrimaryButton label={busy ? '저장하는 중…' : editing ? '저장' : '퀴즈 종류 만들기'} disabled={busy} onPress={() => void save()} />
      </View>
    </BottomSheet>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3) 추천 업무 담기 시트 — 코스를 만든 직후 바로 뜬다
// ────────────────────────────────────────────────────────────────────────────

const isPresetKey = (k: string | null | undefined): k is QuizPresetKey => !!k && k in PRESETS;

export function CourseRecommendSheet({
  course,
  entries,
  usedEntryIds,
  remaining,
  onAdd,
  onClose,
}: {
  course: TrainingCourse;
  entries: PlaybookEntry[];
  /** 이 코스에 이미 담긴 노하우 id — 코스 단위 판정(다른 코스에 있어도 여기선 담을 수 있다). */
  usedEntryIds: Set<string>;
  /** 상한까지 남은 자리 수. */
  remaining: number;
  onAdd: (entries: PlaybookEntry[]) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  /**
   * 추천 순위 계산은 src/lib/quiz/presets.ts 의 recommendTemplates 하나가 SSOT다 —
   * 여기에 규칙을 복제하지 않는다. 담을 후보 = 아직 이 코스에 없는 발행 노하우
   * (기존 "기존 노하우로 추가" 경로와 같은 재료 — 담을 때 업무가 만들어진다).
   */
  const preset = isPresetKey(course.preset) ? course.preset : null;
  const recommended = useMemo(() => {
    const pool = entries.filter((e) => e.status === 'published' && !usedEntryIds.has(e.id));
    const byId = new Map(pool.map((e) => [e.id, e]));
    if (!preset) {
      return [...pool]
        .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
        .slice(0, 20)
        .map((e, i) => ({ entry: e, top: i < 3 }));
    }
    const ctx = pool.map((e) => ({ templateId: e.id, templateName: e.title, entries: [e] }));
    return recommendTemplates(preset, ctx, 20)
      .map((c, i) => ({ entry: byId.get(c.templateId), top: i < 3 }))
      .filter((x): x is { entry: PlaybookEntry; top: boolean } => !!x.entry);
  }, [entries, usedEntryIds, preset]);

  const overflow = picked.size > remaining;

  const submit = async () => {
    if (busy || picked.size === 0 || overflow) return;
    setBusy(true);
    await onAdd(recommended.filter((r) => picked.has(r.entry.id)).map((r) => r.entry));
    setBusy(false);
    onClose();
  };

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '82%' }}>
      <SheetHead title={`${course.name} · 담을 업무 고르기`} onClose={onClose} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} showsVerticalScrollIndicator={false}>
        <Text style={cst.recLead}>
          {recommended.length === 0
            ? '담을 수 있는 노하우가 아직 없어요. 목록 아래에서 새로 만들어 주세요.'
            : preset
              ? `${PRESETS[preset].recommendReason} ${remaining}개까지 담을 수 있어요.`
              : `최근에 고친 순서로 놓았어요 · ${remaining}개까지 담을 수 있어요`}
        </Text>
        {recommended.map(({ entry, top }) => {
          const on = picked.has(entry.id);
          return (
            <Pressable
              key={entry.id}
              onPress={() =>
                setPicked((prev) => {
                  const n = new Set(prev);
                  if (n.has(entry.id)) n.delete(entry.id);
                  else n.add(entry.id);
                  return n;
                })
              }
              style={({ pressed }) => [cst.recRow, on && cst.recRowOn, pressed && { opacity: 0.85 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={entry.title}
            >
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? InkColors.ink : InkColors.ink3} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={qst.rowText} numberOfLines={1}>{entry.title}</Text>
                <Text style={qst.rowMeta} numberOfLines={1}>
                  {top ? '이 퀴즈에 잘 맞아요 · ' : ''}{entry.square?.situation || '내용 없음'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={qst.foot}>
        {overflow ? <ErrorNote text={`${remaining}개까지만 담을 수 있어요. ${picked.size - remaining}개를 빼 주세요.`} /> : null}
        <PrimaryButton
          label={busy ? '담는 중…' : picked.size > 0 ? `고른 ${picked.size}개 담기` : '담을 업무를 골라 주세요'}
          disabled={busy || picked.size === 0 || overflow}
          onPress={() => void submit()}
        />
      </View>
    </BottomSheet>
  );
}

const cst = StyleSheet.create({
  onboard: { gap: Space.sm },
  onboardLead: { fontSize: 17, fontWeight: '900', color: InkColors.ink },
  onboardSub: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 21, marginBottom: Space.xs },
  presetCard: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 72,
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.md, ...Elevation.e2,
  },
  presetName: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  presetDesc: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 21, marginTop: 1 },
  presetMeta: { fontSize: 12, color: InkColors.ink3, fontWeight: '700', marginTop: 2 },

  recLead: { fontSize: 15, color: InkColors.ink2, fontWeight: '700', lineHeight: 21, marginTop: Space.xs },
  recRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56,
    paddingHorizontal: Space.md, paddingVertical: Space.sm + 2,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF', marginTop: Space.xs,
  },
  recRowOn: { borderColor: InkColors.ink, backgroundColor: InkColors.bgSoft },
});
