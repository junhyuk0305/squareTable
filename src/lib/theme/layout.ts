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
