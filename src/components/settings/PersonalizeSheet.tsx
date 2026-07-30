import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/BottomSheet';
import { STORE_COLORS } from '@/lib/utils/storeColor';
import { InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 매장 개인화 시트 — 이 매장에 붙일 나만의 닉네임 + 색(자동색 포함).
 * 직원(junior/settings)·사장(owner/settings) 매장 설정이 공유한다(unit_member_prefs 레이어).
 * draft 는 부모가 소유(제어형) — 시트 안 effect seed 는 lint set-state-in-effect 라 금지.
 */
export function PersonalizeSheet({
  visible,
  name,
  setName,
  sel,
  setSel,
  autoColor,
  storeName,
  onClose,
  onSave,
}: {
  visible: boolean;
  name: string;
  setName: (v: string) => void;
  sel: string | null;
  setSel: (v: string | null) => void;
  autoColor: string;
  storeName: string;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={{ paddingBottom: 24 }}>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>매장 표시</Text>
        <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={20} color={InkColors.ink2} /></Pressable>
      </View>
      <View style={styles.sheetBody}>
        <Text style={styles.fieldLabel}>내가 보는 매장 이름</Text>
        <TextInput
          value={name}
          onChangeText={(v) => setName(v.slice(0, 20))}
          placeholder={storeName}
          placeholderTextColor={InkColors.ink3}
          style={styles.input}
          maxLength={20}
        />
        <Text style={styles.fieldHint}>이 매장을 부르는 나만의 이름이에요 (나만 보여요).</Text>

        <Text style={[styles.fieldLabel, { marginTop: 18 }]}>매장 색</Text>
        <View style={styles.swatchRow}>
          {/* 자동색 = 저장값 없음(null). */}
          {/* hitSlop 5 — 스와치는 38dp라 그대로면 터치 타깃 하한(48dp) 미달. 색 원은 그대로 두고 터치만 넓힌다. */}
          <Pressable onPress={() => setSel(null)} hitSlop={5} style={[styles.swatch, { backgroundColor: autoColor }, sel === null && styles.swatchOn]} accessibilityRole="button" accessibilityLabel="자동 색">
            {sel === null && <Ionicons name="checkmark" size={16} color="#fff" />}
          </Pressable>
          {STORE_COLORS.map((c) => (
            <Pressable key={c} onPress={() => setSel(c)} hitSlop={5} style={[styles.swatch, { backgroundColor: c }, sel === c && styles.swatchOn]} accessibilityRole="button" accessibilityLabel={`색 ${c}`}>
              {sel === c && <Ionicons name="checkmark" size={16} color="#fff" />}
            </Pressable>
          ))}
        </View>

        <Pressable onPress={onSave} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.saveBtnText}>저장</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  sheetBody: { paddingHorizontal: 20, paddingTop: 6 },
  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 8 },
  fieldHint: { fontSize: 12, color: InkColors.ink3, marginTop: 6 },
  input: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.bg },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  swatch: { width: 38, height: 38, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: InkColors.ink },
  saveBtn: { marginTop: 22, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 15, alignItems: 'center', ...Elevation.e1 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
