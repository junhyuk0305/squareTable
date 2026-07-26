import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';

// 개인정보처리방침 요약. 전문의 SSOT 는 웹 정적 페이지(scripts/legal-content.mjs → /privacy)이고
// 이 화면은 요약 + 전문 링크만 둔다 — 전문을 앱과 웹에 이중 유지하면 반드시 어긋난다.
export default function PrivacyScreen() {
  // 설정에서 진입하는 공용 화면 — 사장/알바 어느 쪽에서 왔는지에 맞춰 하단 탭바를 그대로 유지한다.
  const role = useSessionStore((s) => s.role);
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: '개인정보 처리방침', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>개인정보 수집·이용 안내</Text>
        <Text style={styles.updated}>시행일: 2026-08-07 · 운영: 팀 스퀘어테이블</Text>

        <Section title="1. 수집 항목">
          이름, 이메일, 휴대전화번호, 생년월일, 매장 정보, 사용자가 입력한 매장 운영 노하우·질문 내용.
        </Section>
        <Section title="2. 수집·이용 목적">
          매장 단위 계정 식별, 노하우 저장·검색·답변 제공, 알바-사장님 간 질문 전달 등 서비스 핵심 기능 제공, 서비스 이용 통계 및 세대 간 지식 교류 분석.
        </Section>
        <Section title="3. 보유·이용 기간">
          회원 탈퇴 또는 매장 계약 종료 시까지. 이후 지체 없이 파기합니다. 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.
        </Section>
        <Section title="4. 처리 위탁">
          서비스 운영을 위해 클라우드 인프라(Supabase), 웹 호스팅(Vercel), AI 처리 제공자(Google)에 데이터 처리를 위탁하며, 이들은 국외 사업자입니다. 위탁·국외이전의 상세와 이전 거부 방법은 전문 제5조·제6조에 있습니다.
        </Section>
        <Section title="5. 이용자 권리">
          본인의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 아래 연락처로 문의하면 지체 없이 처리합니다.
        </Section>
        <Section title="6. 문의처">
          개인정보 보호책임자 장준혁 · contact@team-roundtable.com
        </Section>

        {/* 전문은 웹 정적 페이지가 정본이다. Apple 5.1.1(i)은 앱 안에서도 방침에 접근 가능할 것을
            요구하므로 이 링크가 그 요건을 채운다. */}
        <Pressable
          onPress={() => void Linking.openURL('https://dochackchack.com/privacy').catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="개인정보처리방침 전문 보기"
        >
          <Text style={styles.link}>개인정보처리방침 전문 보기</Text>
        </Pressable>
        <View style={{ height: 24 }} />
      </ScrollView>
      <RoleTabBar role={role} />
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
  link: { fontSize: 14, fontWeight: '700', color: InkColors.ink, textDecorationLine: 'underline', marginTop: Space.sm },
});
