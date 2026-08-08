/**
 * 형태별 문항 본문(payload) 편집 폼.
 *
 * ★ 여기는 "입력 UI"만 담당한다. 저장 가능 여부의 판정은 **항상** FORMATS[f].validate(payload) 다
 *   (src/lib/quiz/formats). 이 파일에 검증 규칙을 복제하지 않는다 — 두 곳에 두면 서로 어긋난다.
 *
 * 11개 형태를 5가지 모양으로 묶어 재사용한다(계약 §2 payload 스키마 표 기준):
 *   choices   — mc4 / order_pick / value_pick / trap_pick / case_pick / name_pick / chosung
 *   sequence  — wrong_spot
 *   count     — fill_count
 *   cards     — mine_tap
 *   judge     — quick_judge
 * 형태가 늘면 shapeOf 에 한 줄만 더한다.
 */

import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { QuizFormat } from '@/lib/quiz/types';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Field, TextField, IntField, qst } from './kit';

type Shape = 'choices' | 'sequence' | 'count' | 'cards' | 'judge';

function shapeOf(f: QuizFormat): Shape {
  switch (f) {
    case 'wrong_spot': return 'sequence';
    case 'fill_count': return 'count';
    case 'mine_tap': return 'cards';
    case 'quick_judge': return 'judge';
    default: return 'choices';
  }
}

/** 형태별 빈 payload — 폼이 처음부터 올바른 모양을 갖게 한다(부분 키 누락으로 인한 무음 실패 방지). */
export function emptyPayload(f: QuizFormat): Record<string, any> {
  const base: Record<string, any> = { ask: '', explain: '' };
  switch (shapeOf(f)) {
    case 'sequence': return { ...base, sequence: ['', '', ''], wrong_index: 0 };
    case 'count': return { ...base, target: 3, unit: '' };
    case 'cards': return { ...base, cards: [{ text: '', is_mine: true }, { text: '', is_mine: false }, { text: '', is_mine: false }, { text: '', is_mine: false }] };
    case 'judge': return { ...base, labels: ['맞다', '아니다'], seconds: 20, cards: [{ text: '', answer: 0 }, { text: '', answer: 1 }, { text: '', answer: 0 }, { text: '', answer: 1 }] };
    default: {
      const p: Record<string, any> = { ...base, choices: ['', '', '', ''], answer_index: 0 };
      if (f === 'value_pick') p.unit = '';
      if (f === 'case_pick') p.situation = '';
      if (f === 'chosung') p.chosung = '';
      return p;
    }
  }
}

/** 정답 텍스트 — 노하우 원클릭 추가(계약 §6)의 재료. 형태마다 정답이 있는 자리가 다르다. */
export function answerTextOf(f: QuizFormat, p: Record<string, any>): string {
  switch (shapeOf(f)) {
    case 'sequence': return (p.sequence ?? []).join(' → ');
    case 'count': return `${p.target ?? ''}${p.unit ? ` ${p.unit}` : ''}`;
    case 'cards': return (p.cards ?? []).filter((c: any) => c?.is_mine).map((c: any) => c.text).filter(Boolean).join(' · ');
    case 'judge': return (p.cards ?? []).filter((c: any) => c?.answer === 0).map((c: any) => c.text).filter(Boolean).join(' · ');
    default: return (p.choices ?? [])[p.answer_index ?? 0] ?? '';
  }
}

/** 정답이 "하면 안 되는 것"인 형태 — 노하우 조립 시 extract.dont 로 간다. */
export function isDontFormat(f: QuizFormat): boolean {
  return f === 'trap_pick' || f === 'mine_tap';
}

/** 순서가 정답인 형태 — 노하우 조립 시 action.steps 로 간다. */
export function orderedStepsOf(f: QuizFormat, p: Record<string, any>): string[] {
  if (f !== 'wrong_spot') return [];
  return (p.sequence ?? []).filter((s: any) => typeof s === 'string' && s.trim());
}

export function PayloadForm({
  format,
  payload,
  onChange,
}: {
  format: QuizFormat;
  payload: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}) {
  const p = payload;
  const set = (patch: Record<string, any>) => onChange({ ...p, ...patch });
  const shape = shapeOf(format);

  const setAt = (key: string, i: number, v: any) => {
    const arr = [...(p[key] ?? [])];
    arr[i] = v;
    set({ [key]: arr });
  };
  const addAt = (key: string, v: any, max: number) => {
    const arr = [...(p[key] ?? [])];
    if (arr.length >= max) return;
    set({ [key]: [...arr, v] });
  };
  const removeAt = (key: string, i: number, min: number) => {
    const arr = [...(p[key] ?? [])];
    if (arr.length <= min) return;
    arr.splice(i, 1);
    const patch: Record<string, any> = { [key]: arr };
    // 정답 인덱스가 지운 자리 뒤에 있었으면 같이 당긴다(정답이 엉뚱한 항목을 가리키는 것 방지).
    if (key === 'choices' && (p.answer_index ?? 0) >= arr.length) patch.answer_index = arr.length - 1;
    if (key === 'sequence' && (p.wrong_index ?? 0) >= arr.length) patch.wrong_index = arr.length - 1;
    set(patch);
  };

  return (
    <View>
      <Field label="문제" hint="직원이 읽을 한 줄이에요">
        <TextField value={p.ask ?? ''} onChange={(v) => set({ ask: v })} placeholder="예) 마감할 때 가장 먼저 하는 것은?" multiline />
      </Field>

      {format === 'case_pick' && (
        <Field label="상황">
          <TextField value={p.situation ?? ''} onChange={(v) => set({ situation: v })} placeholder="예) 포장 손님이 쿠폰을 내밀었어요" multiline />
        </Field>
      )}
      {format === 'chosung' && (
        <Field label="초성">
          <TextField value={p.chosung ?? ''} onChange={(v) => set({ chosung: v })} placeholder="예) ㅂㅍㄹㅅ" maxLength={20} />
        </Field>
      )}
      {(format === 'value_pick' || format === 'fill_count') && (
        <Field label="단위">
          <TextField value={p.unit ?? ''} onChange={(v) => set({ unit: v })} placeholder="예) 펌프" maxLength={10} />
        </Field>
      )}

      {shape === 'choices' && (
        <Field label="보기" hint="정답을 눌러 표시해 주세요">
          {(p.choices ?? []).map((c: string, i: number) => (
            <ListRow
              key={i}
              value={c}
              placeholder={`보기 ${i + 1}`}
              onChange={(v) => setAt('choices', i, v)}
              marked={(p.answer_index ?? 0) === i}
              markLabel="정답"
              onMark={() => set({ answer_index: i })}
              onRemove={(p.choices ?? []).length > 2 ? () => removeAt('choices', i, 2) : undefined}
            />
          ))}
          <AddRow label="보기 추가" disabled={(p.choices ?? []).length >= 4} onPress={() => addAt('choices', '', 4)} />
        </Field>
      )}

      {shape === 'sequence' && (
        <Field label="순서" hint="일부러 하나만 잘못 놓고, 그 자리를 눌러 표시해 주세요">
          {(p.sequence ?? []).map((c: string, i: number) => (
            <ListRow
              key={i}
              value={c}
              placeholder={`${i + 1}번째`}
              onChange={(v) => setAt('sequence', i, v)}
              marked={(p.wrong_index ?? 0) === i}
              markLabel="틀린 자리"
              onMark={() => set({ wrong_index: i })}
              onRemove={(p.sequence ?? []).length > 3 ? () => removeAt('sequence', i, 3) : undefined}
            />
          ))}
          <AddRow label="단계 추가" disabled={(p.sequence ?? []).length >= 6} onPress={() => addAt('sequence', '', 6)} />
        </Field>
      )}

      {shape === 'count' && (
        <Field label="정답 횟수" hint="직원이 이 횟수만큼 누르고 멈춰야 해요">
          <IntField value={p.target ?? 1} onChange={(v) => set({ target: v })} min={1} max={12} unit={p.unit || undefined} />
        </Field>
      )}

      {shape === 'cards' && (
        <Field label="행동 카드" hint="하면 안 되는 것을 눌러 표시해 주세요 · 여러 개 가능">
          {(p.cards ?? []).map((c: any, i: number) => (
            <ListRow
              key={i}
              value={c?.text ?? ''}
              placeholder={`행동 ${i + 1}`}
              onChange={(v) => setAt('cards', i, { ...c, text: v })}
              marked={!!c?.is_mine}
              markLabel="하면 안 됨"
              onMark={() => setAt('cards', i, { ...c, is_mine: !c?.is_mine })}
              markRole="checkbox"
              onRemove={(p.cards ?? []).length > 4 ? () => removeAt('cards', i, 4) : undefined}
            />
          ))}
          <AddRow label="행동 추가" disabled={(p.cards ?? []).length >= 8} onPress={() => addAt('cards', { text: '', is_mine: false }, 8)} />
        </Field>
      )}

      {shape === 'judge' && (
        <>
          <Field label="두 갈래 이름">
            <View style={fst.pairRow}>
              <TextInput
                style={[qst.input, fst.pairInput]}
                value={(p.labels ?? [])[0] ?? ''}
                onChangeText={(v) => set({ labels: [v, (p.labels ?? [])[1] ?? ''] })}
                placeholder="예) 쓴다"
                placeholderTextColor={InkColors.ink3}
                accessibilityLabel="첫 번째 갈래 이름"
              />
              <TextInput
                style={[qst.input, fst.pairInput]}
                value={(p.labels ?? [])[1] ?? ''}
                onChangeText={(v) => set({ labels: [(p.labels ?? [])[0] ?? '', v] })}
                placeholder="예) 버린다"
                placeholderTextColor={InkColors.ink3}
                accessibilityLabel="두 번째 갈래 이름"
              />
            </View>
          </Field>
          <Field label="제한 시간">
            <IntField value={p.seconds ?? 20} onChange={(v) => set({ seconds: v })} min={5} max={60} unit="초" />
          </Field>
          <Field label="카드" hint={`누르면 정답이 ${(p.labels ?? [])[0] || '첫 번째'}·${(p.labels ?? [])[1] || '두 번째'} 사이에서 바뀌어요`}>
            {(p.cards ?? []).map((c: any, i: number) => (
              <ListRow
                key={i}
                value={c?.text ?? ''}
                placeholder={`카드 ${i + 1}`}
                onChange={(v) => setAt('cards', i, { ...c, text: v })}
                marked={(c?.answer ?? 0) === 0}
                markLabel={(p.labels ?? [])[(c?.answer ?? 0)] || (c?.answer === 0 ? '첫째' : '둘째')}
                onMark={() => setAt('cards', i, { ...c, answer: c?.answer === 0 ? 1 : 0 })}
                markRole="button"
                onRemove={(p.cards ?? []).length > 4 ? () => removeAt('cards', i, 4) : undefined}
              />
            ))}
            <AddRow label="카드 추가" disabled={(p.cards ?? []).length >= 8} onPress={() => addAt('cards', { text: '', answer: 0 }, 8)} />
          </Field>
        </>
      )}

      <Field label="해설" hint="틀렸을 때 직원이 읽어요">
        <TextField value={p.explain ?? ''} onChange={(v) => set({ explain: v })} placeholder="예) 백플러시를 먼저 돌리면 원두 찌꺼기가 다시 들어가요" multiline />
      </Field>
    </View>
  );
}

/**
 * 목록 한 줄 = [입력] [표시 토글] [삭제].
 * ★ 행 자체를 Pressable 로 감싸지 않는다 — RNW 에서 role=button 중첩이 되면 클릭이 먹힌다.
 */
function ListRow({
  value,
  placeholder,
  onChange,
  marked,
  markLabel,
  onMark,
  markRole = 'radio',
  onRemove,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  marked: boolean;
  markLabel: string;
  onMark: () => void;
  markRole?: 'radio' | 'checkbox' | 'button';
  onRemove?: () => void;
}) {
  return (
    <View style={fst.row}>
      <TextInput
        style={[qst.input, { flex: 1, minWidth: 0 }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={InkColors.ink3}
        accessibilityLabel={placeholder}
      />
      <Pressable
        onPress={onMark}
        style={({ pressed }) => [fst.mark, marked && fst.markOn, pressed && { opacity: 0.8 }]}
        accessibilityRole={markRole}
        accessibilityState={markRole === 'checkbox' ? { checked: marked } : { selected: marked }}
        accessibilityLabel={`${placeholder} ${markLabel}`}
      >
        <Text style={[fst.markText, marked && fst.markTextOn]} numberOfLines={1}>{markLabel}</Text>
      </Pressable>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${placeholder} 삭제`}>
          <Ionicons name="close-circle-outline" size={19} color={InkColors.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AddRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [fst.addRow, disabled && { opacity: 0.35 }, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name="add" size={16} color={InkColors.ink2} />
      <Text style={fst.addText}>{label}</Text>
    </Pressable>
  );
}

const fst = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.xs },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.xs },
  pairInput: { flex: 1, minWidth: 0 },
  mark: {
    minHeight: 48, paddingHorizontal: Space.md, alignItems: 'center', justifyContent: 'center', maxWidth: 108,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bgSoft,
  },
  markOn: { backgroundColor: BrandColors.goodSolid, borderColor: BrandColors.good },
  markText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3 },
  markTextOn: { color: '#FFFFFF' },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: Space.xs },
  addText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
});
