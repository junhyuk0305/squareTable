// lib/supabase.ts
// Supabase 클라이언트 단일 진입점. 세션은 로컬 영속(웹=localStorage).
// anon 키는 공개돼도 됨 — 모든 접근은 DB의 RLS(unit_id 멀티테넌시)로 보호된다.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// URL/키가 없으면 mock 전용 모드(프론트 안 끊김). db.ts가 이 플래그를 보고 로컬 시드로 폴백.
export const HAS_SUPABASE = Boolean(URL && ANON);

// 웹은 localStorage, 그 외(네이티브)는 메모리 폴백. 출시 1차는 Expo Web 기준.
const storage =
  typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

export const supabase = createClient(URL || 'http://localhost', ANON || 'anon', {
  auth: {
    storage: storage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // 매직링크 콜백(?code=...) 자동 처리
    flowType: 'pkce',
  },
});
