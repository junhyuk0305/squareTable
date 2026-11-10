import { useEffect } from 'react';
import { Stack, Redirect, usePathname } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';

/** 공간이 없어도 열리는 화면 — 공간 만들기(S02 앞 단계). */
const START = '/space/start';
/** 확인 중에 만들기 화면을 열었다(아래 문지기 주석). */
let pendingStart = false;

/**
 * 공간 층(2번 덩이) — 매장 층(owner·junior)과 나란한 세 번째 층. 하단 탭 = 홈·노하우·교육·설정.
 *
 * 문지기(이 파일 한 곳):
 *  · 로그인 전 → 첫 화면. 로그인 확인 중 → 아무것도 안 그린다.
 *  · 입구(my_kind_features space/enter)가 막힌 계정 → 계정 층 매장 목록(/stores).
 *  · /space/start = 입구만 보면 열린다(두 번째 공간은 서버가 거절한다).
 *  · 그 밖의 공간 화면 = 들어간 공간(spaceId)이 있고 내가 주인일 때만. 멤버 화면(S17)은 4번 덩이다.
 * ★들어간 공간은 앱 상태에만 있다. 웹 새로고침·딥링크로 바로 오면 공간이 비어 매장 목록으로 간다(거기서 다시 들어간다).
 * ★매장 데이터 스토어를 여기서 hydrate 하지 않는다. 공간 화면은 공간 번호를 db.ts 에 직접 넘긴다.
 */
export default function SpaceLayout() {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.userId);
  const spaceOpen = useSessionStore((s) => s.spaceOpen);
  const spacesLoaded = useSessionStore((s) => s.spacesLoaded);
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceRole = useSessionStore((s) => s.spaceRole);
  const loadSpaces = useSessionStore((s) => s.loadSpaces);
  const pathname = usePathname();
  // ★주소창·새로고침으로 /space/start 를 열면, 아래에서 null 을 그리는 동안 안쪽 Stack 이 없어 경로가 /space 로 바뀌고
  //   확인이 끝나 Stack 이 서면 첫 화면(/space/first)이 열린다. 그러면 문지기가 /stores 로 보냈다(2026-11-11 실측).
  //   확인 중에 만들기 화면을 열었으면 확인이 끝난 뒤 그 화면으로 다시 보낸다. 만들기 화면에 서거나 공간을 못 쓰면 잊는다.
  //   레이아웃이 경로가 바뀔 때 다시 마운트돼 ref 로는 값이 사라진다 → 모듈 변수에 둔다.
  const ready = status === 'signed_in' && spacesLoaded && spaceOpen === true;
  useEffect(() => {
    if (!ready && pathname === START) pendingStart = true;
    else if ((ready && pathname === START) || status === 'signed_out' || (spacesLoaded && spaceOpen !== true)) pendingStart = false;
  }, [ready, pathname, status, spacesLoaded, spaceOpen]);

  useEffect(() => {
    if (status === 'signed_in' && userId && !spacesLoaded) void loadSpaces();
  }, [status, userId, spacesLoaded, loadSpaces]);

  if (!HAS_SUPABASE) return <Redirect href="/stores" />;
  if (status === 'loading') return null;
  if (status === 'signed_out') return <Redirect href="/" />;
  if (!spacesLoaded) return null;
  if (spaceOpen !== true) return <Redirect href="/stores" />;
  if (pendingStart && pathname !== START) return <Redirect href={START} />;
  // 만들기 화면은 공간이 이미 있어도 막지 않는다. 만드는 도중 목록이 먼저 바뀌어 화면이 튕기지 않게.
  //   두 번째 공간은 서버가 space_limit_reached 로 거절하고 화면이 그 문구를 보인다.
  if (pathname !== START && (!spaceId || spaceRole !== 'space_owner')) return <Redirect href="/stores" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* 탭 루트 넷은 전환 애니메이션 없음(매장 탭과 같은 규칙 · goToTab = replace). */}
      <Stack.Screen name="home" options={{ animation: 'none' }} />
      <Stack.Screen name="knowhow" options={{ animation: 'none' }} />
      <Stack.Screen name="teach" options={{ animation: 'none' }} />
      <Stack.Screen name="settings" options={{ animation: 'none' }} />
      <Stack.Screen name="start" />
    </Stack>
  );
}
