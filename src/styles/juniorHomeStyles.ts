import { StyleSheet } from 'react-native';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';
import { AppStyles, AppTypography } from '@/lib/theme/appDesign';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bgSoft },

  // 사장 홈과 같이 상단바 다음 첫 콘텐츠는 16px을 띄운다.
  scroll: { paddingHorizontal: Space.gutter, paddingTop: Space.lg, paddingBottom: Space.gutter, ...AppStyles.groupSpacing },
  greet: { color: InkColors.ink2, ...AppTypography.body },

  // 섹션: [밖 라벨] + [안 카드] 묶음. scroll의 gap이 섹션 사이를 벌리고, 이 gap이 라벨↔카드를 붙인다.
  section: { gap: 8 },
  // 섹션 라벨은 공용 <SectionLabel>을 쓴다 — 로컬 재구현본 폐기(2026-08-05).

  // 오늘 업무 — 목록 3건을 한 카드에. 남은 개수·출퇴근 상태는 위 히어로(HeroSubNav)가 갖는다.
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 52, paddingVertical: Space.sm },
  todoRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  todoText: { flex: 1, minWidth: 0, color: InkColors.ink, ...AppTypography.body },
  todoTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  // 빈 상태는 한 줄로만 말한다 — 업무 탭이 하단 탭바에 있으므로 여기에 버튼을 또 두지 않는다.
  todoEmpty: { color: InkColors.ink2, ...AppTypography.body },
  moreLink: { color: InkColors.ink2, ...AppTypography.body },
  quizAction: { minHeight: 48, justifyContent: 'center', marginTop: Space.sm },
});
