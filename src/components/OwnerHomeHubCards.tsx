import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { SectionLabel } from '@/components/SectionLabel';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { frameCapStyle } from '@/lib/theme/layout';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * 홈 '매장 운영' 허브 카드 클러스터.
 * 탭바·대시보드 본문에 가려져 있던 매장 운영 진입점(근무·급여 / 직원 / 급여 설정)을
 * 홈에서 한 번에 노출한다. 계약서 §20 HubCard(variant='shortcut') 패턴의 묶음 구현.
 *
 * 자급자족(self-contained): 대시보드에서 `<OwnerHomeHubCards />`만 드롭하면 된다.
 * 라우팅은 기본 expo-router push, onNavigate 주면 그쪽으로 위임.
 */
export interface OwnerHomeHubCardsProps {
  /** 라우팅 위임 콜백. 미지정 시 내부 router.push 사용. */
  onNavigate?: (path: string) => void;
}

type HubItem = {
  key: string;
  icon: IconName;
  label: string;
  subtitle: string;
  path: string;
};

// 해요체 · 시니어(사장님) 톤. 라벨/서브타이틀은 카피 카탈로그 도메인 톤에 맞춰 정리.
const ITEMS: HubItem[] = [
  {
    key: 'attendance',
    icon: 'time-outline',
    label: '근무·급여',
    subtitle: '출퇴근과 이번 달 인건비를 한눈에 봐요',
    path: '/owner/attendance',
  },
  {
    key: 'staff',
    icon: 'people-outline',
    label: '직원',
    subtitle: '직원을 초대하고 관리해요',
    path: '/owner/staff',
  },
  {
    key: 'schedule',
    icon: 'calendar-outline',
    label: '근무표',
    subtitle: '근무를 짜고 교대 요청을 컨펌해요',
    path: '/owner/schedule',
  },
  {
    key: 'payroll',
    icon: 'card-outline',
    label: '급여 설정',
    subtitle: '시급과 정산 방식을 정해둬요',
    path: '/owner/payroll',
  },
];

export function OwnerHomeHubCards({ onNavigate }: OwnerHomeHubCardsProps) {
  const router = useRouter();
  // 합류 승인 대기 인원 — '직원' 카드에 배지로 노출(사장이 승인을 놓쳐 직원이 갇히는 걸 방지).
  const pendingCount = useStaffStore((s) => s.pending.length);
  const go = (path: string) => {
    if (onNavigate) onNavigate(path);
    else router.push(path as never);
  };

  return (
    <View style={[styles.section, frameCapStyle]}>
      {/* 제목은 카드 밖 · 진입 카드는 2열 그리드(내용 적은 바로가기라 2열이 효율적) */}
      <SectionLabel icon="grid-outline" title="매장 운영" />
      <View style={styles.grid}>
        {ITEMS.map((item) => {
          // '직원' 카드만 승인 대기 배지·안내를 얹는다(다른 카드는 그대로).
          const badge = item.key === 'staff' ? pendingCount : 0;
          const subtitle = badge > 0 ? `합류 승인 대기 ${badge}명 · 확인해요` : item.subtitle;
          return (
          // 셀 래퍼가 2열 폭을 잡는다. (PressableScale은 style을 내부 뷰에 적용해
          //  % 폭이 이중 적용되므로, 폭은 셀에 두고 카드는 셀을 꽉 채운다)
          <View key={item.key} style={styles.cell}>
            <PressableScale
              onPress={() => go(item.path)}
              scaleTo={0.97}
              style={styles.card}
              accessibilityRole="button"
              accessibilityLabel={badge > 0 ? `${item.label}. 합류 승인 대기 ${badge}명` : `${item.label}. ${subtitle}`}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={20} color={InkColors.ink} />
              </View>
              {badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              )}
              <Text style={styles.cardLabel} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={[styles.cardSubtitle, badge > 0 && styles.cardSubtitleAlert]} numberOfLines={2}>
                {subtitle}
              </Text>
            </PressableScale>
          </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  // 2열 그리드 — 바로가기 카드는 정보량이 적어 한 행에 둘씩. 좁은 프레임 안에서 space-between으로 2열 유지.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  cell: { width: '48.5%' },
  card: {
    width: '100%',
    height: 132,
    gap: 7,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: 14,
    paddingHorizontal: 13,
    ...Elevation.e1,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.yellowSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: InkColors.ink,
  },
  cardSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: InkColors.ink3,
    lineHeight: 17,
  },
  // 승인 대기 있을 때 서브타이틀 강조(잉크색·볼드) — 배지와 함께 시선 유도.
  cardSubtitleAlert: {
    color: InkColors.ink,
    fontWeight: '700',
  },
  // 카드 우상단 배지 — 벨 배지와 동일 규격(액센트 원형).
  badge: {
    position: 'absolute',
    top: 10,
    right: 12,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '900', color: '#FFFFFF' },
});
