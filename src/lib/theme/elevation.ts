/**
 * 엘리베이션(그림자) · 라운드 토큰 — 착착 디자인 시스템.
 * 평면 금지 → 레이어드 소프트 드롭섀도로 '떠 있는' 느낌.
 * 웹은 boxShadow, 네이티브는 shadow 계열·elevation 으로 크로스플랫폼 변환.
 */
import { Platform, type ViewStyle } from 'react-native';

// 웹/네이티브 그림자를 한 토큰으로. boxShadow 는 RN 타입에 없을 수 있어 any 캐스팅.
const shadow = (web: string, native: ViewStyle): ViewStyle =>
  (Platform.OS === 'web' ? ({ boxShadow: web } as ViewStyle) : native);

// ▸ 2026-07-06 토스식 개정: 배경이 완전 흰색이 되면서 카드가 '보더'가 아니라 '그림자'로 떠 보여야 한다.
//   → 좁고 진한 그림자 → **넓게 번지고 옅은** 소프트 섀도로 교체(흰 위에서 리프트 확보). 층 위계(e1<e2<e3)는 유지.
export const Elevation = {
  /** 칩·리스트·작은 요소 — 살짝 떠 있는 정도 */
  e1: shadow('0 1px 2px rgba(17,17,17,.04), 0 5px 14px rgba(17,17,17,.06)', {
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  }),
  /** 카드·말풍선 — 흰 배경에서 확실히 뜨는 소프트 플로팅 */
  e2: shadow('0 1px 3px rgba(17,17,17,.04), 0 10px 28px rgba(17,17,17,.08)', {
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 5,
  }),
  /** 모달·다이얼로그·폰 프레임 — 페이지 위에 크게 뜨는 오버레이 */
  e3: shadow('0 8px 22px rgba(17,17,17,.10), 0 24px 56px rgba(17,17,17,.13)', {
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 30,
    elevation: 12,
  }),
  /** 노랑 요소 전용 글로우 — 히어로 CTA·FAB 전용(리스트 행 버튼엔 쓰지 말 것: overflow:hidden 카드에서 잘림) */
  ey: shadow('0 8px 20px rgba(245,197,24,.32)', {
    shadowColor: '#F5C518',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 6,
  }),
} as const;

/** 라운드 스케일: 말풍선 꼬리 tail · 칩/태그 pill · 작은 요소 sm · 카드 md/lg · 시트/모달 sheet.
 *  2026-07-06 토스식: 카드 라운드 상향(md 14→16 · lg 18→20 · sheet 20→22)으로 더 둥글고 부드럽게. */
export const Radius = {
  tail: 5,   // 말풍선 꼬리 쪽(보낸이 우하단·받은이 좌상단) 좁은 라운드. 본체는 md.
  pill: 100,
  sm: 10,
  md: 16,
  lg: 20,
  sheet: 22,
} as const;
