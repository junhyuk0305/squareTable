/**
 * 형태별 문항 본문(payload) 편집 폼.
 *
 * ★ 여기는 "입력 UI"만 담당한다. 저장 가능 여부의 판정은 **항상** FORMATS[f].validate(payload) 다
 *   (src/lib/quiz/formats). 이 파일에 검증 규칙을 복제하지 않는다 — 두 곳에 두면 서로 어긋난다.
 *
 * 16개 형태를 8가지 모양으로 묶어 재사용한다(계약 §2 payload 스키마 표 기준):
 *   choices   — mc4 / order_pick / value_pick / trap_pick / case_pick / name_pick / chosung / scale_pick
 *   sequence  — wrong_spot
 *   order     — order_build
 *   count     — fill_count
 *   cards     — mine_tap
 *   judge     — quick_judge
 *   branch    — branch_path
 *   pairs     — flip_match / link_match
 * 형태가 늘면 shapeOf 에 한 줄만 더한다.
 *
 * ★★ shapeOf 의 default 는 'choices' 다 — 새 형태를 여기 안 적으면 **에러 없이** 4지선다 폼이 뜨고,
 *   사장이 채운 payload 가 FORMATS.validate 에 걸려 저장이 막히는 막다른 길이 된다.
 *   타입도 이걸 못 잡는다(default 분기). 형태를 늘렸으면 여기부터 확인할 것.
 */

import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { parseBranchNext } from '@/lib/quiz/formats/branchPath';
import { FLIP_MAX_PAIRS } from '@/lib/quiz/formats/flipMatch';
import { LINK_MAX_PAIRS } from '@/lib/quiz/formats/linkMatch';
import type { QuizFormat } from '@/lib/quiz/types';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Field, TextField, IntField, qst } from './kit';

type Shape = 'choices' | 'sequence' | 'order' | 'count' | 'cards' | 'judge' | 'branch' | 'pairs';

function shapeOf(f: QuizFormat): Shape {
  switch (f) {
    case 'wrong_spot': return 'sequence';
    case 'order_build': return 'order';
    case 'fill_count': return 'count';
    case 'mine_tap': return 'cards';
    case 'quick_judge': return 'judge';
    case 'branch_path': return 'branch';
    case 'flip_match': return 'pairs';
    case 'link_match': return 'pairs';
    default: return 'choices';
  }
}

/** 선택지 개수 상한 — 형태 파일의 maxChoices 와 같아야 한다(저울은 정확히 둘). */
function choiceMaxOf(f: QuizFormat): number {
  return f === 'scale_pick' ? 2 : 4;
}

/** 짝 개수 하한·상한 — 형태 파일(flipMatch.ts · linkMatch.ts)의 값과 같아야 한다. */
const PAIR_MIN = 3;
function pairMaxOf(f: QuizFormat): number {
  return f === 'flip_match' ? FLIP_MAX_PAIRS : LINK_MAX_PAIRS;
}

/** order_build 의 "맞는 순서" 보기 — items 는 섞여 저장되고 answer_seq 가 순서를 가리킨다. */
function correctOrderOf(p: Record<string, any>): { text: string; at: number }[] {
  const items: string[] = p?.items ?? [];
  const seq: number[] = p?.answer_seq ?? [];
  return seq.map((at) => ({ text: items[at] ?? '', at }));
}

/** branch_path 의 다음 칸 — 범위를 벗어난 참조는 없는 것으로 본다. */
function destOf(v: any, steps: number, results: number): { kind: 's' | 'r'; i: number } | null {
  const n = parseBranchNext(v);
  if (!n) return null;
  return n.i < (n.kind === 's' ? steps : results) ? n : null;
}

/**
 * 갈래 표시(사장이 각 갈래에서 고른 "맞는 답")로 정답 경로를 걸어서 만든다.
 * ★ 표시 자체를 payload 에 넣지 않는다 — steps[] 안에 넣으면 정답 제거 대상이 아니라서
 *   응시 화면에 그대로 새어 나간다. 그래서 표시는 폼의 로컬 상태로만 두고 answer_path 만 저장한다.
 */
function walkPath(steps: any[], results: any[], marks: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let at = 0;
  while (steps[at] && !seen.has(at)) {
    seen.add(at);
    const pick = marks[at] === 1 ? 1 : 0;
    out.push(pick);
    const n = destOf(pick === 0 ? steps[at].yes : steps[at].no, steps.length, results.length);
    if (!n || n.kind === 'r') return out;
    at = n.i;
  }
  return out;
}

/** 저장된 answer_path 를 갈래 표시로 되돌린다(폼을 다시 열었을 때 사장이 고른 게 남아 있게). */
function marksFromPath(steps: any[], results: any[], path: any): number[] {
  const marks: number[] = new Array(steps.length).fill(0);
  let at = 0;
  for (const pick of Array.isArray(path) ? path : []) {
    if (!steps[at]) break;
    marks[at] = pick === 1 ? 1 : 0;
    const n = destOf(pick === 1 ? steps[at].no : steps[at].yes, steps.length, results.length);
    if (!n || n.kind === 'r') break;
    at = n.i;
  }
  return marks;
}

/** 형태별 빈 payload — 폼이 처음부터 올바른 모양을 갖게 한다(부분 키 누락으로 인한 무음 실패 방지). */
export function emptyPayload(f: QuizFormat): Record<string, any> {
  const base: Record<string, any> = { ask: '', explain: '' };
  switch (shapeOf(f)) {
    case 'sequence': return { ...base, sequence: ['', '', ''], wrong_index: 0 };
    // items 는 **섞인 순서**로 저장된다. 처음부터 한 칸 돌려 둬서 사장이 맞는 순서대로 채우기만 하면
    // 저장되는 순서가 자동으로 어긋난다(안 그러면 위에서 아래로 누르는 게 곧 정답이 된다).
    case 'order': return { ...base, items: ['', '', ''], answer_seq: [1, 2, 0] };
    case 'branch': return {
      ...base,
      steps: [{ ask: '', yes: 's1', no: 'r0' }, { ask: '', yes: 'r0', no: 'r1' }],
      results: ['', ''],
      answer_path: [0, 0],
    };
    // 짝은 저장 순서 그대로 나가고, 섞는 것은 서버가 한다(0161 quiz_strip_payload).
    case 'pairs': return { ...base, pairs: [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }] };
    case 'count': return { ...base, target: 3, unit: '' };
    case 'cards': return { ...base, cards: [{ text: '', is_mine: true }, { text: '', is_mine: false }, { text: '', is_mine: false }, { text: '', is_mine: false }] };
    case 'judge': return { ...base, labels: ['맞다', '아니다'], seconds: 20, cards: [{ text: '', answer: 0 }, { text: '', answer: 1 }, { text: '', answer: 0 }, { text: '', answer: 1 }] };
    default: {
      const n = choiceMaxOf(f);
      const p: Record<string, any> = { ...base, choices: new Array(n).fill(''), answer_index: 0 };
      if (f === 'value_pick' || f === 'scale_pick') p.unit = '';
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
    case 'order': return correctOrderOf(p).map((r) => r.text).filter(Boolean).join(' → ');
    case 'branch': {
      // 정답 경로를 걸어서 닿는 결과가 곧 정답이다.
      const steps: any[] = p.steps ?? [];
      const results: string[] = p.results ?? [];
      let at = 0;
      for (const pick of p.answer_path ?? []) {
        const n = destOf(pick === 1 ? steps[at]?.no : steps[at]?.yes, steps.length, results.length);
        if (!n) return '';
        if (n.kind === 'r') return results[n.i] ?? '';
        at = n.i;
      }
      return '';
    }
    case 'pairs': return (p.pairs ?? [])
      .map((x: any) => `${String(x?.left ?? '').trim()} – ${String(x?.right ?? '').trim()}`)
      .filter((s: string) => s.trim() !== '–')
      .join(' · ');
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
  if (f === 'order_build') return correctOrderOf(p).map((r) => r.text).filter((t) => t.trim());
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

  // 갈래 표시는 payload 에 넣지 않는다(walkPath 주석) — 폼이 열려 있는 동안만 산다.
  const [marks, setMarks] = useState<number[]>(() =>
    marksFromPath(payload?.steps ?? [], payload?.results ?? [], payload?.answer_path));

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
  // ── order_build ──────────────────────────────────────────
  // 사장은 **맞는 순서대로** 적고, 저장은 섞인 items + answer_seq 로 나간다.
  // 글자를 고칠 때 섞인 자리(at)는 건드리지 않는다 — 타이핑 중에 순서가 튀면 못 쓴다.
  const addOrderRow = () => {
    const items = [...(p.items ?? [])];
    const seq = [...(p.answer_seq ?? [])];
    if (items.length >= 6) return;
    items.push('');
    seq.push(items.length - 1);
    set({ items, answer_seq: seq });
  };
  const removeOrderRow = (at: number) => {
    const items = [...(p.items ?? [])];
    if (items.length <= 3) return;
    items.splice(at, 1);
    const seq = (p.answer_seq ?? []).filter((v: number) => v !== at).map((v: number) => (v > at ? v - 1 : v));
    set({ items, answer_seq: seq });
  };

  // ── branch_path ──────────────────────────────────────────
  /** 구조가 바뀔 때마다 정답 경로를 다시 걸어서 만든다(사장이 경로를 직접 적지 않는다). */
  const setBranch = (steps: any[], results: any[], nextMarks: number[]) => {
    setMarks(nextMarks);
    set({ steps, results, answer_path: walkPath(steps, results, nextMarks) });
  };
  const setStepField = (i: number, patch: Record<string, any>) => {
    const steps = (p.steps ?? []).map((st: any, k: number) => (k === i ? { ...st, ...patch } : st));
    setBranch(steps, p.results ?? [], marks);
  };
  /** 가리키던 칸이 사라졌으면 첫 결과로 떨어뜨린다 — 끊긴 참조를 남기면 저장이 막힌다. */
  const remapDest = (v: any, kind: 's' | 'r', removed: number): string => {
    const n = parseBranchNext(v);
    if (!n || n.kind !== kind) return String(v ?? 'r0');
    if (n.i === removed) return 'r0';
    return n.i > removed ? `${kind}${n.i - 1}` : String(v);
  };
  const removeStep = (i: number) => {
    const src = p.steps ?? [];
    if (src.length <= 2) return;
    const steps = src
      .filter((_: any, k: number) => k !== i)
      .map((st: any) => ({ ...st, yes: remapDest(st.yes, 's', i), no: remapDest(st.no, 's', i) }));
    setBranch(steps, p.results ?? [], marks.filter((_, k) => k !== i));
  };
  const removeResult = (i: number) => {
    const src = p.results ?? [];
    if (src.length <= 2) return;
    const results = src.filter((_: any, k: number) => k !== i);
    const steps = (p.steps ?? []).map((st: any) => ({
      ...st, yes: remapDest(st.yes, 'r', i), no: remapDest(st.no, 'r', i),
    }));
    setBranch(steps, results, marks);
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
      {(format === 'value_pick' || format === 'fill_count' || format === 'scale_pick') && (
        <Field label="단위">
          <TextField value={p.unit ?? ''} onChange={(v) => set({ unit: v })} placeholder="예) 펌프" maxLength={10} />
        </Field>
      )}

      {shape === 'choices' && (
        <Field
          label="보기"
          hint={format === 'scale_pick' ? '값이 더 큰 쪽을 눌러 표시해 주세요' : '정답을 눌러 표시해 주세요'}
        >
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
          {/* 저울은 정확히 둘이라 더할 자리가 없다 — 죽은 컨트롤을 두지 않고 아예 그리지 않는다. */}
          {choiceMaxOf(format) > 2 ? (
            <AddRow
              label="보기 추가"
              disabled={(p.choices ?? []).length >= choiceMaxOf(format)}
              onPress={() => addAt('choices', '', choiceMaxOf(format))}
            />
          ) : null}
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

      {shape === 'order' && (
        <Field label="순서" hint="맞는 순서대로 적어 주세요 · 직원에게는 섞어서 보여줘요">
          {correctOrderOf(p).map((row, k) => (
            <ListRow
              key={row.at}
              value={row.text}
              placeholder={`${k + 1}번째`}
              onChange={(v) => setAt('items', row.at, v)}
              markLabel={`${k + 1}번째`}
              onRemove={(p.items ?? []).length > 3 ? () => removeOrderRow(row.at) : undefined}
            />
          ))}
          <AddRow label="단계 추가" disabled={(p.items ?? []).length >= 6} onPress={addOrderRow} />
        </Field>
      )}

      {shape === 'branch' && (
        <>
          <Field label="결과" hint="갈래 끝에서 직원이 하게 될 일이에요">
            {(p.results ?? []).map((r: string, i: number) => (
              <ListRow
                key={i}
                value={r}
                placeholder={`결과 ${i + 1}`}
                onChange={(v) => {
                  const results = [...(p.results ?? [])];
                  results[i] = v;
                  setBranch(p.steps ?? [], results, marks);
                }}
                markLabel={`결과 ${i + 1}`}
                onRemove={(p.results ?? []).length > 2 ? () => removeResult(i) : undefined}
              />
            ))}
            <AddRow
              label="결과 추가"
              disabled={(p.results ?? []).length >= 4}
              onPress={() => setBranch(p.steps ?? [], [...(p.results ?? []), ''], marks)}
            />
          </Field>

          <Field label="갈래" hint="예·아니요를 누르면 어디로 갈지, 그리고 어느 쪽이 맞는지 정해 주세요">
            {(p.steps ?? []).map((st: any, i: number) => (
              <View key={i} style={fst.step}>
                <View style={fst.stepHead}>
                  <Text style={fst.stepNum}>갈래 {i + 1}</Text>
                  {(p.steps ?? []).length > 2 ? (
                    <Pressable
                      onPress={() => removeStep(i)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`갈래 ${i + 1} 삭제`}
                    >
                      <Ionicons name="close-circle-outline" size={19} color={InkColors.ink3} />
                    </Pressable>
                  ) : null}
                </View>

                <TextInput
                  style={qst.input}
                  value={st?.ask ?? ''}
                  onChangeText={(v) => setStepField(i, { ask: v })}
                  placeholder="예) 포장인가요?"
                  placeholderTextColor={InkColors.ink3}
                  accessibilityLabel={`갈래 ${i + 1} 질문`}
                />

                <DestRow
                  label="예 →"
                  value={st?.yes}
                  steps={p.steps ?? []}
                  results={p.results ?? []}
                  selfIndex={i}
                  onPick={(key) => setStepField(i, { yes: key })}
                />
                <DestRow
                  label="아니요 →"
                  value={st?.no}
                  steps={p.steps ?? []}
                  results={p.results ?? []}
                  selfIndex={i}
                  onPick={(key) => setStepField(i, { no: key })}
                />

                <View style={fst.destRow}>
                  <Text style={fst.destLabel}>맞는 답</Text>
                  {['예', '아니요'].map((label, v) => (
                    <Pressable
                      key={v}
                      onPress={() => setBranch(p.steps ?? [], p.results ?? [], marks.map((m, k) => (k === i ? v : m)))}
                      style={({ pressed }) => [fst.chip, (marks[i] ?? 0) === v && fst.chipOn, pressed && { opacity: 0.8 }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: (marks[i] ?? 0) === v }}
                      accessibilityLabel={`갈래 ${i + 1} 맞는 답 ${label}`}
                    >
                      <Text style={[fst.chipText, (marks[i] ?? 0) === v && fst.chipTextOn]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <AddRow
              label="갈래 추가"
              disabled={(p.steps ?? []).length >= 4}
              onPress={() => setBranch(
                [...(p.steps ?? []), { ask: '', yes: 'r0', no: 'r0' }],
                p.results ?? [],
                [...marks, 0],
              )}
            />
          </Field>
        </>
      )}

      {shape === 'pairs' && (
        <Field
          label="짝"
          hint={format === 'flip_match'
            ? '카드를 뒤집어 맞추는 짝이에요 · 같은 말이 두 번 나오면 안 돼요'
            : '왼쪽과 오른쪽을 잇는 짝이에요 · 오른쪽은 직원에게 섞어서 보여줘요'}
        >
          {(p.pairs ?? []).map((pair: any, i: number) => (
            <View key={i} style={fst.pairRow}>
              <TextInput
                style={[qst.input, fst.pairInput]}
                value={pair?.left ?? ''}
                onChangeText={(v) => setAt('pairs', i, { ...pair, left: v })}
                placeholder={`왼쪽 ${i + 1}`}
                placeholderTextColor={InkColors.ink3}
                accessibilityLabel={`${i + 1}번째 짝 왼쪽`}
              />
              <TextInput
                style={[qst.input, fst.pairInput]}
                value={pair?.right ?? ''}
                onChangeText={(v) => setAt('pairs', i, { ...pair, right: v })}
                placeholder={`오른쪽 ${i + 1}`}
                placeholderTextColor={InkColors.ink3}
                accessibilityLabel={`${i + 1}번째 짝 오른쪽`}
              />
              {(p.pairs ?? []).length > PAIR_MIN ? (
                <Pressable
                  onPress={() => removeAt('pairs', i, PAIR_MIN)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}번째 짝 삭제`}
                >
                  <Ionicons name="close-circle-outline" size={19} color={InkColors.ink3} />
                </Pressable>
              ) : null}
            </View>
          ))}
          <AddRow
            label="짝 추가"
            disabled={(p.pairs ?? []).length >= pairMaxOf(format)}
            onPress={() => addAt('pairs', { left: '', right: '' }, pairMaxOf(format))}
          />
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
  marked = false,
  markLabel,
  onMark,
  markRole = 'radio',
  onRemove,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  marked?: boolean;
  markLabel: string;
  /** 없으면 누를 수 없는 정적 배지로 그린다 — 아무 일도 안 하는 버튼을 두지 않는다. */
  onMark?: () => void;
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
      {onMark ? (
        <Pressable
          onPress={onMark}
          style={({ pressed }) => [fst.mark, marked && fst.markOn, pressed && { opacity: 0.8 }]}
          accessibilityRole={markRole}
          accessibilityState={markRole === 'checkbox' ? { checked: marked } : { selected: marked }}
          accessibilityLabel={`${placeholder} ${markLabel}`}
        >
          <Text style={[fst.markText, marked && fst.markTextOn]} numberOfLines={1}>{markLabel}</Text>
        </Pressable>
      ) : (
        <View style={[fst.mark, fst.markStatic]}>
          <Text style={fst.markText} numberOfLines={1}>{markLabel}</Text>
        </View>
      )}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${placeholder} 삭제`}>
          <Ionicons name="close-circle-outline" size={19} color={InkColors.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 이 갈래의 예(또는 아니요)가 어디로 가는지 고르는 칩 줄.
 * 자기 자신으로 가는 선택지는 빼둔다 — 고르는 순간 영원히 안 끝나는 문항이 된다.
 */
function DestRow({
  label,
  value,
  steps,
  results,
  selfIndex,
  onPick,
}: {
  label: string;
  value: any;
  steps: any[];
  results: any[];
  selfIndex: number;
  onPick: (key: string) => void;
}) {
  const opts: { key: string; text: string }[] = [];
  steps.forEach((_, i) => { if (i !== selfIndex) opts.push({ key: `s${i}`, text: `갈래 ${i + 1}` }); });
  results.forEach((_, i) => opts.push({ key: `r${i}`, text: `결과 ${i + 1}` }));

  return (
    <View style={fst.destRow}>
      <Text style={fst.destLabel}>{label}</Text>
      {opts.map((o) => {
        const on = String(value ?? '') === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => onPick(o.key)}
            style={({ pressed }) => [fst.chip, on && fst.chipOn, pressed && { opacity: 0.8 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label} ${o.text}`}
          >
            <Text style={[fst.chipText, on && fst.chipTextOn]}>{o.text}</Text>
          </Pressable>
        );
      })}
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
  markStatic: { backgroundColor: InkColors.bg },
  step: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    padding: Space.md, marginTop: Space.sm, gap: Space.xs,
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepNum: { fontSize: 12.5, fontWeight: '900', color: InkColors.ink2 },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexWrap: 'wrap', marginTop: Space.xs },
  destLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, minWidth: 46 },
  chip: {
    minHeight: 36, paddingHorizontal: Space.sm, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  chipOn: { borderColor: InkColors.ink, backgroundColor: InkColors.ink },
  chipText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF' },
  markText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3 },
  markTextOn: { color: '#FFFFFF' },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: Space.xs },
  addText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
});
