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

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import { initPostHog, phSetContext, phCapture } from '@/lib/analytics/posthog';

type AuthCtx = { userId: string | null; unitId: string | null; role: string | null };
let _ctx: AuthCtx = { userId: null, unitId: null, role: null };

// 앱 부팅 1회(RootLayout) — PostHog 등 외부 분석 SDK 초기화. 키 없으면 no-op.
export function initAnalytics(): void {
  initPostHog();
  // 탭 닫힘 keepalive 전송(flushAnalyticsOnExit)에 실을 로그인 토큰을 따라간다.
  try {
    if (!HAS_SUPABASE) return;
    void supabase.auth.getSession().then(
      ({ data }) => {
        _token = data.session?.access_token ?? null;
      },
      () => {},
    );
    supabase.auth.onAuthStateChange((_event, session) => {
      _token = session?.access_token ?? null;
    });
  } catch {
    // 계측은 절대 앱을 깨지 않는다.
  }
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
// 오류 기록과 행동 기록은 상한을 따로 센다 — 화면 이동이 많아도 오류 기록이 밀리지 않게.
const _errorsSent: number[] = [];
const _eventsSent: number[] = [];
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;
function overRateCap(sent: number[]): boolean {
  const now = Date.now();
  while (sent.length && now - sent[0] > RATE_WINDOW_MS) sent.shift();
  if (sent.length >= RATE_MAX) return true;
  sent.push(now);
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
// 현재 화면의 경로 템플릿(예: /owner/knowhow/[id]). useScreenTracking 이 expo-router 세그먼트로 채운다.
// 실제 주소(id·공유 퀴즈 토큰·전화번호)는 남기지 않는다. 네이티브·웹이 같은 값을 남긴다.
let _route: string | null = null;
export function setAnalyticsRoute(route: string | null): void {
  _route = route;
}
function routeOf(): string | null {
  return _route;
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
    if (overRateCap(_errorsSent)) return;
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

// ── app_events 묶어 보내기(0340 log_app_events) ─────────────────────────────
// 신원(user_id·unit_id·role)은 서버가 정한다. 클라는 쌓을 때의 uid 와 고른 매장 id 를 확인용 후보로 보낸다.
// 대기열에 쌓고 10초마다 또는 20건마다 보낸다. 앱이 뒤로 가면 useScreenTracking 이 바로 보낸다.
// 보내기 실패(네트워크·5xx)는 대기열로 되돌린다. 상한 200건을 넘으면 오래된 것부터 버리고 센다.
// 서버가 invalid_argument 로 거부한 묶음은 다시 보내도 영영 실패하므로 버리고 센다.
// 버린 수는 다음 성공 묶음에 telemetry_dropped 로 실어 보낸다.
type QueuedEvent = {
  id: string;
  event: string;
  /** 쌓을 때의 로그인 사용자. 서버는 보낼 때의 토큰과 같을 때만 user_id 로 남긴다(로그아웃·계정 전환 사이에 섞이지 않게). */
  uid: string | null;
  props: Record<string, unknown> | null;
  route: string | null;
  at: string;
  unit_id: string | null;
  platform: string;
  app_version: string | null;
  session_id: string;
};
const FLUSH_MS = 10_000;
const FLUSH_AT = 20;
const BATCH_MAX = 50; // 서버 상한(0340)
const QUEUE_MAX = 200;
const PROPS_MAX_BYTES = 1800; // 서버 2KB 는 jsonb 텍스트(공백 포함) 기준이라 여유를 둔다
const EVENT_RE = /^[a-z][a-z0-9_]{1,47}$/;
const APP_VERSION = Constants.expoConfig?.version ?? null;
const SESSION_IDLE_MS = 30 * 60_000;
const SCREEN_EVENTS = new Set(['screen_view', 'app_background', 'app_foreground']);

let _queue: QueuedEvent[] = [];
let _dropped = 0;
let _inflight = false;
let _timer: ReturnType<typeof setTimeout> | null = null;

function newSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
let _sessionId = newSessionId();
let _awaySince: number | null = null;

// 앱이 뒤로 갈 때 — 시각을 적고 바로 보낸다.
export function markAnalyticsBackground(): void {
  _awaySince = Date.now();
  flushAnalytics();
}
// 앞으로 올 때 — 30분 넘게 뒤에 있었으면 새 세션으로 본다.
export function markAnalyticsForeground(): void {
  if (_awaySince !== null && Date.now() - _awaySince > SESSION_IDLE_MS) _sessionId = newSessionId();
  _awaySince = null;
}

function byteLength(s: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3;
}

function dropOldest(n: number): void {
  if (n <= 0) return;
  _queue.splice(0, n);
  _dropped += n;
}

// 연속 실패 수. 실패하면 10초 → 20초 → … 최대 5분으로 늘려 다시 보낸다(오프라인·서버 장애 때 요청 폭주 방지).
let _failures = 0;
const RETRY_MAX_MS = 5 * 60_000;

function schedule(): void {
  if (_timer || !_queue.length) return;
  const delay = Math.min(FLUSH_MS * 2 ** _failures, RETRY_MAX_MS);
  _timer = setTimeout(() => {
    _timer = null;
    flushAnalytics();
  }, delay);
}

// 보내는 중인 묶음. 응답이 30초 넘게 안 오면 실패로 보고 대기열로 되돌린다(요청이 영영 안 끝나 전송이 멈추는 것 방지).
// 늦게 온 응답은 버린다. 같은 묶음이 두 번 가도 이벤트 id 가 같아 서버가 한 번만 저장한다(0340).
let _inflightBatch: QueuedEvent[] | null = null;
let _flushSeq = 0;
const INFLIGHT_TIMEOUT_MS = 30_000;

export function flushAnalytics(): void {
  try {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    if (_inflight || (!_queue.length && !_dropped) || !HAS_SUPABASE) return;
    const droppedNow = _dropped;
    const batch = _queue.splice(0, droppedNow ? BATCH_MAX - 1 : BATCH_MAX);
    const payload = droppedNow
      ? [...batch, { ...stamp(), event: 'telemetry_dropped', props: { count: droppedNow } }]
      : batch;
    const seq = ++_flushSeq;
    const settle = () => {
      if (seq !== _flushSeq || !_inflight) return false; // 이미 시간 초과로 정리됐다
      clearTimeout(guard);
      _inflight = false;
      _inflightBatch = null;
      return true;
    };
    const fail = () => {
      _failures++;
      requeue(batch);
      schedule();
    };
    _inflight = true;
    _inflightBatch = batch;
    const guard = setTimeout(() => {
      if (settle()) fail();
    }, INFLIGHT_TIMEOUT_MS);
    void (supabase.rpc('log_app_events', { p_events: payload }) as unknown as PromiseLike<{
      error: { message?: string } | null;
    }>).then(
      ({ error }) => {
        if (!settle()) return;
        if (!error) {
          _failures = 0;
          _dropped -= droppedNow;
        } else if (/invalid_argument/.test(error.message ?? '')) {
          _dropped += batch.length; // 거부된 묶음은 되살릴 수 없다
        } else {
          fail();
          return;
        }
        // 바로 다음 묶음은 성공 뒤에만 보낸다. 실패 중이면 늘어난 간격을 기다린다.
        if (!_failures && _queue.length >= FLUSH_AT) flushAnalytics();
        else schedule();
      },
      () => {
        if (settle()) fail();
      },
    );
  } catch {
    _inflight = false;
    _inflightBatch = null;
  }
}

// ── 웹: 탭을 닫거나 다른 주소로 떠날 때 ──
// 보통 요청은 페이지와 함께 취소된다. keepalive 요청은 페이지가 닫혀도 끝까지 간다(본문 64KB 상한).
// 보내는 중이던 묶음도 같이 싣는다. 이미 저장됐어도 id 가 같아 두 번 들어가지 않는다.
const SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SB_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const KEEPALIVE_MAX_BYTES = 60_000;
let _token: string | null = null; // 로그인 토큰(keepalive 요청은 supabase-js 를 거치지 않아 직접 싣는다)

export function flushAnalyticsOnExit(): void {
  try {
    if (!HAS_SUPABASE || !SB_URL || typeof fetch === 'undefined') return;
    const pending = [...(_inflightBatch ?? []), ..._queue];
    if (!pending.length) return;
    const out: QueuedEvent[] = [];
    let bytes = 20;
    for (const e of pending) {
      const n = byteLength(JSON.stringify(e)) + 1;
      if (out.length >= BATCH_MAX || bytes + n > KEEPALIVE_MAX_BYTES) break;
      out.push(e);
      bytes += n;
    }
    void fetch(`${SB_URL}/rest/v1/rpc/log_app_events`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: SB_ANON, Authorization: `Bearer ${_token ?? SB_ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_events: out }),
    }).catch(() => {});
  } catch {
    // no-op
  }
}

/**
 * 로그아웃 직전 — 지금 계정 토큰이 살아 있을 때 쌓인 기록을 보낸다(최대 maxMs 기다림).
 * 로그아웃 뒤에 보내면 서버가 누구의 것으로도 찍지 않아(0340) 그 사람 타임라인에서 빠진다.
 */
export async function flushAnalyticsBeforeSignOut(maxMs = 3000): Promise<void> {
  try {
    const t0 = Date.now();
    while ((_inflight || _queue.length) && Date.now() - t0 < maxMs) {
      if (!_inflight) flushAnalytics();
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    // 로그아웃을 막지 않는다
  }
}

function requeue(batch: QueuedEvent[]): void {
  _queue = [...batch, ..._queue];
  dropOldest(_queue.length - QUEUE_MAX);
}

// 이벤트 id(uuid v4). 서버는 같은 id 를 한 번만 저장한다. 충돌 방지용이라 Math.random 대체도 충분하다.
function eventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function stamp(): Omit<QueuedEvent, 'event' | 'props'> {
  return {
    id: eventId(),
    uid: _ctx.userId,
    route: routeOf(),
    at: new Date().toISOString(),
    unit_id: _ctx.unitId,
    platform: Platform.OS,
    app_version: APP_VERSION,
    session_id: _sessionId,
  };
}

/**
 * 제품 퍼널/품질/리텐션 이벤트를 원격에 기록한다(fire-and-forget).
 * @param event 이벤트명(예: 'store_created', 'store_created_failed', 'join_requested', 'ai_fallback')
 * @param props 이벤트 속성(선택). 자유 입력 문장을 넣지 않는다.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    if (!HAS_SUPABASE) return;
    if (overRateCap(_eventsSent)) {
      _dropped++;
      return;
    }
    // PostHog 병행 전송 — unit_id/role 은 register(super property)로 이미 붙는다.
    // 화면 이동 계측은 보내지 않는다. 웹 PostHog 는 pageview 를 스스로 잡는다(D1: 웹 PostHog 는 그대로).
    if (!SCREEN_EVENTS.has(event)) phCapture(event, props);
    if (!EVENT_RE.test(event) || (props && byteLength(JSON.stringify(props)) > PROPS_MAX_BYTES)) {
      _dropped++; // 서버가 묶음째 거부할 이벤트는 넣지 않는다
      return;
    }
    _queue.push({ ...stamp(), event, props: props ?? null });
    dropOldest(_queue.length - QUEUE_MAX);
    if (!_failures && _queue.length >= FLUSH_AT) flushAnalytics();
    else schedule();
  } catch {
    // no-op
  }
}
