// lib/push/signOutPush.ts
// 로그아웃할 때 이 기기 푸시를 먼저 푸는 순서(Q3 · Q16 · A1). 순수 로직만 둔다 — 저장소·RPC·알림 API 는 호출부가 넘긴다.
// 회귀 테스트: qa:signout-push(순수) · qa:signout-push-db(로컬 도커 RPC).
//
// 순서: 캐시 토큰 읽기 → unregister_my_push(4초 제한) → 실패하면 pending 저장 → 알림센터 비우기·배지 0
//       → 웹 구독 해제 → signOut({scope:'local'}).
// 오프라인 로그아웃이면 서버 세션이 남아 푸시가 계속 온다(A1). 그래서 pending 을 남기고, 다음 부팅에
// release_push_token 으로 먼저 푼다. 등록에 성공하면 pending 을 지운다 — 남겨 두면 같은 계정의 새 등록을 지운다.
// ★이 파일은 다른 모듈을 import 하지 않는다(Node 하니스가 그대로 읽는다).

export const PUSH_TOKEN_KEY = 'sqt.expoPushToken';
export const PUSH_PENDING_KEY = 'sqt.pushReleasePending';
export const PUSH_UNREGISTER_TIMEOUT_MS = 4000;

type MaybePromise<T> = T | Promise<T>;
/** authStorage(네이티브 AsyncStorage · 웹 authStorage.web.ts) 모양. */
export type PushKV = {
  getItem(key: string): MaybePromise<string | null>;
  setItem(key: string, value: string): MaybePromise<void>;
  removeItem(key: string): MaybePromise<void>;
};
export type PendingRelease = { token: string; userId: string };

/** 제한 시간 안에 true 가 나와야 성공이다. 시간이 넘으면 signal 을 abort 하고 false. 던져도 false. */
export async function withTimeout(run: (signal: AbortSignal) => Promise<boolean>, ms: number): Promise<boolean> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([run(ctrl.signal).then((ok) => ok === true, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function parsePending(raw: string | null | undefined): PendingRelease | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingRelease> | null;
    if (v && typeof v.token === 'string' && v.token && typeof v.userId === 'string' && v.userId) {
      return { token: v.token, userId: v.userId };
    }
  } catch {
    /* 깨진 값 */
  }
  return null;
}

async function quietly(step: () => MaybePromise<unknown>): Promise<void> {
  try {
    await step();
  } catch {
    /* 로그아웃은 어떤 단계가 실패해도 끝까지 간다 */
  }
}

export type SignOutPushDeps = {
  kv: PushKV;
  userId: string | null;
  /** unregister_my_push. 토큰이 없으면 null 을 넘긴다(서버가 지금 세션 행을 지운다). */
  unregister: (token: string | null, signal: AbortSignal) => Promise<boolean>;
  /** 네이티브: 알림센터 비우기 + 배지 0. 웹: 아무것도 안 함. */
  clearNotifications: () => Promise<void>;
  /** 웹: disablePush(). 네이티브: 아무것도 안 함. */
  disableWebPush: () => Promise<void>;
  /** supabase.auth.signOut({ scope: 'local' }) */
  signOutLocal: () => Promise<void>;
  timeoutMs?: number;
};

/** 로그아웃 순서 전체. 절대 던지지 않는다. */
export async function signOutWithPushRelease(d: SignOutPushDeps): Promise<{ released: boolean; pendingSaved: boolean }> {
  const ms = d.timeoutMs ?? PUSH_UNREGISTER_TIMEOUT_MS;
  let token: string | null = null;
  try {
    token = (await d.kv.getItem(PUSH_TOKEN_KEY)) || null;
  } catch {
    token = null;
  }
  const released = await withTimeout((signal) => d.unregister(token, signal), ms);
  let pendingSaved = false;
  if (!released && token && d.userId) {
    try {
      await d.kv.setItem(PUSH_PENDING_KEY, JSON.stringify({ token, userId: d.userId }));
      pendingSaved = true;
    } catch {
      /* 저장소 실패 — 서버 판정(0236 세션 묶음)에 맡긴다 */
    }
  }
  await quietly(d.clearNotifications);
  await withTimeout(async () => {
    await d.disableWebPush();
    return true;
  }, ms);
  await quietly(d.signOutLocal);
  return { released, pendingSaved };
}

/** 부팅 때 pending 을 먼저 푼다. 풀리면 지우고, 실패하면 남겨 다음에 다시 한다. 깨진 값은 지운다. */
export async function releasePendingPush(
  kv: PushKV,
  release: (p: PendingRelease) => Promise<boolean>,
  timeoutMs: number = PUSH_UNREGISTER_TIMEOUT_MS,
): Promise<'none' | 'released' | 'kept'> {
  let raw: string | null = null;
  try {
    raw = await kv.getItem(PUSH_PENDING_KEY);
  } catch {
    return 'kept';
  }
  const p = parsePending(raw);
  if (!p) {
    if (raw != null) await quietly(() => kv.removeItem(PUSH_PENDING_KEY));
    return 'none';
  }
  const ok = await withTimeout(() => release(p), timeoutMs);
  if (!ok) return 'kept';
  await quietly(() => kv.removeItem(PUSH_PENDING_KEY));
  return 'released';
}

/** 등록에 성공한 뒤: 토큰을 캐시하고(오프라인 로그아웃 때 쓴다) pending 을 지운다. */
export async function rememberRegisteredToken(kv: PushKV, token: string): Promise<void> {
  await quietly(() => kv.setItem(PUSH_TOKEN_KEY, token));
  await quietly(() => kv.removeItem(PUSH_PENDING_KEY));
}
