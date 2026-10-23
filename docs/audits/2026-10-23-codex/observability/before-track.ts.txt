// lib/analytics/track.ts
// 경량 원격 관측/계측 — 프론트 실패(client_errors)와 핵심 퍼널·품질 이벤트(app_events)를
// Supabase 에 fire-and-forget 로 남긴다. 과거 "가입이 조용히 죽어도 팀이 몰랐던" 무음 장애를
// 자동 감지하기 위한 토대(리포트 P0-2 / §② 계측 청사진).
//
// 3원칙(반드시 지킨다):
//   ① 절대 throw 하지 않는다 — 계측이 앱 흐름을 깨거나 지연시키면 안 된다.
//   ② 실패는 조용히 삼킨다 — 계측 insert 실패가 다시 reportError 를 부르는 재귀·콘솔 스팸 금지.
//   ③ 테이블(0041_observability.sql)이 아직 없어도 무해하게 no-op 된다 — 코드는 미리 배선하고
//      마이그레이션 적용 시점부터 자동으로 데이터가 쌓인다.

import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import { initPostHog, phSetContext, phCapture } from '@/lib/analytics/posthog';

type AuthCtx = { userId: string | null; unitId: string | null; role: string | null };
let _ctx: AuthCtx = { userId: null, unitId: null, role: null };

// 앱 부팅 1회(RootLayout) — PostHog 등 외부 분석 SDK 초기화. 키 없으면 no-op.
export function initAnalytics(): void {
  initPostHog();
}

// 세션 로드 시(useSessionStore.loadProfile) 호출 — 이벤트에 매장/유저/역할을 태깅해
// "어느 매장에서 무엇이 실패하는지"를 서버에서 매장 단위로 집계할 수 있게 한다.
export function setAnalyticsContext(ctx: Partial<AuthCtx>) {
  const prevUserId = _ctx.userId;
  _ctx = { ..._ctx, ...ctx };
  phSetContext(_ctx, prevUserId); // PostHog 신원/매장 태깅 동기화(로그아웃 전이 시 reset)
}

// 폭주 방지 — 동일 (context+code+message) 를 짧은 창 안에서 반복 전송하지 않는다.
const _recent = new Map<string, number>();
const DEDUP_MS = 30_000;
function throttled(key: string): boolean {
  const now = Date.now();
  if (_recent.size > 200) _recent.clear(); // 메모리 상한(가벼운 청소)
  const last = _recent.get(key);
  if (last && now - last < DEDUP_MS) return true;
  _recent.set(key, now);
  return false;
}

// 전역 폭주 상한 — 런어웨이 에러 루프/버그로 텔레메트리가 무한 발사되는 비용 사고를 막는다.
// (세션당 롤링 60초 내 최대 RATE_MAX 건. anon 키 직접 우회 남용은 서버측 태깅 RPC 로 별도 방어.)
const _sent: number[] = [];
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;
function overRateCap(): boolean {
  const now = Date.now();
  while (_sent.length && now - _sent[0] > RATE_WINDOW_MS) _sent.shift();
  if (_sent.length >= RATE_MAX) return true;
  _sent.push(now);
  return false;
}

function codeOf(raw: unknown): string | null {
  if (raw && typeof raw === 'object') {
    const c = (raw as any).code;
    if (typeof c === 'string' && c) return c;
  }
  return null;
}
function messageOf(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const m = (raw as any).message;
    if (typeof m === 'string') return m;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}
function routeOf(): string | null {
  if (typeof window !== 'undefined' && window.location) return window.location.pathname || null;
  return null;
}

/**
 * 프론트 실패를 원격에 기록한다(fire-and-forget). 화면 흐름과 무관하게 절대 throw/지연시키지 않는다.
 * @param context 실패 지점 식별자(예: 'db.write:insertEntry', 'friendlyError', 'react.render')
 * @param raw     원문 에러(Error/PostgrestError/string 무엇이든)
 * @param meta    부가 태그(선택)
 */
export function reportError(context: string, raw: unknown, meta?: Record<string, unknown>): void {
  try {
    if (!HAS_SUPABASE) return;
    const message = messageOf(raw).slice(0, 800);
    const code = codeOf(raw);
    if (throttled(`${context}|${code ?? ''}|${message}`)) return;
    if (overRateCap()) return;
    void (supabase
      .from('client_errors')
      .insert({
        unit_id: _ctx.unitId,
        user_id: _ctx.userId,
        role: _ctx.role,
        context,
        code,
        message,
        route: routeOf(),
        meta: meta ?? null,
      }) as unknown as PromiseLike<unknown>).then(
      () => {},
      () => {}, // 실패는 무해하게 삼킨다(재귀·콘솔 스팸 방지)
    );
  } catch {
    // 계측은 절대 앱을 깨지 않는다.
  }
}

// 전역 안전망 — 어디서도 안 잡힌 Promise reject / 런타임 에러를 원격에 남긴다(웹 전용).
// RootLayout 부팅 시 1회 설치. 네이티브(window 없음)에선 no-op.
let _globalsInstalled = false;
export function installGlobalErrorHandlers(): void {
  if (_globalsInstalled) return;
  _globalsInstalled = true;
  try {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('unhandledrejection', (e: any) => {
      reportError('unhandledrejection', e?.reason ?? e);
    });
    window.addEventListener('error', (e: any) => {
      reportError('window.error', e?.error ?? e?.message ?? e);
    });
  } catch {
    // no-op
  }
}

/**
 * 제품 퍼널/품질/리텐션 이벤트를 원격에 기록한다(fire-and-forget).
 * @param event 이벤트명(예: 'store_created', 'store_created_failed', 'join_requested', 'ai_fallback')
 * @param props 이벤트 속성(선택)
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    if (!HAS_SUPABASE) return;
    if (overRateCap()) return;
    // PostHog 병행 전송 — unit_id/role 은 register(super property)로 이미 붙는다.
    phCapture(event, props);
    void (supabase
      .from('app_events')
      .insert({
        unit_id: _ctx.unitId,
        user_id: _ctx.userId,
        role: _ctx.role,
        event,
        props: props ?? null,
        route: routeOf(),
      }) as unknown as PromiseLike<unknown>).then(
      () => {},
      () => {},
    );
  } catch {
    // no-op
  }
}
