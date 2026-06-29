import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';

// 개인정보 수집·이용 안내 (1차 출시 최소선). 정식 약관은 법무 검토 후 교체.
export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: '개인정보 처리방침', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>개인정보 수집·이용 안내</Text>
        <Text style={styles.updated}>시행일: 2026-06-10 · 운영: 팀 스퀘어테이블</Text>

        <Section title="1. 수집 항목">
          이름, 이메일, 휴대전화번호(끝 4자리), 매장 정보, 사용자가 입력한 매장 운영 노하우·질문 내용.
        </Section>
        <Section title="2. 수집·이용 목적">
          매장 단위 계정 식별, 노하우 저장·검색·답변 제공, 알바-사장님 간 질문 전달 등 서비스 핵심 기능 제공.
        </Section>
        <Section title="3. 보유·이용 기간">
          회원 탈퇴 또는 매장 계약 종료 시까지. 이후 지체 없이 파기합니다. 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.
        </Section>
        <Section title="4. 처리 위탁">
          서비스 운영을 위해 클라우드 인프라(Supabase) 및 AI 처리 제공자에 데이터 처리를 위탁할 수 있습니다.
        </Section>
        <Section title="5. 이용자 권리">
          본인의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 아래 연락처로 문의하면 지체 없이 처리합니다.
        </Section>
        <Section title="6. 문의처">
          cristianojun@naver.com
        </Section>

        <Text style={styles.note}>
          ※ 본 안내는 파일럿 1차 출시용 최소 고지입니다. 정식 서비스 전 개인정보처리방침을 보완합니다.
        </Text>
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
