import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canManage } from '@/lib/utils/roles';
import { TERMS_VERSION } from '@/lib/config/business';

// 개인정보처리방침 요약. 전문의 SSOT 는 웹 정적 페이지(scripts/legal-content.mjs → /privacy)이고
// 이 화면은 요약 + 전문 링크만 둔다 — 전문을 앱과 웹에 이중 유지하면 반드시 어긋난다.
export default function PrivacyScreen() {
  // 설정에서 진입하는 공용 화면 — 사장/알바 어느 쪽에서 왔는지에 맞춰 하단 탭바를 그대로 유지한다.
  const role = useSessionStore((s) => s.role);
  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <Stack.Screen options={{ headerShown: false, title: '개인정보 처리방침', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
      <ScreenTitleHeader title="개인정보 처리방침" backFallback />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>개인정보 수집·이용 안내</Text>
        <Text style={styles.updated}>시행일: {TERMS_VERSION} · 운영: 스퀘어테이블</Text>

        <Section title="1. 수집 항목">
          이름, 이메일, 비밀번호, 휴대전화번호(본인 확인 기록 포함), 생년월일, 매장 정보, 사장님이 입력하는 직원 근로정보(근무표·출퇴근·시급), 노하우·사진·질문·채팅·업무·퀴즈 등 콘텐츠, 음성·PDF(변환·추출 즉시 파기), 서비스 이용·오류 기록, 푸시 알림 수신 주소, 유료 이용 시 입금자명 등 결제 신고 정보. 카메라·위치·주민등록번호·광고 식별자는 수집하지 않습니다.
        </Section>
        <Section title="2. 수집·이용 목적">
          매장 단위 계정 식별과 휴대전화 본인 확인, 노하우 저장·검색·AI 답변 제공, 직원-사장님 간 질문 전달, 근무·급여 관리 지원, 유료 이용권 관리, 문의 응대와 업무 알림, 서비스 이용 통계·품질 개선 분석 및 세대 간 지식 교류 분석.
        </Section>
        <Section title="3. 보유·이용 기간">
          탈퇴 신청 즉시 이용이 차단되고 30일간 분리 보관 후 영구 파기합니다. 질문·채팅 기록은 6개월, 내부 이용·오류 기록은 12개월 경과분을 자동 파기하며, 결제 기록 등 관계 법령에 따라 보존이 필요한 정보는 해당 기간 동안만 분리 보관합니다.
        </Section>
        <Section title="4. 처리 위탁·국외 이전">
          인증 문자 발송은 솔라피(국내)에 위탁합니다. 데이터 보관(Supabase, 싱가포르), AI 처리(Google, 미국), 푸시 알림 전달(Expo·Google·Apple, 미국), 웹 이용 분석(PostHog, 미국), 웹 호스팅(Vercel, 미국)은 국외 사업자가 처리합니다. 휴대전화번호·시급·출퇴근 등 개인 식별·근로 정보는 AI로 보내지 않습니다. 항목·보유기간·거부 방법은 전문 제5조·제6조에 있습니다.
        </Section>
        <Section title="5. 이용자 권리와 앱 권한">
          본인의 개인정보 열람·정정·삭제·처리정지·동의 철회를 앱(설정 → 전체 계정 설정) 또는 아래 연락처로 요청할 수 있으며, 접수 후 10일 이내에 처리합니다. 마이크·사진·알림 권한은 모두 선택이며 기기 설정에서 언제든 끌 수 있습니다.
        </Section>
        <Section title="6. 문의처">
          개인정보 보호책임자 장준혁 · cristianojun@naver.com
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
