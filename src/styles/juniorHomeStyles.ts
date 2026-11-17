import { StyleSheet } from 'react-native';
import { CardStyles } from '@/lib/theme/card';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

// 바탕·첫 여백·섹션 간격·인사 문구·섹션(제목 ↔ 카드)은 <Screen>·<Greeting>·<Section> 이 든다(2026-11-02).
export const styles = StyleSheet.create({
  // 오늘 업무 — 목록 3건을 한 카드에. 남은 개수·출퇴근 상태는 위 히어로(HeroSubNav)가 갖는다.
  // 카드 = CardStyles(흰 면·선 1px·모서리 16·그림자 e1·안쪽 16).
  todoCard: { ...CardStyles.list, gap: Space.md },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.xs },
  todoRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  todoText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  todoTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  // 할일 0건이면 "오늘 업무" 묶음 자체를 그리지 않는다(2026-11-17) — 빈 줄 스타일은 뺐다.
});
