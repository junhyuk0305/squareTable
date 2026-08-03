import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canManage } from '@/lib/utils/roles';

// 이용약관 요약. 전문의 SSOT 는 웹 정적 페이지(scripts/legal-content.mjs → /terms)이고
// 이 화면은 요약 + 전문 링크만 둔다 — 전문을 앱과 웹에 이중 유지하면 반드시 어긋난다.
export default function TermsScreen() {
  // 설정에서 진입하는 공용 화면 — 사장/알바 어느 쪽에서 왔는지에 맞춰 하단 탭바를 그대로 유지한다.
  const role = useSessionStore((s) => s.role);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '이용약관', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>착착 이용약관</Text>
        <Text style={styles.updated}>시행일: 2026-08-07 · 운영: 스퀘어테이블</Text>

        <Section title="제1조 (목적)">
          본 약관은 스퀘어테이블(이하 “회사”)이 제공하는 매장 운영 지원 서비스 “착착”(이하 “서비스”)의 이용 조건 및 절차, 회사와 이용자의 권리·의무를 규정합니다.
        </Section>
        <Section title="제2조 (이용 계약)">
          이용자는 회원가입 시 본 약관에 동의함으로써 서비스를 이용할 수 있습니다. 매장 단위로 계정이 생성되며, 사장님은 초대코드로 직원을 합류시킬 수 있습니다.
        </Section>
        <Section title="제3조 (유료 서비스 및 결제)">
          일부 기능은 매장 단위 월 선불 이용권으로 제공됩니다. 결제는 계좌이체로 하며, 회사는 결제수단을 저장하지 않고 자동결제·자동청구를 하지 않습니다. 요금은 앱 내 요금제 화면에 게시합니다.
        </Section>
        <Section title="제4조 (이용권 종료 및 환불)">
          이용 기간이 끝나면 추가 요금 없이 무료 요금제로 자동 전환되며, 매장 데이터는 삭제되지 않습니다. 환불은 전자상거래법 및 약관 전문 제13조(개시 전 전액, 이용 중 해지 시 일할 정산)에 따릅니다.
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
          서비스 관련 문의: cristianojun@naver.com
        </Section>

        {/* 전문은 웹 정적 페이지가 정본이다. 앱에는 요약만 두고 이중 유지하지 않는다. */}
        <Pressable
          onPress={() => void Linking.openURL('https://dochackchack.com/terms').catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="이용약관 전문 보기"
        >
          <Text style={styles.link}>이용약관 전문 보기</Text>
        </Pressable>
        <View style={{ height: 24 }} />
      </ScrollView>
      <RoleTabBar role={canManage(role) ? 'owner' : 'junior'} />
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
  body: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  link: { fontSize: 14, fontWeight: '700', color: InkColors.ink, textDecorationLine: 'underline', marginTop: Space.sm },
});
