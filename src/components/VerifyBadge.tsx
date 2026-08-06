import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { verifyMeta, type VerifyState } from '@/lib/utils/verification';

/** 원 지름 — 목록 19 / 상세 24. 도형 치수라 간격 토큰 대상이 아니다. */
const DISC = { list: 19, detail: 24 } as const;

/**
 * 검증 배지 — 파란 원 + 흰 체크 + 라벨.
 *
 * 2026-08-05: BrowseList·OwnerKnowhowBrowse·SquareCard 세 곳에 같은 칩 마크업이 복붙돼 있던 것을
 * 한 컴포넌트로 합쳤다(verifyMeta가 색 SSOT, 여기가 모양 SSOT).
 * 색은 전부 verifyMeta에서 오고 이 파일은 배치만 한다 — 상태 판정을 여기서 다시 하지 않는다.
 */
export function VerifyBadge({
  state,
  size = 'list',
  showLabel = true,
}: {
  state?: VerifyState;
  size?: keyof typeof DISC;
  showLabel?: boolean;
}) {
  const v = verifyMeta(state);
  const d = DISC[size];

  return (
    <View style={[styles.wrap, { backgroundColor: v.bg }]}>
      <View style={[styles.disc, { width: d, height: d, borderRadius: d / 2, backgroundColor: v.dot }]}>
        <Ionicons
          name={v.verified ? 'checkmark' : 'ellipse'}
          size={v.verified ? d - 7 : 5}
          color={InkColors.bubbleText}
        />
      </View>
      {showLabel ? <Text style={[styles.label, { color: v.fg }]}>{v.label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    alignSelf: 'flex-start',
    paddingLeft: 3,
    paddingRight: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  disc: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '800' },
});
