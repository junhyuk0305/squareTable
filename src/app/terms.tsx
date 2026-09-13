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

// 이용약관 요약. 전문의 SSOT 는 웹 정적 페이지(scripts/legal-content.mjs → /terms)이고
// 이 화면은 요약 + 전문 링크만 둔다 — 전문을 앱과 웹에 이중 유지하면 반드시 어긋난다.
export default function TermsScreen() {
  // 설정에서 진입하는 공용 화면 — 사장/알바 어느 쪽에서 왔는지에 맞춰 하단 탭바를 그대로 유지한다.
  const role = useSessionStore((s) => s.role);
  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <Stack.Screen options={{ headerShown: false, title: '이용약관', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink }} />
      <ScreenTitleHeader title="이용약관" backFallback />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>매장의 정석 이용약관</Text>
        <Text style={styles.updated}>시행일: {TERMS_VERSION} · 운영: 스퀘어테이블</Text>

        <Section title="제1조 (목적)">
          본 약관은 스퀘어테이블(이하 “회사”)이 제공하는 매장 운영 지원 서비스 “매장의 정석”(이하 “서비스”)의 이용 조건 및 절차, 회사와 이용자의 권리·의무를 규정합니다.
        </Section>
        <Section title="제2조 (이용 계약)">
          이용자는 휴대전화 본인 확인을 거쳐 회원가입 시 본 약관에 동의함으로써 서비스를 이용할 수 있습니다. 매장 단위로 계정이 생성되며, 사장님은 초대코드로 직원을 합류시키고 매니저를 지정할 수 있습니다. 만 14세 미만은 가입할 수 없습니다.
        </Section>
        <Section title="제2조의2 (생성형 AI 고지)">
          노하우 정리·직원 질문 답변·퀴즈 출제·음성 변환·PDF 추출은 생성형 AI(Google Gemini)에 기반하며, AI가 만든 결과물에는 “AI가 답함” 등 표시를 붙입니다. 결과물은 참고용이며 최종 판단과 책임은 이용자에게 있습니다.
        </Section>
        {/* ★2026-09-13: 이 요약이 "앱 안에서는 결제하지 않습니다"라고 말하고 있었다. iOS 가 인앱결제를
            받게 되면서 **거짓이 됐고**, 하필 구매 화면(IapPurchasePanel)이 이 화면을 링크한다 —
            심사관이 구매 버튼 옆에서 그 문장을 읽는 상태였다. 외부 결제 사이트 주소가 앱 안에 노출되던
            것도 같이 걷었다(3.1.1(a) — 한국 스토어프론트는 아웃링크·안내도 금지).
            ⛔채널을 "웹/앱"으로 나눠 쓰지 않는다 — 이 화면은 웹에서도 같은 글이 뜬다. */}
        <Section title="제3조 (유료 서비스 및 결제)">
          일부 기능은 매장 단위 월 선불 이용권으로 제공되며, 요금은 부가가치세를 포함한 금액입니다. 생성형 AI 기능은 매장당 월 사용량 한도(무료 200 · 유료 3,000) 안에서 제공되고, 직원 질문 답변 1건은 1, 퀴즈 문항 생성 1회는 2, PDF 내용 추출은 1쪽당 1을 사용합니다. 앱에서 구매하신 이용권은 앱 마켓을 통한 월 단위 자동 갱신 구독이며, 해지하시기 전까지 갱신일마다 자동으로 결제됩니다. 해지는 기기 설정의 구독 목록에서 언제든지 하실 수 있습니다. 회사는 카드번호·계좌번호 등 결제수단 정보를 수집하거나 보관하지 않습니다.
        </Section>
        <Section title="제4조 (무상 이용기간·이용권 종료·환불)">
          신규 매장에는 일정 기간(예: 14일) 유료 기능을 무상 제공할 수 있으며, 기간이 끝나도 자동으로 요금이 청구되지 않습니다. 이용권이 끝나면 무료 요금제로 전환되고 매장 데이터는 삭제되지 않습니다. 앱 마켓에서 구매한 구독의 환불과 해지는 해당 앱 마켓의 정책에 따르며, 회사는 대금을 보유하지 않아 대신 환불해 드릴 수 없습니다. 그 밖의 환불은 전자상거래법 및 약관 전문 제13조(개시 전 전액, 미사용 7일 이내 전액, 이용 중 해지 시 일할 정산)에 따릅니다.
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

        {/* 전문은 웹 정적 페이지가 정본이다. 앱에는 요약만 두고 이중 유지하지 않는다.
            ★앱 판(/app/terms) — 푸터에 홈·요금 링크가 없는 판(seo-postbuild LEGAL_VARIANTS). 웹 판을 열면 안 된다. */}
        <Pressable
          onPress={() => void Linking.openURL('https://dochackchack.com/app/terms').catch(() => {})}
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
