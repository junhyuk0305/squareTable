// lib/push/notify.ts
// 인앱 이벤트 → 웹푸시 발송 트리거. db.ts/스토어의 쓰기 성공 직후 호출한다.
//
// 설계: fire-and-forget. 알림 발송 실패가 원래 작업(공지 등록·교대 신청)을 막으면 안 되므로
//   절대 throw 하지 않고, UI 흐름을 블록하지 않는다(await 하지 않아도 됨). 실제 발송/대상 해석/
//   테넌트 격리는 서버(supabase/functions/push)가 담당 — 여기선 "무엇을 누구에게" 만 넘긴다.
//
// 인앱 알림(벨 뱃지·목록)은 기존 SSOT(lib/utils/notifications.ts)가 그대로 담당한다.
// 이 파일은 그 위에 "앱이 꺼져 있어도 오는 OS 알림" 만 얹는다 — 두 경로가 같은 이벤트를 가리킨다.

import { supabase, HAS_SUPABASE } from '@/lib/supabase';
import { track, reportError } from '@/lib/analytics/track';

export type PushAudience = 'owners' | 'staff' | 'user' | 'join_owners';

type NotifyArgs = {
  audience: PushAudience;
  /** audience='user' 일 때 대상 사용자 id. */
  userId?: string;
  title: string;
  body?: string;
  /** 클릭 시 열 앱 내부 경로(예: '/owner/inbox'). */
  url?: string;
  /** 같은 알림 덮어쓰기용 태그(중복 누적 방지). */
  tag?: string;
};

/** 웹푸시 발송(비차단). 서버가 호출자 매장 안으로만 발송하도록 강제한다.
 *
 * 계측(2026-07-07): 예전엔 결과를 `.catch(console.warn)` 로만 삼켜서 "앱이 실제로 발송을 쐈는지·
 * 누구에게 갔는지·왜 0건인지"를 서버에서 전혀 볼 수 없었다(무음 실패 + 관측 0건). 이제 매 발송의
 * 결과를 app_events('push_sent')·client_errors 로 남긴다 → "안 왔다"를 추측 대신 데이터로 진단한다.
 *   - 정상: app_events push_sent {sent, recipients, pruned}
 *   - recipients>0·sent=0: 구독이 전부 죽음(죽은 endpoint) → push.no_delivery (무음 실패의 핵심 신호)
 *   - invoke 에러(401/403/네트워크): client_errors push.notify.* → 앱이 발송 자체를 못 함
 * fire-and-forget 원칙은 유지(await 안 함, throw 안 함) — 계측만 배경에서 얹는다. */
export function pushNotify(args: NotifyArgs): void {
  if (!HAS_SUPABASE || !PUSH_ENDPOINT) return;
  void attemptNotify(args, 0);
}

// ★ 발송은 raw fetch 로 한다(= AI 클라이언트 lib/ai/client.ts 와 동일 패턴). 이전엔 supabase.functions.invoke
//   를 썼는데, 브라우저에서 invoke 는 'x-client-info' 헤더를 자동으로 붙인다. 그런데 엣지 push 함수의
//   Access-Control-Allow-Headers 가 그 헤더를 허용하지 않아 **브라우저 CORS 프리플라이트가 항상 실패**
//   → "Failed to send a request to the Edge Function"(FunctionsFetchError) 로 발송이 결정적으로 죽었다
//   (라이브 계측으로 확정, 2026-07-07: attempts=3 전부 실패, push_sent 성공 0건). Node/서버 호출은 CORS 를
//   안 타서 늘 성공했기에 "직접 테스트는 오는데 앱 액션은 안 감" 이 나타난 것. AI 는 처음부터 raw fetch 라
//   멀쩡했다. raw fetch 는 헤더를 우리가 통제 → x-client-info 미포함 → 프리플라이트 통과. (엣지 재배포 불필요.)
// 재시도: 네트워크/타임아웃/5xx 만 짧은 백오프로. 4xx(인증·검증·cross_tenant·no_unit·rate_limited)는 즉시 포기.
// 여전히 fire-and-forget(throw 안 함).
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const PUSH_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/push` : null;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1500]; // 1차 재시도 0.4s, 2차 1.5s 뒤
const TIMEOUT_MS = 12_000;

async function attemptNotify(args: NotifyArgs, attempt: number): Promise<void> {
  // 엣지는 "실제 로그인 유저"만 허용(anon 단독 거부). apikey=게이트웨이 anon, Authorization=세션 토큰.
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) {
    reportError('push.notify.no_session', 'no auth session', { audience: args.audience, tag: args.tag });
    return; // 로그인 전이면 발송 불가 — 재시도 무의미.
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(PUSH_ENDPOINT as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 4xx(인증·검증·cross_tenant·no_unit·rate_limited)는 재시도해도 결과 동일 → 즉시 포기.
      if (res.status < 500) {
        reportError('push.notify.invoke', `status ${res.status}`, { audience: args.audience, tag: args.tag, attempts: attempt + 1 });
        return;
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await delay(BACKOFF_MS[attempt] ?? 1500);
        return attemptNotify(args, attempt + 1);
      }
      reportError('push.notify.invoke', `status ${res.status}`, { audience: args.audience, tag: args.tag, attempts: attempt + 1 });
      return;
    }
    const r = (await res.json().catch(() => ({}))) as { sent?: number; recipients?: number; pruned?: number };
    track('push_sent', {
      audience: args.audience,
      tag: args.tag ?? null,
      sent: r.sent ?? 0,
      recipients: r.recipients ?? 0,
      pruned: r.pruned ?? 0,
      attempts: attempt + 1,
    });
    // 대상은 있는데 실제 전송 0 = 살아있는 구독이 하나도 없음(죽은 endpoint 뿐). "안 온다"의 다른 원인.
    if ((r.recipients ?? 0) > 0 && (r.sent ?? 0) === 0) {
      reportError('push.notify.no_delivery', 'recipients>0 but sent=0 (구독 전부 사망 추정)', {
        audience: args.audience,
        recipients: r.recipients,
      });
    }
  } catch (e) {
    // 네트워크/타임아웃(AbortError) → 재시도.
    if (attempt < MAX_ATTEMPTS - 1) {
      await delay(BACKOFF_MS[attempt] ?? 1500);
      return attemptNotify(args, attempt + 1);
    }
    reportError('push.notify.throw', e, { audience: args.audience, attempts: attempt + 1 });
  } finally {
    clearTimeout(timer);
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── 이벤트별 헬퍼 (호출부가 문자열을 안 틀리게 얇게 감싼다) ────────────────
// 사장이 받는 것들 (직원 행동 → 사장)
// 합류 신청은 신청자가 아직 그 매장 소속이 아니다(pending). 서버가 신청자의 pending_unit_id 를
// 해석해 그 매장 사장에게만 보낸다 → 신청한 매장 밖으로는 절대 못 보낸다(테넌트 안전).
export const notifyOwnersJoinRequest = (name: string) =>
  pushNotify({
    audience: 'join_owners',
    title: '합류 신청',
    body: `${name}님이 합류를 신청했어요`,
    url: '/owner/staff',
    tag: 'join',
  });

export const notifyOwnersQuestion = (q: string) =>
  pushNotify({
    audience: 'owners',
    title: '답변 대기 질문',
    body: q,
    url: '/owner/inbox',
    tag: 'question',
  });

// S1 ③(D4): 미답질문을 사장 + 같은 매장 직원 전체에게(누가 답하든 됨). 질문한 본인은 서버가 발송 대상에서 제외.
// 엣지 무변경 — 기존 'owners'/'staff' audience 두 경로로 보낸다(각 매장 스코프 유지). 직원은 노하우 탭(내 공간)으로.
export const notifyStoreQuestion = (q: string) => {
  void notifyOwnersQuestion(q);
  return pushNotify({
    audience: 'staff',
    title: '동료 질문 — 도와줄 수 있어요',
    body: q,
    url: '/junior/chat',
    tag: 'question',
  });
};

export const notifyOwnersSuggestion = (name: string, text: string) =>
  pushNotify({
    audience: 'owners',
    title: `${name}님의 노하우 제안`,
    body: text,
    url: '/owner/suggestions',
    tag: 'suggestion',
  });

export const notifyOwnersSwapApproval = (when: string) =>
  pushNotify({
    audience: 'owners',
    title: '교대 승인 대기',
    body: `교대 요청이 승인을 기다려요 · ${when}`,
    url: '/owner/schedule',
    tag: 'swap-approval',
  });

/** 매니저 지정/해제(0093) — 대상 본인에게만. 다음 진입부터 화면 세트가 바뀌는 걸 알린다. */
export const notifyUserRoleChange = (userId: string, storeName: string, promoted: boolean) =>
  pushNotify({
    audience: 'user',
    userId,
    title: promoted ? '매니저가 됐어요' : '매니저에서 해제됐어요',
    body: storeName,
    url: promoted ? '/owner/dashboard' : '/junior/home',
    tag: 'role',
  });

// 직원이 받는 것들 (사장/동료 행동 → 직원)
export const notifyStaffNotice = (author: string, text: string) =>
  pushNotify({
    audience: 'staff',
    title: `${author}님의 공지`,
    body: text,
    url: '/junior/work',
    tag: 'notice',
  });

/** 대타 요청 — 아무나 수락 가능하므로 매장 직원 전체에게. */
export const notifyStaffSwapRequest = (when: string) =>
  pushNotify({
    audience: 'staff',
    title: '대타 요청',
    body: `교대 대타를 찾고 있어요 · ${when}`,
    url: '/junior/schedule',
    tag: 'swap-req',
  });

/** 맞교환 요청 — 상대가 지정된 경우 그 직원에게만. */
export const notifyUserSwapRequest = (userId: string, when: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: '맞교환 요청',
    body: `나에게 맞교환을 요청했어요 · ${when}`,
    url: '/junior/schedule',
    tag: 'swap-req',
  });

export const notifyUserSwapResult = (userId: string, ok: boolean, when: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: ok ? '교대 확정' : '교대 반려',
    body: when,
    url: '/junior/schedule',
    tag: 'swap-result',
  });

export const notifyUserMention = (userId: string, author: string, text: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: `${author}님이 나를 언급했어요`,
    body: text,
    url: '/junior/work',
    tag: 'mention',
  });

/** 할일 배정 — 사장/동료가 나에게 할일을 배정했을 때 그 담당자에게만. */
export const notifyUserAssign = (userId: string, author: string, text: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: `${author}님이 할 일을 배정했어요`,
    body: text,
    url: '/junior/work',
    tag: 'assign',
  });

/** 훈련 요청(0102) — 관리자가 나에게 이해 확인을 요청했을 때 그 직원에게만. */
export const notifyUserTraining = (userId: string, author: string, text: string) =>
  pushNotify({
    audience: 'user',
    userId,
    title: `${author}님이 퀴즈를 요청했어요`,
    body: text,
    url: '/junior/work',
    tag: 'training',
  });
