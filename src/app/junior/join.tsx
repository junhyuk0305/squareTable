import { Redirect } from 'expo-router';

// 레거시 경로 — 가게 연결 화면은 개인 허브(junior/hub)로 통합됐다.
// 과거 링크/딥링크 호환을 위해 hub로 리다이렉트만 한다.
export default function JuniorJoinRedirect() {
  return <Redirect href="/junior/hub" />;
}
