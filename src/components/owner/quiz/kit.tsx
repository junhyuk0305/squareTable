/**
 * 사장 문항/코스 UI 공용 조각 — 시트 4개(코스 설정·추천 담기·문항 목록·문항 편집)가
 * 같은 머리말·칩·입력·버튼을 쓰므로 한 곳에 둔다(스타일 드리프트 방지).
 *
 * 규칙: 본문 15sp · 고정 height 금지(minHeight) · 색은 토큰만 · 이모지 금지 ·
 *      role=button Pressable 중첩 금지(행 안의 액션은 형제로 분리).
 */

import { useState, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/** 시트 머리말 — 제목 + 닫기. 모든 시트가 같은 모양을 갖도록 강제한다. */
export function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={qst.sheetHead}>
      <Text style={qst.sheetTitle} numberOfLines={1}>{title}</Text>
      <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
        <Ionicons name="close" size={20} color={InkColors.ink2} />
      </Pressable>
    </View>
  );
}

/** 선택 칩(단일/다중 공용). role 은 호출부가 정한다(radio/checkbox). */
export function Chip({
  label,
  on,
  onPress,
  role = 'radio',
  accessibilityLabel,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  role?: 'radio' | 'checkbox' | 'button';
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [qst.chip, on && qst.chipOn, pressed && { opacity: 0.85 }]}
      accessibilityRole={role}
      accessibilityState={role === 'checkbox' ? { checked: on } : { selected: on }}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={[qst.chipText, on && qst.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** 라벨 + 입력 묶음. 라벨은 placeholder 로 대신하지 않는다(워딩 기준 §5). */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={qst.field}>
      <Text style={qst.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={qst.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  maxLength = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <TextInput
      style={[qst.input, multiline && qst.inputMulti]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={InkColors.ink3}
      multiline={multiline}
      maxLength={maxLength}
      accessibilityLabel={placeholder}
    />
  );
}

/** 정수 입력 — 자유 텍스트 대신 −/+ 버튼(숫자 키패드 없이 한 손 조작). */
export function IntField({
  value,
  onChange,
  min,
  max,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit?: string;
}) {
  return (
    <View style={qst.stepRow}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        style={({ pressed }) => [qst.stepBtn, value <= min && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="하나 줄이기"
      >
        <Ionicons name="remove" size={18} color={InkColors.ink} />
      </Pressable>
      <Text style={qst.stepValue}>{value}{unit ? ` ${unit}` : ''}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        style={({ pressed }) => [qst.stepBtn, value >= max && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="하나 늘리기"
      >
        <Ionicons name="add" size={18} color={InkColors.ink} />
      </Pressable>
    </View>
  );
}

/** 주 액션 1개 — 시트당 하나만 쓴다(Primary 1개 원칙). */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [qst.cta, disabled && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={qst.ctaText}>{label}</Text>
    </Pressable>
  );
}

/** 보조 버튼(아이콘 + 라벨 병기 — 아이콘 단독 금지). */
export function GhostButton({
  icon,
  label,
  onPress,
  disabled,
  danger,
  fill,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** 가로 행에서 폭을 나눠 가질 때. 세로 배치는 기본(stretch)이라 필요 없다. */
  fill?: boolean;
}) {
  const color = danger ? BrandColors.bad : InkColors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [qst.ghost, fill && { flex: 1, minWidth: 0 }, disabled && { opacity: 0.35 }, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[qst.ghostText, danger && { color: BrandColors.badText }]}>{label}</Text>
    </Pressable>
  );
}

/** 저장 전 검증 실패 안내 — 코드가 아니라 무슨 일 + 뭘 하면 되는지. */
export function ErrorNote({ text }: { text: string }) {
  return (
    <View style={qst.errBox}>
      <Ionicons name="alert-circle-outline" size={16} color={BrandColors.bad} />
      <Text style={qst.errText}>{text}</Text>
    </View>
  );
}

/**
 * 정답 — 탭해야 보인다.
 *
 * 목록에 정답을 그냥 띄우면 "풀어보기"가 무의미해진다(풀기 전에 답을 본다).
 * 그렇다고 지우면 문항이 멀쩡한지 훑어보는 길이 없어져 검수가 느려진다 → 접어 둔다.
 * 행 자체는 Pressable 이 아니므로 이건 형제 버튼이다(RNW 중첩 버튼 회피).
 */
export function AnswerReveal({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <Pressable
      onPress={() => setShown((v) => !v)}
      style={qst.answerRow}
      accessibilityRole="button"
      accessibilityLabel={shown ? '정답 가리기' : '정답 보기'}
    >
      <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={15} color={InkColors.ink3} />
      <Text style={[qst.answerText, !shown && { color: InkColors.ink3 }]} numberOfLines={2}>
        {shown ? `정답 · ${text || '없음'}` : '정답 보기'}
      </Text>
    </Pressable>
  );
}

export const qst = StyleSheet.create({
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, gap: Space.sm },

  answerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 32, paddingVertical: Space.xs },
  answerText: { flex: 1, fontSize: 15, fontWeight: '700', color: BrandColors.goodText, lineHeight: 21 },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },

  body: { paddingHorizontal: 16, paddingBottom: 20, gap: Space.sm },
  foot: { paddingHorizontal: 16, paddingTop: Space.sm, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line, gap: Space.sm },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs + 2 },
  chip: {
    minHeight: 40, paddingHorizontal: Space.lg, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF' },

  field: { gap: Space.xs, marginTop: Space.sm },
  fieldLabel: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  fieldHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md, paddingVertical: Space.sm + 2, fontSize: 15, color: InkColors.ink, minHeight: 48,
  },
  inputMulti: { minHeight: 92, textAlignVertical: 'top' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  stepBtn: {
    minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  stepValue: { fontSize: 15, fontWeight: '800', color: InkColors.ink, minWidth: 64, textAlign: 'center' },

  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 15, alignItems: 'center', minHeight: 48 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  ghost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    paddingHorizontal: Space.md, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  ghostText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },

  errBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm, marginTop: Space.sm,
    backgroundColor: BrandColors.accentSoft, borderRadius: Radius.md, padding: Space.md,
  },
  errText: { flex: 1, fontSize: 15, color: BrandColors.badText, fontWeight: '700', lineHeight: 21 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, ...Elevation.e2,
  },
  rowText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  rowMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 1 },
  emptyText: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', paddingVertical: Space.md, lineHeight: 21 },
});
