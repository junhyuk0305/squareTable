import { type TextStyle } from 'react-native';

import { InkColors, TextColor } from '@/lib/theme/colors';

/**
 * 글자 단계 — **정한 역할만** 둔다(2026-11-02 사용자 결정). 큰 숫자·강조 제목·꼬리표는 아직 미정이라 없다.
 * 같은 인사 문구가 화면마다 16/700·15/600 으로 갈라졌던 것을 끊는다. 화면 StyleSheet 에서 펼쳐 쓴다.
 * 본문 15 를 두 줄 연속으로 쓰지 않는다 — 문장이 둘이면 body 한 줄 + desc 한 줄.
 */
export const Type = {
  /** "○○님, 오늘도 화이팅이에요" */
  greet: { fontSize: 17, fontWeight: '700', color: InkColors.ink } as TextStyle,
  /** 섹션 제목(카드 밖) */
  section: { fontSize: 16, fontWeight: '800', color: InkColors.ink } as TextStyle,
  body: { fontSize: 15, color: InkColors.ink } as TextStyle,
  /** 설명·부제 */
  desc: { fontSize: 13, lineHeight: 19, color: TextColor.secondary } as TextStyle,
  /** 하단 탭바 라벨 */
  tab: { fontSize: 11 } as TextStyle,
};
