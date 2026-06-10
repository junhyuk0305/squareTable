/**
 * 디자인 토큰 — "웜 뉴트럴 모노크롬 + 단일 절제 액센트".
 * 원칙: near-black 기본 / 채도 낮춘 톤 패밀리 / 따뜻한 종이질감 배경.
 * UI 어디서든 이 값만 참조하면 앱 전체가 일관되게 정제된다.
 */

// 4 카테고리 — 무지개가 아니라, 명도가 비슷한 '음소거된 한 가족'.
export const CategoryColors = {
  Routine:  '#5C6B7A',   // 슬레이트 — 반복 업무
  Event:    '#A6534A',   // 벽돌     — 돌발 상황
  Context:  '#5E7357',   // 세이지   — 매장 룰·위치
  'Know-how': '#917244', // 브론즈   — 꿀팁·노하우
} as const;

export const CategoryColorsSoft = {
  Routine:  '#EEF0F2',
  Event:    '#F5ECEA',
  Context:  '#EDF1EC',
  'Know-how': '#F3EEE4',
} as const;

export const InkColors = {
  ink:    '#1F1D1A',   // 따뜻한 near-black
  ink2:   '#5A564F',   // 본문 보조
  ink3:   '#9D988D',   // 흐린 메타
  line:   '#E8E6DF',   // 아주 옅은 웜 라인
  bg:     '#FFFFFF',
  bgSoft: '#F4F2EC',
  bubble: '#EEEBE4',   // 사용자 발화 버블 (웜 그레이 — 쿨톤 #F1F5F9 대체)
  cream:  '#F7F5F0',   // 종이 같은 배경
} as const;

export const BrandColors = {
  brand:     '#232020',   // 기본 액션(CTA) = 정제된 잉크 블랙
  brand2:    '#4A453F',
  brandSoft: '#EFEDE7',
  accent:    '#A6534A',   // 단 하나의 액센트(우선·강조)
  accentSoft:'#F5ECEA',
  good:      '#5E7357',
  warn:      '#A6534A',
  gold:      '#917244',
} as const;
