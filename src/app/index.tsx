import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER } from '@/lib/theme/layout';
import { Appear } from '@/components/Appear';
import { Wordmark } from '@/components/Wordmark';

/**
 * 랜딩(홈) — 기존 로그인 화면을 대체한다.
 * QR로 들어온 사장님이 스크롤만으로 [공감(문제) → 해결(기능) → 무료(파일럿)]를 읽고
 * 우하단 고정 FAB로 자연스럽게 가입(/signup)에 도달하는 1단 세로 스토리.
 * 로그인 폼은 /login 으로 분리 — 재방문·로그아웃 복귀는 상단/오퍼의 '로그인' 링크로.
 */

type Pain = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };
const PAINS: Pain[] = [
  { icon: 'repeat-outline', title: '또 처음부터 교육', body: '알바가 바뀔 때마다 같은 걸 몇 번씩 다시 설명하고 계신가요?' },
  { icon: 'call-outline', title: '쉬는 날에도 울리는 전화', body: '"사장님, 이건 어떻게 해요?" 쉬는 날에도 마음 편할 틈이 없어요.' },
  { icon: 'bulb-outline', title: '노하우가 머릿속에만', body: '내가 없으면 멈추는 가게. 그렇다고 하나하나 적어둘 시간도 없죠.' },
  { icon: 'chatbubbles-outline', title: '지시가 여기저기 흩어져요', body: '카톡 공지·메모지·말로 전한 지시… 결국 아무도 제대로 안 봐요.' },
];

type Feature = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };
const FEATURES: Feature[] = [
  { icon: 'sparkles', title: '우리 가게 노하우, AI가 즉답', body: '사장님이 한 번만 답을 남기면, 직원이 물을 때 AI가 우리 가게 방식 그대로 대신 답해요.' },
  { icon: 'checkmark-done', title: '오픈·마감 체크리스트 한눈에', body: '오늘 할 일과 마감 점검을 채팅에서 착착. 누가 뭘 끝냈는지 사장님이 바로 확인해요.' },
  { icon: 'chatbubble-ellipses', title: '매장 관리가 채팅 하나로', body: '공지·지시·질문이 흩어지지 않고 한곳에. 알바가 바뀌어도 노하우는 그대로 쌓여요.' },
];

const OFFERS = ['설치 없이 QR로 바로 시작', '사장님이 답을 남기면 AI 두뇌 완성', '부담되면 언제든 그만두기'];

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const status = useSessionStore((s) => s.status);
  const role = useSessionStore((s) => s.role);

  // 이미 로그인된 재방문자는 마케팅을 건너뛰고 각자 홈으로. (데모 빌드는 항상 랜딩을 보여준다)
  if (HAS_SUPABASE && status === 'signed_in') {
    return <Redirect href={role === 'owner' ? '/owner/dashboard' : '/junior/home'} />;
  }
  if (HAS_SUPABASE && status === 'loading') return null; // 스플래시가 덮는 구간 — 깜빡임 방지

  const goSignup = () => router.push('/signup');
  const goLogin = () => router.push('/login');

  return (
    <View style={styles.root}>
      {/* 상단 바 — 재방문자용 로그인 링크 (스크롤 없이 탈출) */}
      <View style={[styles.topbar, { paddingTop: insets.top + Space.sm }]}>
        <Pressable onPress={goLogin} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.5 }}>
          <Text style={styles.topLogin}>로그인</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 132 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HERO ── */}
        <Appear style={styles.hero}>
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>파일럿 매장 무료 모집 중</Text>
          </View>

          <Wordmark size="lg" showEng style={styles.wordmark} />

          <Text style={styles.h1}>
            사장님이 자리를 비워도,{'\n'}
            <Text style={styles.h1Strong}>가게는 사장님처럼</Text> 답합니다.
          </Text>
          <Text style={styles.heroSub}>
            한 번만 답해두면, AI가 평생 대신 답해요.{'\n'}
            카톡·메모지 대신 채팅 하나로 매장이 굴러갑니다.
          </Text>

          <View style={styles.scrollCue}>
            <Text style={styles.scrollCueText}>내려서 살펴보기</Text>
            <Ionicons name="chevron-down" size={16} color={InkColors.ink3} />
          </View>
        </Appear>

        {/* ── PROBLEM ── */}
        <View style={styles.section}>
          <Appear>
            <Text style={styles.kicker}>혹시, 이런 하루 아니세요?</Text>
            <Text style={styles.h2}>매일 반복되는 매장 스트레스</Text>
          </Appear>
          <View style={styles.stack}>
            {PAINS.map((p, i) => (
              <Appear key={p.title} delay={80 + i * 70}>
                <View style={styles.painCard}>
                  <View style={styles.painChip}>
                    <Ionicons name={p.icon} size={20} color={InkColors.ink2} />
                  </View>
                  <View style={styles.painText}>
                    <Text style={styles.painTitle}>{p.title}</Text>
                    <Text style={styles.painBody}>{p.body}</Text>
                  </View>
                </View>
              </Appear>
            ))}
          </View>
        </View>

        {/* ── SOLUTION ── */}
        <View style={styles.section}>
          <Appear>
            <Text style={[styles.kicker, styles.kickerInk]}>그래서, 착착이 대신합니다</Text>
            <Text style={styles.h2}>사장님 대신 답하고, 대신 챙겨요</Text>
          </Appear>
          <View style={styles.stack}>
            {FEATURES.map((f, i) => (
              <Appear key={f.title} delay={80 + i * 80}>
                <View style={styles.featCard}>
                  <View style={styles.featChip}>
                    <Ionicons name={f.icon} size={22} color={BrandColors.yellow} />
                  </View>
                  <View style={styles.painText}>
                    <Text style={styles.featTitle}>{f.title}</Text>
                    <Text style={styles.featBody}>{f.body}</Text>
                  </View>
                </View>
              </Appear>
            ))}
          </View>
        </View>

        {/* ── OFFER ── */}
        <View style={styles.section}>
          <Appear delay={60}>
            <View style={styles.offerCard}>
              <View style={styles.badge}>
                <View style={styles.badgeDot} />
                <Text style={styles.badgeText}>지금은 파일럿 기간</Text>
              </View>
              <Text style={styles.offerTitle}>모든 기능, 지금은 전액 무료</Text>
              <Text style={styles.offerBody}>
                함께 만들어갈 매장을 모집하고 있어요.{'\n'}
                파일럿 매장은 카드 등록 없이 무료로 씁니다.
              </Text>

              <View style={styles.offerList}>
                {OFFERS.map((t) => (
                  <View key={t} style={styles.offerRow}>
                    <Ionicons name="checkmark-circle" size={18} color={InkColors.ink} />
                    <Text style={styles.offerRowText}>{t}</Text>
                  </View>
                ))}
              </View>

              <Pressable onPress={goSignup} style={({ pressed }) => [styles.offerCta, pressed && { opacity: 0.88 }]}>
                <Text style={styles.offerCtaText}>무료로 시작하기</Text>
                <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
              </Pressable>

              <Pressable onPress={goLogin} hitSlop={8} style={styles.offerLogin}>
                <Text style={styles.offerLoginText}>이미 착착을 쓰고 계신가요? <Text style={styles.offerLoginStrong}>로그인</Text></Text>
              </Pressable>
            </View>
          </Appear>
        </View>
      </ScrollView>

      {/* ── 우하단 고정 CTA (FAB) — 스크롤 위치와 무관하게 항상 노출 ── */}
      <Appear delay={280} offsetY={16} style={[styles.fabWrap, { bottom: insets.bottom + 24 }]}>
        <Pressable onPress={goSignup} style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.97 }] }]}>
          <Text style={styles.fabText}>무료로 시작하기</Text>
          <Ionicons name="arrow-forward" size={18} color={InkColors.ink} />
        </Pressable>
      </Appear>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: InkColors.cream },

  topbar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: SCREEN_GUTTER, paddingBottom: Space.sm },
  topLogin: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: InkColors.ink2 },

  scroll: { paddingHorizontal: SCREEN_GUTTER, gap: 40 },

  // ── HERO ──
  hero: { alignItems: 'center', paddingTop: Space.md, gap: Space.lg },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: BrandColors.yellowSoft,
    borderColor: BrandColors.yellowDeep,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  badgeDot: { width: 7, height: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.yellowDeep },
  badgeText: { fontSize: 12, lineHeight: 17, fontWeight: '800', color: InkColors.ink },
  wordmark: { marginTop: Space.xs },
  h1: { fontSize: 27, lineHeight: 38, fontWeight: '900', color: InkColors.ink, textAlign: 'center', letterSpacing: -0.6 },
  h1Strong: { color: InkColors.ink },
  heroSub: { fontSize: 15, lineHeight: 24, color: InkColors.ink2, textAlign: 'center', fontWeight: '600' },
  scrollCue: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Space.xs },
  scrollCueText: { fontSize: 12, lineHeight: 17, color: InkColors.ink3, fontWeight: '600' },

  // ── SECTION 공통 ──
  section: { gap: Space.lg },
  kicker: { fontSize: 13, lineHeight: 19, fontWeight: '800', color: InkColors.ink3, letterSpacing: -0.2 },
  kickerInk: { color: BrandColors.yellowDeep },
  h2: { fontSize: 21, lineHeight: 30, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4, marginTop: 2 },
  stack: { gap: Space.md },

  // ── PROBLEM ──
  painCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    ...Elevation.e1,
  },
  painChip: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: InkColors.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  painText: { flex: 1, gap: 3 },
  painTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  painBody: { fontSize: 13, lineHeight: 20, color: InkColors.ink2 },

  // ── SOLUTION ──
  featCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    ...Elevation.e2,
  },
  featChip: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  featBody: { fontSize: 13, lineHeight: 20, color: InkColors.ink2 },

  // ── OFFER ──
  offerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.sheet,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.xl,
    gap: Space.md,
    ...Elevation.e2,
  },
  offerTitle: { fontSize: 22, lineHeight: 31, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4, marginTop: 2 },
  offerBody: { fontSize: 14, lineHeight: 22, color: InkColors.ink2, fontWeight: '600' },
  offerList: { gap: Space.sm, marginTop: Space.xs },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  offerRowText: { fontSize: 14, lineHeight: 21, color: InkColors.ink, fontWeight: '700' },
  offerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: BrandColors.brand,
    paddingVertical: 16,
    borderRadius: Radius.md,
    marginTop: Space.sm,
  },
  offerCtaText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '800' },
  offerLogin: { alignItems: 'center', paddingVertical: Space.xs },
  offerLoginText: { fontSize: 13, lineHeight: 19, color: InkColors.ink3 },
  offerLoginStrong: { color: InkColors.ink, fontWeight: '800' },

  // ── FAB ──
  fabWrap: { position: 'absolute', right: SCREEN_GUTTER },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.yellow,
    paddingLeft: 22,
    paddingRight: 18,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    ...Elevation.ey,
  },
  fabText: { fontSize: 16, lineHeight: 22, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.2 },
});
