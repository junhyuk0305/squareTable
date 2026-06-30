import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HeaderBackButton } from '@/components/HeaderBackButton';

// 판매자(사업자) 정보 — 전자상거래법상 유료 판매 시 고지 의무. 실제 사업자등록 후 값 채울 것.
const ROWS: Array<[string, string]> = [
  ['상호', '팀 스퀘어테이블'],
  ['대표자', '장준혁'],
  ['사업자등록번호', '등록 예정 (출시 전 기재)'],
  ['통신판매업 신고번호', '신고 예정 (출시 전 기재)'],
  ['주소', '출시 전 기재'],
  ['고객문의', 'cristianojun@naver.com'],
  ['호스팅 제공자', 'Supabase / Vercel'],
];

export default function BusinessInfoScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '사업자 정보', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>판매자 정보</Text>
        <View style={styles.card}>
          {ROWS.map(([k, v], i) => (
            <View key={k} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Text style={styles.k}>{k}</Text>
              <Text style={styles.v}>{v}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>
          ※ 전자상거래 등에서의 소비자보호에 관한 법률에 따른 판매자 정보 고지입니다. 사업자등록·통신판매업 신고 완료 후 정확한 값으로 갱신됩니다.
        </Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 24, gap: 16 },
  h1: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  card: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, overflow: 'hidden' },
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  k: { width: 120, fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  v: { flex: 1, fontSize: 14, color: InkColors.ink2, lineHeight: 20 },
  note: { fontSize: 12, color: InkColors.ink3, lineHeight: 18 },
});
