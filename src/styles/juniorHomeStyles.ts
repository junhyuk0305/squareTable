import { StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  // ★위 패딩은 주지 않는다 — 상단바(AppTopBar)가 스크롤 밖에서 자기 아래 여백을 이미 갖는다(사장 홈과 동일).
  scroll: { paddingHorizontal: Space.gutter, paddingBottom: Space.gutter, gap: 18 },
  greet: { fontSize: 16, fontWeight: '700', color: InkColors.ink2 },

  // 섹션: [밖 라벨] + [안 카드] 묶음. scroll의 gap이 섹션 사이를 벌리고, 이 gap이 라벨↔카드를 붙인다.
  section: { gap: 8 },
  // 섹션 라벨은 공용 <SectionLabel>을 쓴다 — 로컬 재구현본 폐기(2026-08-05).

  // 오늘 업무 — 목록 3건을 한 카드에. 남은 개수·출퇴근 상태는 위 히어로(HeroSubNav)가 갖는다.
  todoCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.xs },
  todoRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  todoText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  todoTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  // 빈 상태는 한 줄로만 말한다 — 업무 탭이 하단 탭바에 있으므로 여기에 버튼을 또 두지 않는다.
  todoEmpty: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: InkColors.ink2 },
  moreLink: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
});
