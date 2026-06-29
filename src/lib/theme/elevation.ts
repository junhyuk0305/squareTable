/**
 * 엘리베이션(그림자) · 라운드 토큰 — 착착 디자인 시스템.
 * 평면 금지 → 레이어드 소프트 드롭섀도로 '떠 있는' 느낌.
 * 웹은 boxShadow, 네이티브는 shadow 계열·elevation 으로 크로스플랫폼 변환.
 */
import { Platform, type ViewStyle } from 'react-native';

// 웹/네이티브 그림자를 한 토큰으로. boxShadow 는 RN 타입에 없을 수 있어 any 캐스팅.
const shadow = (web: string, native: ViewStyle): ViewStyle =>
  (Platform.OS === 'web' ? ({ boxShadow: web } as ViewStyle) : native);

export const Elevation = {
  /** 칩·리스트·작은 요소 */
  e1: shadow('0 1px 2px rgba(17,17,17,.06), 0 2px 6px rgba(17,17,17,.05)', {
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    elevation: 2,
  }),
  /** 카드·말풍선 */
  e2: shadow('0 2px 4px rgba(17,17,17,.06), 0 8px 20px rgba(17,17,17,.08)', {
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
  }),
  /** 모달·다이얼로그·폰 프레임 */
  e3: shadow('0 6px 12px rgba(17,17,17,.08), 0 18px 40px rgba(17,17,17,.12)', {
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 12,
  }),
  /** 노랑 요소 전용 글로우 */
  ey: shadow('0 6px 16px rgba(245,197,24,.38)', {
    shadowColor: '#F5C518',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 6,
  }),
} as const;

/** 라운드 스케일: 말풍선 꼬리 tail · 칩/태그 pill · 작은 요소 sm · 카드 md/lg · 시트/모달 sheet. */
export const Radius = {
  tail: 5,   // 말풍선 꼬리 쪽(보낸이 우하단·받은이 좌상단) 좁은 라운드. 본체는 md.
  pill: 100,
  sm: 10,
  md: 14,
  lg: 18,
  sheet: 20,
} as const;
