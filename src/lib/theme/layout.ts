import { type ViewStyle } from 'react-native';

/**
 * 앱은 '모바일 화면'을 절대 벗어나지 않는다 — 웹에서도 이 폭 안에서만 그린다.
 *
 * ⚠️ 레이아웃 불변식(반드시 지킬 것):
 *  1) 모든 콘텐츠는 ResponsiveShell(폭 FRAME_MAX_WIDTH, 중앙 정렬) 안에 머문다.
 *  2) RN <Modal>·portal 류는 ResponsiveShell '바깥'(document body)으로 렌더되므로
 *     스스로 폭을 제한하지 않으면 웹에서 좌우로 꽉 펴진다.
 *     → 모달/바텀시트 콘텐츠는 항상 `frameCapStyle`(또는 maxWidth: FRAME_MAX_WIDTH)로 감싼다.
 *  3) 가로폭에 100%/flex로 늘어나는 배너·시트·토스트는 maxWidth 캡을 반드시 둔다.
 */
export const FRAME_MAX_WIDTH = 460;

/**
 * 화면 콘텐츠 좌우 거터(= 본문 padding). 헤더 액션도 이 값에 맞춘다.
 * 헤더 좌/우 끝 액션(뒤로가기·우측 아이콘)의 가장자리 패딩 기준값 — 좌우가 **반드시 동일**해야 한다.
 * native-stack(expo-router)은 헤더 컨테이너 패딩을 못 주고, 기본 좌(title)≈16·우≈0 으로 **비대칭**이라
 * 좌/우 액션 컴포넌트가 각자 이 값을 가장자리 패딩으로 들고 가서 20px로 대칭을 맞춘다.
 * (단일 진실원천 — 이 값만 바꾸면 전 화면 헤더 여백이 함께 움직인다.)
 */
export const SCREEN_GUTTER = 20;
export const HEADER_EDGE_GUTTER = SCREEN_GUTTER;

/**
 * 간격(gap·padding·margin) 스케일 — 단일 진실원천.
 * Radius·Elevation 처럼 간격도 토큰으로만 쓴다. 9·11·13·22 같은 임의값 금지.
 * (사이값이 정말 필요하면 토큰을 늘리고 여기서 정의한다 — 화면 로컬 매직넘버 금지.)
 *  xs=촘촘한 인라인 갭 / sm=리스트 행 갭 / md=카드 내부 패딩 기본 / lg=섹션 간격
 *  gutter=화면 좌우 거터(=SCREEN_GUTTER) / xl=히어로·여백 큰 블록
 */
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  gutter: SCREEN_GUTTER, // 20
  xl: 24,
} as const;

/**
 * 프레임 안에서 좌우 거터를 뺀 콘텐츠 최대폭 (= 460 - 20*2 = 420).
 * 풀폭 배너·토스트가 좌우 거터를 가진 wrap 안에서 추가로 거는 안전 캡.
 * 매직넘버(440 등) 대신 이 파생 상수를 쓴다 — FRAME_MAX_WIDTH/거터가 바뀌면 함께 움직인다.
 */
export const CONTENT_MAX_WIDTH = FRAME_MAX_WIDTH - SCREEN_GUTTER * 2;

/** 모달/시트 콘텐츠를 모바일 프레임 폭으로 가두는 캡. 좁은 화면에선 100%로 자연히 풀린다. */
export const frameCapStyle: ViewStyle = {
  width: '100%',
  maxWidth: FRAME_MAX_WIDTH,
  alignSelf: 'center',
};

/**
 * 모달 전체(딤 배경 + 시트)를 모바일 프레임 폭으로 가두는 풀하이트 중앙 컬럼.
 * 딤(backdrop)이 뷰포트 좌우로 새지 않도록, backdrop·시트를 모두 이 안에 넣는다.
 * 컬럼 안에서 [backdrop flex:1][시트] 순으로 두면 시트가 하단에 붙는다.
 */
export const modalFrameStyle: ViewStyle = {
  flex: 1,
  width: '100%',
  maxWidth: FRAME_MAX_WIDTH,
  alignSelf: 'center',
  justifyContent: 'flex-end',
};
