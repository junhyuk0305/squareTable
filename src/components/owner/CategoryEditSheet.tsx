import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { getSectionMeta } from '@/lib/utils/category';
import { UNSECTIONED, standardSections } from '@/lib/config/sections';
import { newCustomCategory, type CustomCategory } from '@/lib/store/knowhowCategories';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

const LABEL_MAX = 20;

/**
 * 카테고리 편집 — 사용자 표면 분류(= section)의 추가·이름 수정·삭제(07-31 카테고리 단일화).
 *
 * 카테고리는 별도 테이블이 아니라 노하우 행에 적힌 이름이다. 그래서:
 *  · 이름 수정 = 그 카테고리의 노하우 전부를 새 이름으로 일괄 이동(renameSection, bulk 1쿼리)
 *  · 삭제 = 노하우를 '기타'로 이동(노하우는 사라지지 않는다)
 *  · 추가 = 매장 설정 레지스트리(schedule_config.knowhow_categories, 0096 재활용)에 저장 —
 *    노하우가 0개여도 필터칩·저장 시트 선택지에 나타난다.
 * 레지스트리 불변식: 표준 세트에 없는 이름만 담는다(표준은 항상 선택지에 있으므로).
 */
export function CategoryEditSheet({ onClose }: { onClose: () => void }) {
  const entries = usePlaybookStore((s) => s.entries);
  const customs = usePlaybookStore((s) => s.customCategories);
  const saveCustomCategories = usePlaybookStore((s) => s.saveCustomCategories);
  const renameSection = usePlaybookStore((s) => s.renameSection);
  const industry = useSessionStore((s) => s.industry);

  const visible = useMemo(() => entries.filter((e) => e.status !== 'draft'), [entries]);
  const countFor = (name: string) => visible.filter((e) => (e.section?.trim() || UNSECTIONED) === name).length;
  // DB 일괄 이동은 원문 일치(eq) — 표시명(trim)과 다른 원문 변형까지 함께 옮긴다.
  const rawVariants = (name: string) => [
    ...new Set(visible.filter((e) => e.section?.trim() === name).map((e) => e.section as string)),
  ];

  type Row = { key: string | null; label: string; count: number; deleted: boolean }; // key=원래 이름(null=신규)
  const [rows, setRows] = useState<Row[]>(() => {
    const used = [...new Set(visible.map((e) => e.section?.trim()).filter((s): s is string => !!s && s !== UNSECTIONED))];
    const std = standardSections(industry);
    const names = [...std.filter((s) => used.includes(s)), ...used.filter((s) => !std.includes(s)).sort((a, b) => a.localeCompare(b, 'ko'))];
    for (const c of customs) if (!names.includes(c.label)) names.push(c.label);
    return names.map((name) => ({ key: name, label: name, count: countFor(name), deleted: false }));
  });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const setLabel = (i: number, v: string) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, label: v } : r)));
  const addRow = () => setRows((p) => [...p, { key: null, label: '', count: 0, deleted: false }]);
  const markDelete = (i: number) => {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, deleted: true } : r)));
    setConfirmDelete(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    let allOk = true;
    // 1) 기존 카테고리의 삭제·개명 → 노하우 일괄 이동(멱등 — 실패분만 남아 재시도 가능).
    for (const r of rows) {
      if (!r.key) continue;
      const next = r.deleted ? null : r.label.trim();
      if (next === r.key) continue;
      if (!r.deleted && !next) continue; // 이름을 비웠으면 변경 없음으로 취급
      for (const raw of rawVariants(r.key)) {
        if (!(await renameSection(raw, next))) allOk = false;
      }
    }
    // 2) 레지스트리 = 표준 밖 이름 전부(살아남은 행 기준) — 0개짜리 카테고리도 선택지에 남는다.
    const std = new Set(standardSections(industry));
    const finals = [...new Set(rows.filter((r) => !r.deleted).map((r) => r.label.trim()).filter((l) => l && l !== UNSECTIONED && !std.has(l)))];
    const nextCustoms: CustomCategory[] = finals.map((label) => {
      const prev = customs.find((c) => c.label === label);
      return prev ?? { ...newCustomCategory(), label };
    });
    if (!(await saveCustomCategories(nextCustoms))) allOk = false;
    setSaving(false);
    if (allOk) onClose(); // 실패 시 열어둔 채 재시도(에러 토스트는 쓰기 계층이 띄움)
  };

  return (
    <BottomSheet visible onClose={onClose} sheetStyle={{ height: '86%' }}>
      <Text style={s.title}>카테고리 편집</Text>
      <Text style={s.lead}>이름을 바꾸면 그 카테고리의 노하우가 함께 옮겨져요. 삭제해도 노하우는 사라지지 않고 ‘{UNSECTIONED}’로 이동해요.</Text>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {rows.map((r, i) =>
          r.deleted ? null : (
            <View key={r.key ?? `new_${i}`} style={s.card}>
              <View style={s.cardHead}>
                <View style={[s.dot, { backgroundColor: getSectionMeta(r.label.trim() || null).color }]} />
                <TextInput
                  value={r.label}
                  onChangeText={(v) => setLabel(i, v)}
                  placeholder="카테고리 이름 (예: 배달앱)"
                  placeholderTextColor={InkColors.ink3}
                  style={s.labelInp}
                  maxLength={LABEL_MAX}
                  accessibilityLabel={`카테고리 이름 ${r.key ?? '새 카테고리'}`}
                />
                {r.count > 0 && <Text style={s.count}>{r.count}개</Text>}
                <Pressable onPress={() => setConfirmDelete(i)} hitSlop={6} style={s.iconBtn} accessibilityLabel={`${r.key ?? '새 카테고리'} 삭제`}>
                  <Ionicons name="trash-outline" size={17} color={BrandColors.bad} />
                </Pressable>
              </View>

              {confirmDelete === i && (
                <View style={s.confirmBar}>
                  <Text style={s.confirmText}>
                    ‘{r.label.trim() || '이 카테고리'}’를 삭제할까요?
                    {r.count > 0 ? ` 노하우 ${r.count}개는 ‘${UNSECTIONED}’로 이동해요.` : ''}
                  </Text>
                  <View style={s.confirmBtns}>
                    <Pressable onPress={() => setConfirmDelete(null)} style={({ pressed }) => [s.cCancel, pressed && { opacity: 0.8 }]}>
                      <Text style={s.cCancelText}>그대로 두기</Text>
                    </Pressable>
                    <Pressable onPress={() => markDelete(i)} style={({ pressed }) => [s.cDel, pressed && { opacity: 0.85 }]}>
                      <Text style={s.cDelText}>삭제</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ),
        )}

        <Pressable onPress={addRow} style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="add" size={17} color={InkColors.ink} />
          <Text style={s.addBtnText}>카테고리 추가</Text>
        </Pressable>

        <Text style={s.note}>추가한 카테고리는 노하우를 저장할 때 선택지로 나와요. 변경은 ‘저장’을 눌러야 반영돼요.</Text>
      </ScrollView>

      <View style={s.foot}>
        <Pressable onPress={save} disabled={saving} style={({ pressed }) => [s.saveBtn, (pressed || saving) && { opacity: 0.85 }]}>
          <Text style={s.saveText}>{saving ? '저장 중…' : '저장'}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 4 },
  lead: { fontSize: 12.5, color: InkColors.ink2, paddingHorizontal: 16, paddingBottom: 12, lineHeight: 18 },
  scroll: { flex: 1, paddingHorizontal: 16 },

  card: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, padding: 12, marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: Radius.pill },
  labelInp: {
    flex: 1,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
    color: InkColors.ink,
    backgroundColor: InkColors.cream,
  },
  count: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  confirmBar: { marginTop: 10, padding: 10, borderRadius: Radius.sm, backgroundColor: '#FBECEC', borderWidth: 1, borderColor: BrandColors.bad },
  confirmText: { fontSize: 12, color: '#8A2B2B', fontWeight: '700', lineHeight: 17 },
  confirmBtns: { flexDirection: 'row', gap: 8, marginTop: 8, justifyContent: 'flex-end' },
  cCancel: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  cCancelText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  cDel: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.sm, backgroundColor: BrandColors.badSolid },
  cDelText: { fontSize: 12.5, fontWeight: '800', color: '#fff' },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: InkColors.ink3,
    borderRadius: Radius.md,
    paddingVertical: 13,
    marginTop: 4,
    marginBottom: 8,
  },
  addBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  note: { fontSize: 12, color: InkColors.ink3, lineHeight: 17, marginBottom: 8 },

  foot: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  saveBtn: { flex: 1, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
