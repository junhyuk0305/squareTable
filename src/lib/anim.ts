import { Platform } from 'react-native';

/**
 * 웹에는 네이티브 애니메이션 드라이버가 없어 `useNativeDriver: true`를 주면
 * "useNativeDriver is not supported..." 경고 후 JS 애니메이션으로 폴백한다.
 * 플랫폼별로 분기해 웹에선 처음부터 JS 드라이버를 쓰게 해 경고를 없앤다.
 * (네이티브에선 그대로 네이티브 드라이버 사용 — 성능 동일)
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';
