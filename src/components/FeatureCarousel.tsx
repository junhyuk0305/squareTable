// 핵심 기능 안내 배너 — 홈 상단에 노출하는 가로 스와이프 캐러셀.
// 카드 한 장씩 핵심 기능을 소개하고, 탭하면 실제 그 기능 화면으로 이동한다(안내 = 바로 체험).
// 직원/사장 양쪽 홈에서 쓰며, 카드 내용은 역할별로 주입한다(JUNIOR_FEATURES / OWNER_FEATURES).
import { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export type FeatureCard = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  cta: string;
  route: Href;
};

/** 직원 홈 — 가장 자주 쓰는 핵심 3기능을 한 장씩 안내. */
export const JUNIOR_FEATURES: FeatureCard[] = [
  {
    key: 'ask',
    icon: 'search',
    title: '모르는 건 바로 물어보세요',
    desc: '포스기 에러, 마감 청소 어디까지… 매장 노하우를 AI가 바로 알려줘요. 없으면 사장님께 대신 여쭤봐요.',
    cta: '노하우 검색 해보기',
    route: '/junior/chat',
  },
  {
    key: 'clock',
    icon: 'time',
    title: '출근은 버튼 한 번이면 끝',
    desc: '출근·퇴근을 버튼 하나로 기록해요. 오늘 일한 시간과 번 돈이 실시간으로 쌓이는 게 보여요.',
    cta: '출퇴근 보기',
    route: '/junior/attendance',
  },
  {
    key: 'schedule',
    icon: 'calendar',
    title: '내 근무·대타 한 곳에서',
    desc: '이번 주 내 근무를 한눈에 확인하고, 못 나가는 날은 대타·맞교환을 바로 신청할 수 있어요.',
    cta: '근무표 보기',
    route: '/junior/schedule',
  },
];

/** 사장 홈 — 매장 두뇌를 쌓고 운영을 한 곳에서 보는 핵심 3기능. */
export const OWNER_FEATURES: FeatureCard[] = [
  {
    key: 'knowledge',
    icon: 'bulb',
    title: '한 번 알려주면, AI가 대신 답해요',
    desc: '자주 생기는 일을 한 번만 정리해두면, 직원이 물었을 때 AI가 사장님 대신 24시간 답해줘요.',
    cta: '노하우 알려주기',
    route: '/owner/categories',
  },
  {
    key: 'inbox',
    icon: 'chatbubbles',
    title: '직원 질문이 노하우가 돼요',
    desc: '직원이 AI에게 물었는데 답이 없던 질문이 모여요. 한 번 답해두면 다음부터 AI가 알아서 답해요.',
    cta: '받은 질문 보기',
    route: '/owner/inbox',
  },
  {
    key: 'ops',
    icon: 'clipboard',
    title: '출퇴근·할일·근무표 한 화면에서',
    desc: '직원 출퇴근, 오늘 할일, 근무표와 인건비까지. 매장 운영을 한 곳에서 관리해요.',
    cta: '업무 관리 보기',
    route: '/owner/work',
  },
];

export function FeatureCarousel({ cards }: { cards: FeatureCard[] }) {
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && w !== width) setWidth(w);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            decelerationRate="fast"
          >
            {cards.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => router.push(c.route)}
                style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
                accessibilityLabel={`${c.title}. ${c.cta}`}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={c.icon} size={20} color={InkColors.ink} />
                </View>
                <View style={styles.body}>
                  <Text style={styles.title}>{c.title}</Text>
                  <Text style={styles.desc} numberOfLines={3}>
                    {c.desc}
                  </Text>
                  <View style={styles.ctaRow}>
                    <Text style={styles.ctaText}>{c.cta}</Text>
                    <Ionicons name="arrow-forward" size={13} color={InkColors.ink} />
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>

          {cards.length > 1 && (
            <View style={styles.dots}>
              {cards.map((c, i) => (
                <Pressable
                  key={c.key}
                  onPress={() => {
                    setIndex(i);
                    scrollRef.current?.scrollTo({ x: i * width, animated: true });
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}번째 안내로 이동`}
                >
                  <View style={[styles.dot, i === index && styles.dotActive]} />
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: BrandColors.yellowDeep,
    padding: 18,
    ...Elevation.e1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 15.5, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3 },
  desc: { fontSize: 13, color: InkColors.ink2, lineHeight: 19, fontWeight: '500' },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  ctaText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: InkColors.line },
  dotActive: { width: 18, backgroundColor: BrandColors.yellowDeep },
});
