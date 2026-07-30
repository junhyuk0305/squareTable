import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { ALL_CATEGORIES, getCategoryMeta } from '@/lib/utils/category';
import {
  newCustomCategory,
  sanitizeCustomCategories,
  CUSTOM_LABEL_MAX,
  type CustomCategory,
} from '@/lib/store/knowhowCategories';
import { InkColors, BrandColors, CustomCategoryColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

/**
 * 노하우 카테고리 편집 — 사장·담당자용(RLS auth_can_manage).
 * 기본 4종(루틴/돌발/원칙/꿀팁)은 AI 자동 분류의 전제라 고정 노출만 하고,
 * 매장 커스텀 카테고리만 추가·이름 수정·삭제한다(0096, 발행 전 "종류" 칩에서 수동 지정 전용).
 *
 * 로컬 편집(items) → '저장'에서 sanitize(빈 이름 제거·id 정리) 후 DB 반영 성공 시에만 닫는다.
 * 커스텀을 지워도 그 카테고리의 기존 노하우는 사라지지 않는다 — 표시가 '기타'로 폴백된다.
 */
export function KnowhowCategorySheet({ onClose }: { onClose: () => void }) {
  const customs = usePlaybookStore((s) => s.customCategories);
  const saveCustomCategories = usePlaybookStore((s) => s.saveCustomCategories);
  const entries = usePlaybookStore((s) => s.entries);

  const [items, setItems] = useState<CustomCategory[]>(() => customs.map((c) => ({ ...c })));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const usedCountFor = (id: string) => entries.filter((e) => e.category === id).length;

  const setLabel = (i: number, v: string) => setItems((p) => p.map((c, idx) => (idx === i ? { ...c, label: v } : c)));
  const addItem = () => setItems((p) => [...p, newCustomCategory()]);
  const removeItem = (id: string) => {
    setItems((p) => p.filter((c) => c.id !== id));
    setConfirmDelete(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await saveCustomCategories(sanitizeCustomCategories(items));
    setSaving(false);
    if (ok) onClose(); // 실패 시 열어둔 채 재시도(에러 토스트는 쓰기 계층이 띄움)
  };

  return (
    <BottomSheet visible onClose={onClose} sheetStyle={{ height: '86%' }}>
      <Text style={s.title}>카테고리 편집</Text>
      <Text style={s.lead}>기본 4가지는 AI가 자동으로 분류해요. 매장만의 카테고리를 추가하면 노하우를 저장할 때 직접 골라 담을 수 있어요.</Text>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {/* 기본 4종 — 고정(AI 분류 대상) */}
        {ALL_CATEGORIES.map((c) => {
          const m = getCategoryMeta(c);
          return (
            <View key={c} style={s.baseRow}>
              <View style={[s.dot, { backgroundColor: m.color }]} />
              <Text style={s.baseLabel}>{m.label}</Text>
              <Text style={s.baseHint}>{m.description}</Text>
              <View style={s.baseTag}>
                <Text style={s.baseTagText}>기본</Text>
              </View>
            </View>
          );
        })}

        {/* 커스텀 — 추가·이름 수정·삭제 */}
        {items.map((c, i) => (
          <View key={c.id} style={s.card}>
            <View style={s.cardHead}>
              <View style={[s.dot, { backgroundColor: CustomCategoryColor }]} />
              <TextInput
                value={c.label}
                onChangeText={(v) => setLabel(i, v)}
                placeholder="카테고리 이름 (예: 배달앱)"
                placeholderTextColor={InkColors.ink3}
                style={s.labelInp}
                maxLength={CUSTOM_LABEL_MAX}
              />
              <Pressable onPress={() => setConfirmDelete(c.id)} hitSlop={6} style={s.iconBtn} accessibilityLabel="카테고리 삭제">
                <Ionicons name="trash-outline" size={17} color={BrandColors.bad} />
              </Pressable>
            </View>

            {confirmDelete === c.id && (
              <View style={s.confirmBar}>
                <Text style={s.confirmText}>
                  ‘{c.label.trim() || '이 카테고리'}’를 삭제할까요?
                  {usedCountFor(c.id) > 0 ? ` 이 카테고리의 노하우 ${usedCountFor(c.id)}개는 ‘기타’로 표시돼요.` : ''}
                </Text>
                <View style={s.confirmBtns}>
                  <Pressable onPress={() => setConfirmDelete(null)} style={({ pressed }) => [s.cCancel, pressed && { opacity: 0.8 }]}>
                    <Text style={s.cCancelText}>취소</Text>
                  </Pressable>
                  <Pressable onPress={() => removeItem(c.id)} style={({ pressed }) => [s.cDel, pressed && { opacity: 0.85 }]}>
                    <Text style={s.cDelText}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ))}

        <Pressable onPress={addItem} style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="add" size={17} color={InkColors.ink} />
          <Text style={s.addBtnText}>카테고리 추가</Text>
        </Pressable>

        <Text style={s.note}>직접 만든 카테고리는 노하우를 저장할 때 종류 칩에서 골라요. AI가 자동으로 분류하지는 않아요.</Text>
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

  baseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  baseLabel: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  baseHint: { flex: 1, fontSize: 12, color: InkColors.ink3 },
  baseTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line },
  baseTagText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },

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
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  confirmBar: { marginTop: 10, padding: 10, borderRadius: Radius.sm, backgroundColor: '#FBECEC', borderWidth: 1, borderColor: BrandColors.bad },
  confirmText: { fontSize: 12, color: '#8A2B2B', fontWeight: '700', lineHeight: 17 },
  confirmBtns: { flexDirection: 'row', gap: 8, marginTop: 8, justifyContent: 'flex-end' },
  cCancel: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  cCancelText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  cDel: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.sm, backgroundColor: BrandColors.bad },
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
