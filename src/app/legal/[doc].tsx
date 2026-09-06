import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { TERMS_VERSION } from '@/lib/config/business';
import { InkColors } from '@/lib/theme/colors';
import { HeaderBackButton } from '@/components/HeaderBackButton';

// 회원가입 동의의 '보기' 링크가 여는 문서들 — 동의 항목별 요약 고지.
// 기존 /terms(이용약관)·/privacy(처리방침)와 별도로, 동의 항목별 세부 문서를 제공.
// ★전문의 SSOT 는 scripts/legal-content.mjs(웹 /privacy·/terms). 수탁사·보유기간 등 사실 문구는
//   그쪽이 바뀌면 여기도 같이 고친다(2026-09-03 v2: 싱가포르 리전·30일 분리 보관·솔라피·Expo 반영).
type Doc = { title: string; h1: string; sections: { h: string; b: string }[]; note?: string };

const DOCS: Record<string, Doc> = {
  collect: {
    title: '개인정보 수집·이용 동의',
    h1: '개인정보 수집·이용 동의',
    sections: [
      { h: '수집 항목 (필수)', b: '이름, 이메일, 비밀번호, 휴대전화번호(본인 확인 기록 포함), 생년월일, 매장 정보(사장님은 업종 포함), 사용자가 입력한 운영 노하우·질문 내용, 서비스 이용·오류 기록.' },
      { h: '휴대전화번호 이용', b: '계정 식별·중복가입 방지(본인 확인 인증번호 문자는 국내 문자 발송 사업자 솔라피가 전송)·직원 초대·서비스 안내에 이용합니다.' },
      { h: '이용 목적', b: '매장 단위 계정 식별, 노하우 저장·검색·답변 제공, 직원-사장님 간 질문 전달 등 서비스 핵심 기능 제공, 서비스 이용 통계 및 세대 간 지식 교류 분석.' },
      { h: '처리 위탁 및 국외 이전', b: '데이터 보관은 Supabase(싱가포르), 노하우 구조화·검색·답변 생성은 AI 처리 수탁사 Google(Gemini API, 미국), 앱 푸시 알림 전달은 Expo·Google·Apple(미국)이 처리합니다. 입력하신 내용은 AI 모델 학습에 사용되지 않으며, 휴대전화번호·근로정보는 AI로 보내지 않습니다.' },
      { h: '보유·이용 기간', b: '회원 탈퇴 또는 매장 계약 종료 시까지. 탈퇴 신청 즉시 이용이 차단되고 30일간 분리 보관 후 영구 파기합니다.' },
      { h: '동의 거부 권리', b: '필수 항목 동의를 거부할 수 있으나, 이 경우 회원가입 및 서비스 이용이 제한됩니다. 선택 항목은 거부해도 됩니다.' },
    ],
    note: '※ 전체 내용은 개인정보처리방침 전문(설정 → 전체 계정 설정 → 개인정보처리방침)에서 확인할 수 있습니다.',
  },
  marketing: {
    title: '마케팅 정보 수신 동의',
    h1: '마케팅 정보 수신 동의 (선택)',
    sections: [
      { h: '수신 항목', b: '신규 기능·이벤트·혜택 안내 등 광고성 정보.' },
      { h: '전송 수단', b: '앱 푸시 알림, 이메일, 문자(SMS).' },
      { h: '선택 동의', b: '본 동의는 선택 사항이며, 동의하지 않아도 서비스 이용에 제한이 없습니다.' },
      { h: '철회 방법', b: '설정 › 알림에서 언제든 수신을 끌 수 있고, 수신 거부 시 광고성 정보 전송이 즉시 중단됩니다.' },
    ],
    note: '※ 정보통신망법에 따라 광고성 정보는 별도 동의를 받습니다.',
  },
  labor: {
    title: '근로·급여정보 처리 안내',
    h1: '근로·급여정보 처리 안내 (직원 필수)',
    sections: [
      { h: '처리 항목', b: '출근·퇴근 시각, 근무 시간, 시급, 예상 급여 등 근로 관리에 필요한 정보.' },
      { h: '처리 목적', b: '사장님이 직원의 근무·급여를 확인·정산할 수 있도록 출퇴근 기록과 시급 기반 예상 급여를 제공.' },
      { h: '열람 범위', b: '본인과 소속 매장 사장님이 같은 데이터를 열람합니다. 사장님이 지정한 매니저는 근무표·출근 기록만 볼 수 있고 시급·급여는 볼 수 없습니다. 다른 직원에게는 공개되지 않습니다.' },
      { h: '정정 권리', b: '본인이 출퇴근 시각을 직접 수정할 수 있으며, 수정 내역은 사장님에게 ‘직원 수정’으로 표시됩니다.' },
      { h: '보유 기간', b: '매장 소속 해제 또는 회원 탈퇴 시까지. 관계 법령상 보존 의무가 있는 경우 해당 기간 보관합니다.' },
    ],
    note: '※ 본 안내는 서비스 제공 목적의 근로정보 처리에 한하며, 근로계약 자체를 대체하지 않습니다.',
  },
};

export default function LegalDocScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  // ★모르는 슬러그를 '개인정보 수집·이용 동의'로 **제목까지 바꿔** 보여주지 않는다(#54).
  //   이 화면은 동의 화면에서 링크로 들어오는 자리라, 엉뚱한 문서가 뜨면 사용자가
  //   "내가 동의한 문서"를 오인한다. 없는 문서는 없다고 말한다.
  const data = DOCS[doc ?? ''] ?? null;
  if (!data) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ headerShown: true, title: '문서', headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.h1}>문서를 찾지 못했습니다</Text>
          <Text style={styles.body}>주소를 다시 확인해 주세요.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: true, title: data.title, headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: InkColors.ink, headerLeft: () => <HeaderBackButton /> }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>{data.h1}</Text>
        {/* ★시행일을 여기서 다시 적지 않는다(#54) — business.ts 의 TERMS_VERSION 이 정본이고,
            legal-content.mjs(웹 5종)도 같은 값을 쓴다. 이 화면만 2026-07-10 로 굳어 있어
            **결제 시 기록되는 약관 버전과 사용자가 읽는 시행일이 달랐다.** */}
        <Text style={styles.updated}>시행일: {TERMS_VERSION} · 운영: 스퀘어테이블</Text>
        {data.sections.map((s) => (
          <View key={s.h} style={styles.section}>
            <Text style={styles.h2}>{s.h}</Text>
            <Text style={styles.body}>{s.b}</Text>
          </View>
        ))}
        {data.note && <Text style={styles.note}>{data.note}</Text>}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
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
  note: { fontSize: 12, color: InkColors.ink3, lineHeight: 18, marginTop: 8 },
});
