import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { HAS_SUPABASE } from '@/lib/supabase';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, Gap, SCREEN_GUTTER } from '@/lib/theme/layout';
import { Appear, stagger } from '@/components/Appear';
import { Wordmark } from '@/components/Wordmark';

/**
 * 랜딩 목록의 초기 지연(ms) — 섹션 제목이 먼저 서고 카드가 뒤따르게 하는 한 박자.
 * 줄 간격은 `stagger(i)` 가 정한다(SSOT). 자리마다 다른 숫자를 흩뿌리지 않기 위해 여기 한 곳에만 둔다.
 */
const LANDING_LEAD = 80;

/**
 * 랜딩(홈) — 기존 로그인 화면을 대체한다.
 * QR로 들어온 사장님이 스크롤만으로 [공감(문제) → 해결(기능) → 무료(무료 티어)]를 읽고
 * 우하단 고정 FAB로 자연스럽게 가입(/signup)에 도달하는 1단 세로 스토리.
 * 로그인 폼은 /login 으로 분리 — 재방문·로그아웃 복귀는 상단/오퍼의 '로그인' 링크로.
 */

type Pain = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };
const PAINS: Pain[] = [
  { icon: 'repeat-outline', title: '또 처음부터', body: '직원 한 명 바뀔 때마다 같은 설명을 다시 해요.' },
  { icon: 'call-outline', title: '쉬는 날에 오는 전화', body: '"사장님, 이건 어떻게 해요?"' },
  { icon: 'bulb-outline', title: '머릿속에만 있는 노하우', body: '적어둘 시간이 없어요. 그래서 내가 없으면 매장이 멈춰요.' },
  { icon: 'chatbubbles-outline', title: '흩어진 지시', body: '카톡에, 메모지에, 말로. 아무도 제대로 못 봐요.' },
];

type Feature = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };
const FEATURES: Feature[] = [
  { icon: 'help-circle', title: '우리 매장 방식 그대로', body: '직원이 물을 때 AI가 우리 방식대로 답해요.' },
  { icon: 'checkmark-done', title: '오늘 할일이 한눈에', body: '누가 끝냈는지 바로 보여요.' },
  { icon: 'chatbubble-ellipses', title: '채팅 하나로', body: '공지도 지시도 질문도 여기 모여요.' },
];

const OFFERS = ['설치 없이 QR로 시작', '사장님 답이 곧 AI가 돼요', '언제든 그만둘 수 있어요'];

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const status = useSessionStore((s) => s.status);
  const phone = useSessionStore((s) => s.phone);
  const unitId = useSessionStore((s) => s.unitId);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const needsDowngradeChoice = useSessionStore((s) => s.needsDowngradeChoice);
  const brandId = useSessionStore((s) => s.brandId);

  // 이미 로그인된 재방문자는 마케팅을 건너뛰고 각자 홈으로. (데모 빌드는 항상 랜딩을 보여준다)
  if (HAS_SUPABASE && status === 'signed_in') {
    // 소셜 로그인으로 들어와 프로필이 결손(phone/생년월일 없음)이면 역할 홈 대신 완성화면으로 — 이 관문이
    // OAuth 복귀(redirectTo=오리진→여기)를 가장 먼저 받는다. 완성 후엔 phone 이 채워져 이 분기를 안 탄다.
    if (needsProfileSetup({ status, phone, unitId, pendingUnitId, brandId })) {
      return <Redirect href="/complete-profile" />;
    }
    // 체험이 끝나 무료 한도를 넘긴 것이 있으면 먼저 무엇을 남길지 고른다(0142).
    // 판정은 서버가 갖고 세션이 실어온다 — 순서는 프로필 완성 **다음**이다.
    if (needsDowngradeChoice) return <Redirect href="/downgrade" />;
    // 본사 담당자는 본사 대시보드가 홈이다(정본 §3-1·§5-1). 매장 사장을 겸하면 본사 셸의
    // '내 매장으로'로 건너간다 — 두 축을 오가는 길은 셸 양쪽에 한 쌍으로 있다.
    // ★프로필 완성·다운그레이드 **다음**이다. 그 둘은 계정 축이라 본사보다 먼저 막아야 한다.
    if (brandId) return <Redirect href="/hq" />;
    return <Redirect href="/hub" />;
  }
  if (HAS_SUPABASE && status === 'loading') return null; // 스플래시가 덮는 구간 — 깜빡임 방지

  // 웹 미로그인 방문자는 정적 마케팅 페이지(/welcome.html)를 앞문으로 — 로그인/가입만 앱(SPA)으로 이어진다.
  // welcome.html은 실제 정적 파일이라 SPA rewrite에 안 걸린다.
  if (HAS_SUPABASE && status === 'signed_out' && Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.replace('/welcome.html');
    return null;
  }
  // 네이티브(스토어 앱)는 마케팅 스크롤(이 화면의 나머지)을 건너뛴다 — 스토어에서 이미 소개를 보고
  // 설치했으므로, 앱을 열면 바로 로그인/가입으로 붙는다(2026-08-24, "앱 = 홈페이지 없이 바로 본문").
  if (HAS_SUPABASE && status === 'signed_out' && Platform.OS !== 'web') {
    return <Redirect href="/login" />;
  }

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
            <Text style={styles.badgeText}>카드 없이 무료로 시작</Text>
          </View>

          <Wordmark size="lg" style={styles.wordmark} />

          <Text style={styles.h1}>
            사장님이 자리를 비워도,{'\n'}
            <Text style={styles.h1Strong}>매장은 사장님처럼</Text> 답해요.
          </Text>
          <Text style={styles.heroSub}>
            한 번 답해두면 끝이에요.{'\n'}
            카톡도 메모지도 이제 채팅 하나로.
          </Text>

          <View style={styles.scrollCue}>
            <Text style={styles.scrollCueText}>내려서 살펴보기</Text>
            <Ionicons name="chevron-down" size={16} color={InkColors.ink3} />
          </View>
        </Appear>

        {/* ── PROBLEM ── */}
        <View style={styles.section}>
          <Appear>
            <Text style={styles.kicker}>이런 하루 아니세요?</Text>
            <Text style={styles.h2}>매일 반복되는 매장 스트레스</Text>
          </Appear>
          <View style={styles.stack}>
            {PAINS.map((p, i) => (
              <Appear key={p.title} delay={LANDING_LEAD + stagger(i)}>
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
            <Text style={[styles.kicker, styles.kickerInk]}>매장의 정석이 대신해요</Text>
            <Text style={styles.h2}>답하고, 챙겨요</Text>
          </Appear>
          <View style={styles.stack}>
            {FEATURES.map((f, i) => (
              <Appear key={f.title} delay={LANDING_LEAD + stagger(i)}>
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
          <Appear delay={LANDING_LEAD}>
            <View style={styles.offerCard}>
              <View style={styles.badge}>
                <View style={styles.badgeDot} />
                <Text style={styles.badgeText}>무료로 시작</Text>
              </View>
              <Text style={styles.offerTitle}>작은 매장은 계속 무료</Text>
              <Text style={styles.offerBody}>
                매장 1곳·직원 3명까지는 무료로 쓸 수 있어요.{'\n'}
                카드 없이 바로 시작해요.
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
                <Text style={styles.offerLoginText}>이미 매장의 정석을 쓰고 계신가요? <Text style={styles.offerLoginStrong}>로그인</Text></Text>
              </Pressable>
            </View>
          </Appear>
        </View>
      </ScrollView>

      {/* ── 우하단 고정 CTA (FAB) — 스크롤 위치와 무관하게 항상 노출 ── */}
      <Appear delay={LANDING_LEAD + stagger(7)} offsetY={16} style={[styles.fabWrap, { bottom: insets.bottom + 24 }]}>
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

  scroll: { paddingHorizontal: SCREEN_GUTTER, gap: Gap.section },

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
  section: { gap: Gap.group },
  kicker: { fontSize: 13, lineHeight: 19, fontWeight: '800', color: InkColors.ink3, letterSpacing: -0.2 },
  kickerInk: { color: BrandColors.yellowDeep },
  h2: { fontSize: 21, lineHeight: 30, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4, marginTop: 2 },
  stack: { gap: Gap.item },

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
  painText: { flex: 1, gap: Gap.inline },
  painTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  painBody: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },

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
  featBody: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },

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
  offerBody: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, fontWeight: '600' },
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
