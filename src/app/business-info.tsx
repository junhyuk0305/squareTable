import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { Appear } from '@/components/Appear';
import { businessRows, BUSINESS_INFO_COMPLETE } from '@/lib/config/business';

// 판매자(사업자) 정보 — 전자상거래법상 유료 판매 시 고지 의무.
// 값 SSOT = src/lib/config/business.ts. 빈 값은 행 자체가 렌더되지 않는다
// ('등록 예정' 같은 placeholder 문자열은 App Review 2.1(a) 위반).

export default function BusinessInfoScreen() {
  const rows = businessRows();
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '사업자 정보', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Appear delay={0}>
          <Text style={styles.h1}>판매자 정보</Text>
        </Appear>
        <Appear delay={60}>
        <View style={styles.card}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Text style={styles.k}>{k}</Text>
              <Text style={styles.v}>{v}</Text>
            </View>
          ))}
        </View>
        </Appear>
        <Appear delay={120}>
        <Text style={styles.note}>
          {BUSINESS_INFO_COMPLETE
            ? '※ 전자상거래 등에서의 소비자보호에 관한 법률에 따른 판매자 정보 고지입니다.'
            : '※ 전자상거래 등에서의 소비자보호에 관한 법률에 따른 판매자 정보 고지입니다. 사업자등록·통신판매업 신고 절차가 진행 중이며, 완료되는 즉시 등록번호 등 나머지 정보를 여기에 게시합니다. 그 전까지의 문의는 설정의 문의하기로 받고 있습니다.'}
        </Text>
        </Appear>
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
