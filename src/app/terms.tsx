import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';

// 이용약관 (1차 출시 최소선). 정식 약관은 PG 계약·법무 검토 후 교체.
export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '이용약관', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>스퀘어테이블 이용약관</Text>
        <Text style={styles.updated}>시행일: 2026-06-10 · 운영: 팀 스퀘어테이블</Text>

        <Section title="제1조 (목적)">
          본 약관은 팀 스퀘어테이블(이하 "회사")이 제공하는 매장 운영 지원 서비스 "스퀘어테이블"(이하 "서비스")의 이용 조건 및 절차, 회사와 이용자의 권리·의무를 규정합니다.
        </Section>
        <Section title="제2조 (이용 계약)">
          이용자는 회원가입 시 본 약관에 동의함으로써 서비스를 이용할 수 있습니다. 매장 단위로 계정이 생성되며, 사장님은 초대코드로 직원을 합류시킬 수 있습니다.
        </Section>
        <Section title="제3조 (유료 서비스 및 결제)">
          일부 기능은 매장 단위 월 정기결제(구독)로 제공됩니다. 결제 금액·주기·해지 방법은 결제 화면에 고지하며, 결제는 회사가 위탁한 전자결제대행사를 통해 처리됩니다.
        </Section>
        <Section title="제4조 (구독 해지 및 환불)">
          이용자는 언제든지 구독을 해지할 수 있습니다. 환불은 관계 법령(전자상거래법 등) 및 회사가 별도 고지하는 환불 정책에 따릅니다.
        </Section>
        <Section title="제5조 (이용자의 의무)">
          이용자는 타인의 정보를 도용하거나, 서비스 운영을 방해하거나, 법령·공서양속에 반하는 콘텐츠를 등록해서는 안 됩니다.
        </Section>
        <Section title="제6조 (회사의 책임)">
          회사는 안정적인 서비스 제공을 위해 노력하나, 천재지변·제3자 인프라 장애 등 불가항력으로 인한 손해에 대해서는 책임이 제한될 수 있습니다.
        </Section>
        <Section title="제7조 (콘텐츠의 권리)">
          이용자가 등록한 매장 노하우·데이터의 권리는 해당 매장에 귀속합니다. 회사는 서비스 제공 목적 범위에서만 이를 처리합니다.
        </Section>
        <Section title="제8조 (문의)">
          서비스 관련 문의: contact@team-roundtable.com
        </Section>

        <Text style={styles.note}>※ 본 약관은 파일럿 1차 출시용 최소본입니다. 정식 서비스 전 법무 검토를 거쳐 보완합니다.</Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 24, gap: 16 },
  h1: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  updated: { fontSize: 12, color: InkColors.ink3, marginTop: -8 },
  section: { gap: 5 },
  h2: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  body: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  note: { fontSize: 12, color: InkColors.ink3, lineHeight: 18, marginTop: 8 },
});
