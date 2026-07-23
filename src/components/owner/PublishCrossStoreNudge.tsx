import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { copyKnowhowTo } from '@/lib/db';
import { notifyAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

type Target = { unit_id: string; store_name: string };

/**
 * PublishCrossStoreNudge — 노하우를 발행한 직후, 사장이 매장을 2개 이상 가졌을 때만 뜨는 넛지(S3 #1).
 * "다른 내 매장에도 추가할까요?" — 대상 매장을 골라 방금 발행한 노하우를 그 매장으로 복제(copy_knowhow_to).
 * 항상 건너뛸 수 있다(백드롭·"안 할게요"). 새 화면 0개 — 발행 화면(coach) 위 시트.
 */
export function PublishCrossStoreNudge({
  entryIds,
  targets,
  onClose,
}: {
  entryIds: string[];
  targets: Target[];
  onClose: () => void;
}) {
  // 대상이 하나뿐이면 미리 선택(1탭으로 끝나게).
  const [selected, setSelected] = useState<Set<string>>(new Set(targets.length === 1 ? [targets[0].unit_id] : []));
  const [copying, setCopying] = useState(false);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const doCopy = async () => {
    if (selected.size === 0 || copying) return;
    setCopying(true);
    let total = 0, failed = 0;
    for (const to of [...selected]) {
      const { data, error } = await copyKnowhowTo(to, entryIds);
      if (error || data == null) failed++; else total += data;
    }
    setCopying(false);
    if (failed > 0 && total === 0) {
      await notifyAction('추가하지 못했어요', '연결을 확인하고 다시 시도해 주세요.', '확인', { icon: 'alert-circle-outline' });
      onClose();
      return;
    }
    await notifyAction(
      '다른 매장에도 추가했어요',
      `${selected.size}개 매장에 ${total}개를 추가했어요.${failed > 0 ? ' 일부는 실패했어요.' : ''}`,
      '확인',
      { icon: 'checkmark-circle-outline', accent: '아직 확인 전이에요 — 새 매장 기준(주소·연락처 등)이 맞는지 확인해 주세요. 사진은 함께 옮겨지지 않아요.' },
    );
    onClose();
  };

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '52%' }}>
      <View style={s.body}>
        <Text style={s.title}>다른 내 매장에도 추가할까요?</Text>
        <Text style={s.sub}>방금 저장한 노하우를 다른 매장으로도 가져갈 수 있어요.</Text>

        <View style={s.chips}>
          {targets.map((t) => {
            const on = selected.has(t.unit_id);
            return (
              <Pressable
                key={t.unit_id}
                onPress={() => toggle(t.unit_id)}
                style={[s.chip, on && s.chipOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${t.store_name}에도 추가`}
              >
                <View style={[s.check, on && s.checkOn]}>
                  {on ? <Ionicons name="checkmark" size={12} color={InkColors.bubbleText} /> : null}
                </View>
                <Ionicons name="storefront" size={14} color={on ? InkColors.ink : InkColors.ink2} />
                <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{t.store_name}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.hint}>가져간 노하우는 “확인 필요”로 표시돼요. 사진은 함께 옮겨지지 않아요.</Text>

        <View style={s.foot}>
          <Pressable onPress={onClose} style={({ pressed }) => [s.skip, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="안 할게요">
            <Text style={s.skipText}>안 할게요</Text>
          </Pressable>
          <Pressable
            onPress={doCopy}
            disabled={selected.size === 0 || copying}
            style={({ pressed }) => [s.cta, (selected.size === 0) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`${selected.size}개 매장에 추가`}
          >
            {copying ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add-circle-outline" size={15} color="#fff" />}
            <Text style={s.ctaText}>{copying ? '추가하는 중…' : selected.size > 0 ? `${selected.size}개 매장에 추가` : '매장을 선택하세요'}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: Space.md, paddingTop: 4, paddingBottom: 18 },
  title: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3, fontWeight: '600', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginTop: 14 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '100%',
    backgroundColor: InkColors.bg, borderWidth: 1.5, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingVertical: 9, paddingHorizontal: 13,
  },
  chipOn: { backgroundColor: InkColors.cream, borderColor: InkColors.ink },
  chipText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2, flexShrink: 1 },
  chipTextOn: { color: InkColors.ink },
  check: {
    width: 20, height: 20, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: InkColors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.paper,
  },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  hint: { fontSize: 11.5, color: InkColors.ink3, marginTop: 12, paddingHorizontal: 2, lineHeight: 17 },
  foot: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 16 },
  skip: { paddingHorizontal: 18, justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  skipText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  cta: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: BrandColors.brand, borderRadius: Radius.md, paddingVertical: 14 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
