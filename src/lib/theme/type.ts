import { type TextStyle } from 'react-native';

import { InkColors, TextColor } from '@/lib/theme/colors';

/**
 * 글자 단계 — **정한 역할만** 둔다(2026-11-02 사용자 결정. 큰 숫자·강조 제목·꼬리표는 같은 날 캡처 비교 뒤 추가).
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
  /** 허브 맨 위 화면 제목("현황"·"노하우"·"매장"). 매장 안 탭 헤더는 16 이다. */
  pageTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 } as TextStyle,
  /** 화면의 대표 숫자(홈 검정 상자 · 출근 시간 · 허브 노하우 큰 숫자). 색은 자리마다 정한다. */
  numHero: { fontSize: 32, lineHeight: 40, fontWeight: '900', letterSpacing: -1 } as TextStyle,
  /** 칸 안 숫자(숫자 칸 · 이번 달 근무). */
  numCell: { fontSize: 22, lineHeight: 27, fontWeight: '900' } as TextStyle,
  /** 꼬리표(배지 · 분류 칩 · 목록 줄 아래 작은 글자). 굵기는 자리마다 정한다. */
  tag: { fontSize: 12 } as TextStyle,
  /** 가장 작은 글자(알림 숫자 배지 · 요일 · 메시지 시간). 9·10 을 쓰지 않는다(2026-11-02 2차 결정). */
  micro: { fontSize: 11 } as TextStyle,
  /** 시트·모달·빈 화면 제목. 18·19·20·21 로 갈라졌던 것을 하나로(2026-11-02 2차 결정). */
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink } as TextStyle,
};
