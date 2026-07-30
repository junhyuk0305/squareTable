import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { usePreferencesStore, TEXT_SCALE_FACTOR, type TextScale } from '@/lib/store/usePreferencesStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

const OPTIONS: { key: TextScale; label: string; sub: string }[] = [
  { key: 'small', label: '작게', sub: '한 화면에 더 많이' },
  { key: 'normal', label: '보통', sub: '기본' },
  { key: 'large', label: '크게', sub: '읽기 편하게' },
];

/**
 * 글자 크기 선택 시트 — 3단계(작게/보통/크게) 명시적 선택지 + 미리보기.
 * 고르면 즉시 리마운트하지 않고 beginTextScale로 로딩 오버레이(TextScaleTransition)를 띄운 뒤
 * 그 뒤에서 배율을 반영(트리 리마운트) → 오버레이가 내려가며 새 크기의 원래 화면으로 돌아온다.
 * (즉시 적용은 열린 시트가 리마운트로 사라지며 화면이 깜빡이던 "UI 깨짐"의 원인이었다.)
 */
export function TextScaleModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const textScale = usePreferencesStore((s) => s.textScale);
  const beginTextScale = usePreferencesStore((s) => s.beginTextScale);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={{ height: '52%' }}>
      <Text style={s.title}>글자 크기</Text>
      <Text style={s.lead}>보기 편한 크기를 고르세요. 고르면 잠깐 뒤 앱 전체 글자 크기가 바뀌어요.</Text>

      <View style={s.list}>
        {OPTIONS.map((o) => {
          const on = textScale === o.key;
          const factor = TEXT_SCALE_FACTOR[o.key];
          return (
            <Pressable
              key={o.key}
              onPress={() => {
                // 이미 그 크기면 전환 없이 시트만 닫는다. 다른 크기면 로딩 오버레이 뒤에서 반영.
                if (o.key === textScale) onClose();
                else beginTextScale(o.key);
              }}
              style={({ pressed }) => [s.row, on && s.rowOn, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`글자 크기 ${o.label}`}
            >
              {/* 각 옵션이 실제 그 배율로 보이는 미리보기 — 눌러 비교하지 않아도 차이가 보인다. */}
              <Text style={[s.sample, { fontSize: Math.round(17 * factor) }]}>가나다 Aa</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{o.label}</Text>
                <Text style={s.rowSub}>{o.sub}</Text>
              </View>
              {on && <Ionicons name="checkmark-circle" size={22} color={InkColors.ink} />}
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={onClose} style={({ pressed }) => [s.doneBtn, pressed && { opacity: 0.85 }]}>
        <Text style={s.doneText}>닫기</Text>
      </Pressable>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 4 },
  lead: { fontSize: 12.5, color: InkColors.ink2, paddingHorizontal: 16, paddingBottom: 12, lineHeight: 18 },
  list: { paddingHorizontal: 16, gap: 8, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  rowOn: { borderColor: InkColors.ink, backgroundColor: BrandColors.yellowSoft },
  sample: { fontWeight: '800', color: InkColors.ink, width: 92 },
  rowLabel: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 12, color: InkColors.ink3, marginTop: 1 },
  doneBtn: { marginHorizontal: 16, marginTop: 12, marginBottom: 18, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
