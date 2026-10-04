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
  xxl: 40, // 주제가 바뀌는 자리 — Gap.section 전용
} as const;

/**
 * 여백의 **의미** — `Space` 가 "얼마나 큰가"라면 `Gap` 은 "무엇과 무엇 사이인가"다.
 *
 * ★2026-09-22 신설. `Space` 는 크기만 정하고 **관계를 안 정해서**, 화면마다 개발 시점의
 *   눈대중이 들어갔다("같은 이야기와 다른 이야기의 여백 차이가 어색하다"는 지적).
 *   같은 관계인데 화면마다 간격이 다르면, 사용자는 **뭐가 한 덩어리인지 매번 다시 판단**해야 한다.
 *
 * 근접성 규칙: **바깥 여백 ≥ 안쪽 여백 × 1.5.** 이보다 좁으면 경계가 안 보인다.
 *   (옛 랜딩이 카드끼리 12 · 묶음 사이 16 = 1.33배였다 — 구분이 안 되던 자리다.)
 *
 * 세로 흐름에만 쓴다. 가로 정렬(아이콘·칩 사이)은 `Space` 를 그대로 쓴다.
 */
export const Gap = {
  /** 한 덩어리 안 — 제목과 바로 아래 설명처럼 "떼면 뜻이 깨지는" 사이 */
  inline: Space.xs, // 4
  /** 같은 종류가 이어질 때 — 카드끼리, 목록 행끼리 */
  item: Space.md, // 12
  /** 묶음과 묶음 사이 — 섹션 제목 묶음 ↔ 카드 묶음 */
  group: Space.xl, // 24
  /** 주제가 바뀔 때 — 섹션 ↔ 섹션 */
  section: Space.xxl, // 40
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

/**
 * 넓은 웹 셸(사장)의 본문 컬럼 최대폭.
 *
 * 화면들이 460 전제로 만들어져 있어 사이드바가 생긴 만큼 그대로 늘리면 줄이 늘어져 깨진다.
 * 한 단계만 넓히고(460 → 720) 화면별 두 단 배치는 별도 단계에서 한다(구현계획 P7).
 * 모달·바텀시트는 여기가 아니라 `frameCapStyle`(460) 그대로다 — 넓은 셸에서도 가운데 460 폭으로 뜬다.
 */
export const OWNER_WEB_MAX_WIDTH = 720;

/**
 * 넓은 웹 셸의 왼쪽 사이드바 폭.
 *
 * ★2026-09-23(P7) 224 → 240. 데모 HTML `.side` 는 224 였지만, 실제 항목 중 긴 것("계정 설정"·
 *   "본사 대시보드")이 아이콘+여백과 함께 224 안에서 줄바꿈 직전까지 찬다. 널리 쓰는 하한은
 *   Polaris 240 · Carbon 256 · Material ≤280 이다 — 그중 가장 좁은 240 을 쓴다.
 */
export const SIDE_NAV_WIDTH = 240;

/**
 * 본사 화면 본문의 좌우 거터 — 넓은 레이아웃이라 폰 거터(20)보다 한 단계 크다.
 * 데모 HTML `.page` 의 32px 과 같은 값이다. 본사 화면 밖에서는 쓰지 않는다.
 */
export const HQ_PAGE_GUTTER = 32;

/**
 * 본사 셸 2단 메뉴(2026-10-02) — 아이콘 줄 + 하위 메뉴 칸. 합 304 는 옛 사이드바(240)보다 64 넓지만,
 * 매장 상세가 목록 옆 칸(392)이 아니라 페이지가 되면서 본문은 오히려 넓어졌다.
 * 아이콘 줄 72 = 라벨 '대시보드'(11.5px)가 한 줄로 서는 폭. 하위 메뉴 232 = 매장 이름 12자 안팎이 말줄임 없이 서는 폭.
 */
export const HQ_RAIL_WIDTH = 72;
export const HQ_SUBNAV_WIDTH = 232;
