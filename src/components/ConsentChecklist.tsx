import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { consentRows, type ConsentChecked, type ConsentKey } from '@/lib/config/consent';
import { BrandColors, InkColors } from '@/lib/theme/colors';

/**
 * 가입 동의 체크리스트(J12). 가입 화면과 프로필 완성(구글 가입) 화면이 같이 쓴다.
 * 행은 consent.ts 정본에서 온다. '전체 동의'는 선택(마케팅)까지 모두 체크한다.
 */
export function ConsentChecklist({
  role,
  checked,
  onChange,
}: {
  role: 'owner' | 'junior';
  checked: ConsentChecked;
  onChange: (next: ConsentChecked) => void;
}) {
  const router = useRouter();
  const rows = consentRows(role);
  const all = rows.every((r) => !!checked[r.key]);
  const toggleAll = () => {
    const next: ConsentChecked = { ...checked };
    rows.forEach((r) => (next[r.key] = !all));
    onChange(next);
  };
  const toggleOne = (k: ConsentKey) => onChange({ ...checked, [k]: !checked[k] });

  return (
    <View style={styles.consentBox}>
      <Pressable onPress={toggleAll} style={styles.consentAll}>
        <View style={[styles.checkbox, all && styles.checkboxOn]}>
          {all && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.consentAllText}>약관에 모두 동의합니다</Text>
      </Pressable>
      <View style={styles.consentDivider} />
      {rows.map((r) => (
        <Pressable key={r.key} onPress={() => toggleOne(r.key)} style={styles.consentRow}>
          <View style={[styles.checkboxSm, checked[r.key] && styles.checkboxOn]}>
            {checked[r.key] && <Text style={styles.checkmarkSm}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            <Text style={styles.consentReq}>{r.required ? '[필수] ' : '[선택] '}</Text>
            {r.label}
          </Text>
          {r.doc && (
            <Text style={styles.consentLink} onPress={() => router.push(r.doc!)}>
              보기
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  consentBox: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: InkColors.line, borderRadius: 14, padding: 14, marginTop: 8, gap: 4 },
  consentAll: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  consentAllText: { flex: 1, fontSize: 14, fontWeight: '800', color: InkColors.ink },
  consentDivider: { height: 1, backgroundColor: InkColors.line, marginVertical: 6 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxSm: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxOn: { backgroundColor: BrandColors.brand, borderColor: BrandColors.brand },
  checkmark: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  checkmarkSm: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  consentText: { flex: 1, fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  consentReq: { fontWeight: '800', color: InkColors.ink },
  consentLink: { color: BrandColors.brand, fontWeight: '800', textDecorationLine: 'underline', fontSize: 12 },
});
