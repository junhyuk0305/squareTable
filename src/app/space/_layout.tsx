import { useEffect, useState } from 'react';
import { Stack, Redirect, usePathname, useGlobalSearchParams } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { showToast } from '@/lib/store/useToastStore';
import { firstAddressOnce, justLeftSpace, pendingSpaceTarget, rememberSpaceTarget } from '@/lib/place/spaceTarget';

/** 공간이 없어도 열리는 화면 — 공간 만들기(S02 앞 단계). */
const START = '/space/start';
/** 확인 중에 만들기 화면을 열었다(아래 문지기 주석). */
let pendingStart = false;
/** 멤버 화면(S17 · 4번 덩이). 주인이 아니어도 열린다. */
const JOINED = '/space/joined/';

/**
 * 이 경로가 가리키는 공간(4번 덩이). 알림·벨·딥링크로 바로 오면 그 공간에 먼저 들어가야 한다.
 *  · /space/joined/<번호> = 참여 중인 공간(N8 착지)
 *  · ?space=<번호> = 그 공간의 화면(N7 착지 = /space/settings?space=…&member=… · 서버 url 0460)
 */
function spaceTargetOf(pathname: string, spaceParam: unknown): string {
  if (pathname.startsWith(JOINED)) return decodeURIComponent(pathname.slice(JOINED.length).split('/')[0] ?? '');
  return typeof spaceParam === 'string' ? spaceParam : '';
}

/**
 * 공간 층(2번 덩이) — 매장 층(owner·junior)과 나란한 세 번째 층. 하단 탭 = 홈·노하우·교육·설정.
 *
 * 문지기(이 파일 한 곳):
 *  · 로그인 전 → 첫 화면. 로그인 확인 중 → 아무것도 안 그린다.
 *  · 입구(my_kind_features space/enter)가 막힌 계정 → 계정 층 매장 목록(/stores).
 *  · /space/start = 입구만 보면 열린다(두 번째 공간은 서버가 거절한다).
 *  · 그 밖의 공간 화면 = 들어간 공간(spaceId)이 있고 내가 주인일 때만.
 *  · 참여 중인 공간(/space/joined/<번호> · S17) = 그 공간 멤버면 열린다(주인이면 공간 홈으로).
 *  · 경로가 공간을 가리키면(spaceTargetOf) 그 공간에 먼저 들어간다(enter_space). 못 들어가면 문구 + 매장 목록.
 *    알림·벨이 매장 전환을 하지 않고 여기로 보낸다(서버가 공간 전환을 거절한다 · pushTap · useCrossNotifRows).
 * ★들어간 공간은 앱 상태에만 있다. 웹 새로고침·딥링크로 바로 오면 공간이 비어 매장 목록으로 간다(거기서 다시 들어간다).
 * ★매장 데이터 스토어를 여기서 hydrate 하지 않는다. 공간 화면은 공간 번호를 db.ts 에 직접 넘긴다.
 */
export default function SpaceLayout() {
  // ★React Compiler 를 끈다(1112 fix 1 · 원인). 이 문지기는 그릴 때마다 모듈 값(pendingSpaceTarget · rememberSpaceTarget)을 읽고 쓴다.
  //   컴파일러는 인자 없는 pendingSpaceTarget() 을 처음 한 번만 부르고 그 값을 묶어 둔다(번들에서 memo_cache_sentinel 확인).
  //   그러면 아래에서 기억을 지워도(rememberSpaceTarget(null)) 낡은 pending 이 남아 경로가 바뀔 때마다 옛 주소로 <Redirect> 를 되풀이했다
  //   = 웹 "Maximum update depth exceeded"(?space= 로 들어와 다른 화면을 열 때 · 1112 실측). 앱(네이티브)도 같은 번들 규칙이라 같이 걸린다.
  'use no memo';
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.userId);
  const spaceOpen = useSessionStore((s) => s.spaceOpen);
  const spacesLoaded = useSessionStore((s) => s.spacesLoaded);
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceRole = useSessionStore((s) => s.spaceRole);
  const loadSpaces = useSessionStore((s) => s.loadSpaces);
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const enterSpace = useSessionStore((s) => s.enterSpace);
  // 웹 첫 그림에서는 라우터 값이 아직 비어 있을 수 있다(새로고침·주소 직접 입력 · 11-11 실측) → 주소창 값으로 한 번 더 본다.
  // ★주소창은 이 페이지의 첫 그림 한 번만 읽는다. 앱 안에서 화면을 옮기면 라우터 경로는 바뀌었는데 주소창은 한 박자 늦게
  //   옛 주소다(1112 실측: 탭을 누른 뒤 그림에서 pathname=/space/home · 주소창=/space/teach?space=…). 라우터 값이 빈 그림에서
  //   그 값을 다시 기억하면 아래 Redirect 가 옛 주소로 되돌려 보낸다(야간 g4a·g5 의 "Maximum update depth exceeded" 길).
  //   첫 그림에서 기억한 값은 pending 이 들고 있다.
  //   레이아웃이 경로마다 다시 마운트돼 ref 로는 안 된다 → spaceTarget 모듈이 든다(웹 새로고침이면 다시 처음부터).
  const loc = firstAddressOnce(pathname);
  const fromRouter = spaceTargetOf(pathname, params.space);
  const locPath = loc ? decodeURIComponent(loc.pathname) : '';
  const fromLoc = loc && locPath.startsWith('/space/') ? spaceTargetOf(locPath, new URLSearchParams(loc.search).get('space') ?? undefined) : '';
  const here = fromRouter || fromLoc;
  if (fromRouter) {
    const q = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (k === 'id' ? [] : [[k, String(v)]]))).toString();
    rememberSpaceTarget({ space: here, path: pathname, href: q ? `${pathname}?${q}` : pathname });
  } else if (fromLoc && loc) {
    rememberSpaceTarget({ space: here, path: locPath, href: loc.pathname + loc.search });
  }
  // 막 나온 공간(나가기·지우기·매장으로 돌아가기 직후)이면 다시 들어가지 않는다 — 화면은 이미 매장 목록으로 가는 중이다.
  const leaving = !!here && justLeftSpace(here);
  if (status === 'signed_out' || leaving) rememberSpaceTarget(null);
  const pending = pendingSpaceTarget();
  const target = here || pending?.space || '';
  /** 들어가지 못한 공간(같은 경로로 다시 시도하지 않는다). */
  const [failed, setFailed] = useState('');
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

  // 경로가 가리키는 공간에 먼저 들어간다. 이미 그 공간이면 아무것도 안 한다.
  const needEnter = ready && !leaving && !!target && target !== spaceId && target !== failed;
  useEffect(() => {
    if (!needEnter) return;
    let alive = true;
    void enterSpace(target).then(({ error }) => {
      if (!alive || !error) return;
      showToast(error, 'warn');
      setFailed(target);
    });
    return () => {
      alive = false;
    };
  }, [needEnter, target, enterSpace]);

  if (!HAS_SUPABASE) return <Redirect href="/stores" />;
  if (status === 'loading') return null;
  if (status === 'signed_out') return <Redirect href="/" />;
  if (!spacesLoaded) return null;
  if (spaceOpen !== true) return <Redirect href="/stores" />;
  if (pendingStart && pathname !== START) return <Redirect href={START} />;
  if (target && target === failed) {
    rememberSpaceTarget(null);
    return <Redirect href="/stores" />;
  }
  if (needEnter || leaving) return null;
  // 들어간 뒤 원래 주소로 다시 보낸다(경로가 /space 로 바뀌었을 때). 원래 주소에 서면 잊는다.
  if (pending && spaceId === pending.space) {
    if (pathname !== pending.path) return <Redirect href={pending.href as never} />;
    rememberSpaceTarget(null);
  }
  const joined = pathname.startsWith(JOINED);
  if (joined && !spaceId) return <Redirect href="/stores" />;
  if (joined && spaceRole === 'space_owner') return <Redirect href="/space/home" />;
  // 만들기 화면은 공간이 이미 있어도 막지 않는다. 만드는 도중 목록이 먼저 바뀌어 화면이 튕기지 않게.
  //   두 번째 공간은 서버가 space_limit_reached 로 거절하고 화면이 그 문구를 보인다.
  if (!joined && pathname !== START && (!spaceId || spaceRole !== 'space_owner')) return <Redirect href="/stores" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* 탭 루트 넷은 전환 애니메이션 없음(매장 탭과 같은 규칙 · goToTab = replace). */}
      <Stack.Screen name="home" options={{ animation: 'none' }} />
      <Stack.Screen name="knowhow" options={{ animation: 'none' }} />
      <Stack.Screen name="teach" options={{ animation: 'none' }} />
      <Stack.Screen name="settings" options={{ animation: 'none' }} />
      <Stack.Screen name="start" />
      <Stack.Screen name="joined/[id]" />
    </Stack>
  );
}
