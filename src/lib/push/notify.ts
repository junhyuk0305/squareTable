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
// tag·url 은 레지스트리가 정한다(P1). 헬퍼는 kind 와 항목 id 만 말한다 — 벨 항목과 같은 주소로 착지한다.
import { NOTIF, surfaceOfAudience, type NotifKind, type NotifSpec } from '@/lib/notif/registry';

// ★새 값을 더하지 않는다. 0236 이전 엣지는 모르는 audience 를 직원 갈래로 보낸다(웹 번들이 엣지보다 먼저 나가거나 엣지만 롤백될 때).
export type PushAudience = 'owners' | 'staff' | 'user' | 'join_owners';

type NotifyArgs = {
  audience: PushAudience;
  /** 레지스트리 kind — tag(덮어쓰기)·url(탭 착지)을 여기서 푼다. */
  kind: NotifKind;
  /** 그 항목의 id(할일·피드·질문·신청자). 새 엣지는 route 에 싣고, 옛 엣지는 무시한다(목록 화면 착지 · 전과 같다). */
  itemId?: string;
  /** F-2: audience='owners' 를 사장만으로 좁힌다. 옛 엣지는 무시하고 사장+매니저에게 보낸다. */
  ownerOnly?: boolean;
  /** audience='user' 일 때 대상 사용자 id. */
  userId?: string;
  title: string;
  body?: string;
};

/** 엣지로 보내는 몸체 — url·tag 는 레지스트리에서 푼 값(옛 엣지가 url 을 그대로 싣는다 · 새 엣지는 tag·itemId 로 다시 만든다). */
type PushBody = Omit<NotifyArgs, 'kind'> & { url: string; tag: string };
function toBody(args: NotifyArgs): PushBody {
  const { kind, ...rest } = args;
  const spec: NotifSpec = NOTIF[kind];
  return { ...rest, url: spec.route(surfaceOfAudience(args.audience), args.itemId), tag: spec.pushTag ?? kind };
}

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
  void attemptNotify(toBody(args), 0);
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

async function attemptNotify(args: PushBody, attempt: number): Promise<void> {
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
// tag·url 은 레지스트리(NOTIF[kind])가 정한다. 여기서는 kind · 수신 갈래 · 항목 id · 문구만 말한다.
// 사장이 받는 것들 (직원 행동 → 사장)
// 합류 신청은 신청자가 아직 그 매장 소속이 아니다(pending). 서버가 신청자의 pending_unit_id 를
// 해석해 그 매장 사장에게만 보낸다 → 신청한 매장 밖으로는 절대 못 보낸다(테넌트 안전).
// itemId = 신청자 id → 명부 화면이 그 신청 행을 강조한다.
export const notifyOwnersJoinRequest = (name: string, applicantId?: string) =>
  pushNotify({
    audience: 'join_owners',
    kind: 'join_request',
    itemId: applicantId,
    title: '합류 신청',
    body: NOTIF.join_request.title(name),
  });

export const notifyOwnersQuestion = (q: string, uqId?: string) =>
  pushNotify({
    audience: 'owners',
    kind: 'question',
    itemId: uqId,
    title: '답변 대기 질문',
    body: q,
  });

// S1 ③(D4): 미답질문을 사장 + 같은 매장 직원 전체에게(누가 답하든 됨). 질문한 본인은 서버가 발송 대상에서 제외.
// 기존 'owners'/'staff' audience 두 경로로 보낸다(각 매장 스코프 유지). 직원은 물어보기 탭(내 공간)의 그 질문으로.
export const notifyStoreQuestion = (q: string, uqId?: string) => {
  void notifyOwnersQuestion(q, uqId);
  return pushNotify({
    audience: 'staff',
    kind: 'question',
    itemId: uqId,
    title: '동료 질문 — 도와줄 수 있어요',
    body: q,
  });
};

// 제안 검토는 사장만 한다(F-2). 매니저에게 보내면 열 수 없는 /owner/suggestions 로 간다.
export const notifyOwnersSuggestion = (name: string, text: string) =>
  pushNotify({
    audience: 'owners',
    kind: 'suggestion',
    ownerOnly: true,
    title: NOTIF.suggestion.title(name),
    body: text,
  });

export const notifyOwnersSwapApproval = (when: string) =>
  pushNotify({
    audience: 'owners',
    kind: 'swap_approval',
    title: '교대 승인 대기',
    body: `교대 요청이 승인을 기다려요 · ${when}`,
  });

// 근무 시간 수정 요청(J2 · 0243) — 0316 부터 매니저도 결정한다 → 관리자(사장+매니저)에게. 요청자 본인은 엣지가 뺀다.
//   잠긴 매니저는 엣지가 뺀다(0317). 매니저 벨에도 같은 행이 뜬다(managerOwnerRows · 내 요청 제외).
// itemId = 요청 id → 근무표 승인 칸이 그 요청 카드로 스크롤한다(벨 항목과 같은 주소).
export const notifyOwnersShiftTimeRequest = (name: string, when: string, requestId?: string) =>
  pushNotify({
    audience: 'owners',
    kind: 'shift_time',
    itemId: requestId,
    title: NOTIF.shift_time.title(name),
    body: when,
  });

/** 퀴즈 응시 완료(0275) — 서버가 completed_at 을 찍었을 때만(true) 부른다. itemId = 퀴즈 id → 그 퀴즈 결과 탭. */
export const notifyOwnersQuizDone = (courseId: string, name: string, courseName: string) =>
  pushNotify({
    audience: 'owners',
    kind: 'quiz_done',
    itemId: courseId,
    title: NOTIF.quiz_done.title(name),
    body: courseName,
  });

// 매니저 지정/해제 알림은 서버가 보낸다(0315 · set_member_role → member_notices · url /junior/home).
//   예전 notifyUserRoleChange 는 같은 매장 누구나 위조할 수 있어 지웠다. 엣지는 'role' 요청을 무시한다.

// 직원이 받는 것들 (사장/동료 행동 → 직원)
// 공지는 푸시하지 않는다(2026-10-16 사용자 결정) — 공지 패널에서 본다.
/** 대타 요청 — 아무나 수락 가능하므로 매장 직원 전체에게. */
export const notifyStaffSwapRequest = (when: string) =>
  pushNotify({
    audience: 'staff',
    kind: 'swap',
    title: '대타 요청',
    body: `교대 대타를 찾고 있어요 · ${when}`,
  });

/** 맞교환 요청 — 상대가 지정된 경우 그 직원에게만. */
export const notifyUserSwapRequest = (userId: string, when: string) =>
  pushNotify({
    audience: 'user',
    kind: 'swap',
    userId,
    title: '맞교환 요청',
    body: `나에게 맞교환을 요청했어요 · ${when}`,
  });

export const notifyUserSwapResult = (userId: string, ok: boolean, when: string) =>
  pushNotify({
    audience: 'user',
    kind: 'swap_result',
    userId,
    title: ok ? '교대 확정' : '교대 반려',
    body: when,
  });

/** 내가 물은 질문이 노하우로 답이 됐다 — 물어본 본인에게만. 답을 기다리던 사람이 그걸 모르면 루프가 끊긴다.
 *  제목에 답한 사람 이름(역 ③) · 착지는 물어보기 탭의 그 질문(역 ⑤). 벨의 q_answered 항목과 같은 문장·주소다. */
export const notifyUserQuestionAnswered = (userId: string, uqId: string, answerer: string, question: string) =>
  pushNotify({
    audience: 'user',
    kind: 'q_answered',
    itemId: uqId,
    userId,
    title: NOTIF.q_answered.title(answerer),
    body: question,
  });

/** 내 노하우 제안 결과(반영·반려, D12) — 제안한 사람에게만. 반려 사유는 '내가 보낸 제안'에서 본다. */
export const notifyUserSuggestionResult = (userId: string, approved: boolean, text: string) =>
  pushNotify({
    audience: 'user',
    kind: 'suggestion_result',
    userId,
    title: approved ? '내 노하우 제안이 반영됐어요' : '내 노하우 제안이 반려됐어요',
    body: text,
  });

/** 멘션 — 그 글(피드 id)로 착지한다. */
export const notifyUserMention = (userId: string, author: string, text: string, feedId?: string) =>
  pushNotify({
    audience: 'user',
    kind: 'mention',
    itemId: feedId,
    userId,
    title: NOTIF.mention.title(author),
    body: text,
  });

/** 훈련 요청(0102) — 관리자가 나에게 이해 확인을 요청했을 때 그 직원에게만.
 *  요청(training_requests)은 발송 원장(quiz_assignments) 행이 없어 ?quiz=<발송 id> 를 못 싣는다 → 업무 탭 착지(카드가 '요청'으로 뜬다). */
export const notifyUserTraining = (userId: string, author: string, text: string) =>
  pushNotify({
    audience: 'user',
    kind: 'training',
    userId,
    title: NOTIF.training.title(author),
    body: text,
  });
