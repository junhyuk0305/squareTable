// lib/push/webpush.ts
// 웹푸시(브라우저 Push API) 클라이언트 — 서비스워커 등록 · 권한 요청 · 구독 · 구독정보 DB 저장/해제.
//
// 동작 범위: 웹(PWA)만. 네이티브(document/navigator 없음)에서는 전부 no-op 으로 안전 반환.
// 플랫폼 지원:
//   - 안드로이드 크롬/삼성인터넷·데스크톱 크롬/파폭/엣지: 탭에서도 동작.
//   - iOS 사파리: '홈 화면에 추가'로 PWA 설치한 경우에만(iOS 16.4+). standalone 아니면 구독 불가.
//
// 발송은 서버(supabase/functions/push)가 한다. 여기선 "이 기기를 이 사용자 앞으로 등록"만.

import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/analytics/track';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** 이 브라우저가 웹푸시를 지원하고, 키가 설정돼 있는가. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

/** iOS 사파리는 '홈 화면에 추가'(standalone)로 설치해야 푸시가 된다. 설치 안내가 필요한 상태인지. */
export function needsIosInstall(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iP(hone|ad|od)/.test(ua);
  if (!isIos) return false;
  const standalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  // 설치 안 된 iOS Safari 는 PushManager 자체가 없다 → 설치 안내가 필요.
  return !standalone;
}

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function permissionState(): PushPermission {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushPermission;
}

let _swReg: ServiceWorkerRegistration | null = null;

/** 서비스워커 등록(1회). 앱 부팅 시 호출. 실패해도 앱은 계속 동작(푸시만 비활성). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (_swReg) return _swReg;
  try {
    _swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return _swReg;
  } catch (e) {
    console.warn('[push] SW 등록 실패:', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // ArrayBuffer 를 명시적으로 잡아 Uint8Array<ArrayBuffer>(BufferSource) 로 만든다
  // (제네릭 ArrayBufferLike 면 pushManager.subscribe 의 applicationServerKey 타입과 안 맞음).
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 구독 객체를 DB(push_subscriptions)에 upsert. endpoint unique 라 재구독 시 갱신된다. */
async function saveSubscription(
  sub: PushSubscription,
  userId: string,
  unitId: string | null,
): Promise<boolean> {
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) return false;
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      unit_id: unitId,
      endpoint: json.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) {
    console.warn('[push] 구독 저장 실패:', error.message);
    reportError('push.saveSubscription', error);
    return false;
  }
  return true;
}

/**
 * 권한을 요청하고 구독까지 마친 뒤 DB에 저장한다. (사용자가 "알림 켜기" 를 누를 때 호출)
 * 반환: 최종 권한 상태. 'granted' 면 구독까지 성공.
 */
export async function enablePush(userId: string, unitId: string | null): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';

  let perm = Notification.permission as PushPermission;
  if (perm === 'default') {
    perm = (await Notification.requestPermission()) as PushPermission;
  }
  if (perm !== 'granted') return perm;

  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
    await saveSubscription(sub, userId, unitId);
    return 'granted';
  } catch (e) {
    console.warn('[push] 구독 실패:', e);
    reportError('push.subscribe', e);
    return perm;
  }
}

/**
 * 이미 권한이 있으면 조용히 구독을 보장(로그인/부팅 시 호출).
 * 새 기기·구독 회전으로 DB에 없을 수 있으니 항상 최신 구독을 다시 저장한다. 권한 요청 팝업은 띄우지 않는다.
 */
export async function ensurePushSubscribed(userId: string, unitId: string | null): Promise<void> {
  if (!pushSupported()) return;
  if (Notification.permission !== 'granted') return;
  const reg = await registerServiceWorker();
  if (!reg) return;
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
    await saveSubscription(sub, userId, unitId);
  } catch (e) {
    console.warn('[push] 자동 구독 보장 실패:', e);
  }
}

/** 알림 끄기 — 브라우저 구독 해제 + DB에서 해당 구독행 삭제. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await registerServiceWorker();
  if (!reg) return;
  try {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
  } catch (e) {
    console.warn('[push] 구독 해제 실패:', e);
  }
}
