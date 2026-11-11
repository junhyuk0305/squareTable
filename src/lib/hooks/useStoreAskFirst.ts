import { useEffect, useState } from 'react';

import { myKindFeatures, storeAskFirstOf } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';

/**
 * 매장 배치 스위치('store','ask_first' · 0520) — 켜지면 사장 현황 첫 줄이 숫자 줄, 직원 물어보기 첫 화면이 묻는 칸 위다.
 * 꺼지면(기본) 옛 배치 그대로. 무중단 점진 출시: 허용 목록 계정 → 전체 켜기 · 끄기 = 되돌리기.
 * 문구만 바뀌는 곳(없을 때 문구 · "내 활동")은 이 스위치를 안 본다.
 *
 * 계정마다 한 번 읽고 기억한다(같은 계정이면 화면을 옮겨도 다시 안 읽는다). 못 읽으면 꺼짐(옛 배치)으로 둔다.
 * 읽기 전에는 null — 화면은 null 을 꺼짐처럼 그린다(옛 배치가 먼저 보였다가 바뀌는 것보다 낫다 · 스위치는 드물게 켜진다).
 */
let cache: { uid: string; on: boolean } | null = null;
let inflight: { uid: string; p: Promise<boolean> } | null = null;

function load(uid: string): Promise<boolean> {
  if (inflight?.uid === uid) return inflight.p;
  const p = myKindFeatures().then(({ data }) => {
    const on = data ? storeAskFirstOf(data) : false;
    cache = { uid, on };
    return on;
  });
  inflight = { uid, p };
  void p.finally(() => { if (inflight?.p === p) inflight = null; });
  return p;
}

export function useStoreAskFirst(): boolean | null {
  const uid = useSessionStore((s) => s.userId);
  const [got, setGot] = useState<{ uid: string; on: boolean } | null>(cache);
  useEffect(() => {
    if (!uid || cache?.uid === uid) return;
    let alive = true;
    void load(uid).then((on) => { if (alive) setGot({ uid, on }); });
    return () => { alive = false; };
  }, [uid]);
  if (!uid) return null;
  if (cache?.uid === uid) return cache.on;
  return got?.uid === uid ? got.on : null;
}
