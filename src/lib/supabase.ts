// lib/supabase.ts
// Supabase 클라이언트 단일 진입점. 세션은 로컬 영속(웹=localStorage).
// anon 키는 공개돼도 됨 — 모든 접근은 DB의 RLS(unit_id 멀티테넌시)로 보호된다.

import { createClient } from '@supabase/supabase-js';
import { useSyncStore } from '@/lib/store/useSyncStore';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// URL/키가 없으면 mock 전용 모드(프론트 안 끊김). db.ts가 이 플래그를 보고 로컬 시드로 폴백.
export const HAS_SUPABASE = Boolean(URL && ANON);

// 웹은 localStorage, 그 외(네이티브)는 메모리 폴백. 출시 1차는 Expo Web 기준.
const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

// "서버 왕복이 성공했다"의 유일한 판정 지점. 읽기·쓰기·엣지 함수가 전부 이 fetch 를 지나가므로,
// 연결 실패 배너(useSyncStore readError.kind === 'offline')를 내릴 수 있는 곳도 여기뿐이다.
// ★2xx 일 때만이다. 5xx·4xx 는 "서버까지는 닿았지만 그 요청은 실패"라 연결 복구의 증거가 아니다.
// ★서버 축(kind === 'server')은 건드리지 않는다 — 옆 요청이 성공해도 깨진 쿼리는 여전히 깨져 있다.
// 요청 자체는 그대로 흘려보낸다(헤더·에러 손대지 않음 — x-client-info 사고 재발 금지).
const trackedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok) useSyncStore.getState().clearOffline();
  return res;
};

export const supabase = createClient(URL || 'http://localhost', ANON || 'anon', {
  global: { fetch: trackedFetch },
  auth: {
    storage: storage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // 매직링크 콜백(?code=...) 자동 처리
    flowType: 'pkce',
  },
});
