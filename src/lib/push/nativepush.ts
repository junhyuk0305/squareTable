// lib/push/nativepush.ts
// 네이티브(Android·iOS) 푸시 — Expo Notifications. 웹은 nativepush.web.ts(no-op, 웹 푸시는 webpush.ts 담당).
//
// 발송은 서버(supabase/functions/push)가 Expo Push API 로 한다. 여기선 "이 기기를 이 사용자 앞으로 등록"과
// "알림 탭 → 앱 내 라우팅"만 맡는다(웹의 webpush.ts + usePushBootstrap 과 같은 역할 분담).
//
// ★Expo Push 발송이 실제 기기에 도달하려면 EAS 에 APNs 키(iOS)·FCM 서비스 계정(Android) 크리덴셜이
//   등록돼 있어야 한다(`eas credentials`). 이 파일은 그 등록이 끝나 있다는 전제로 토큰 발급·등록만 한다 —
//   크리덴셜이 없으면 getExpoPushTokenAsync 자체는 성공해도 서버 발송이 조용히 실패한다.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/analytics/track';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { routeForRole } from '@/lib/utils/roles';
// db 는 useSessionStore 가 이미 정적으로 import 한다 → 부팅 그래프에 새 모듈이 늘지 않는다.
import { fetchOwnerAlertMeta } from '@/lib/db';
import type { PushPermission } from '@/lib/push/webpush';
import { authStorage } from '@/lib/storage/authStorage';
import { releasePendingPush, rememberRegisteredToken } from '@/lib/push/signOutPush';

// 앱이 켜져 있는 동안 수신한 알림도 배너로 보여준다 — 기본 핸들러는 포그라운드에서 숨기므로,
// 설정 안 하면 "왔는데 안 보임"으로 보인다(웹의 SW 는 항상 OS 알림창을 쓰므로 이 문제가 없다).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === 'android') {
  // Android 8+ 는 채널이 없으면 알림이 조용히 낮은 우선순위로 묻힌다.
  void Notifications.setNotificationChannelAsync('default', {
    name: '기본',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export function pushSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

let listenerBound = false;

/** 알림 탭 → 앱 내 라우팅. 부팅 1회만 건다. */
export function bindNotificationTapRouting(): void {
  if (listenerBound || !pushSupported()) return;
  listenerBound = true;
  Notifications.addNotificationResponseReceivedListener((res) => {
    const content = res.notification.request.content;
    const url = content.data?.url as string | undefined;
    if (!url) return;
    void resolveTapUrl(url, content.categoryIdentifier).then((to) => {
      try {
        // 목적지 교정은 웹(usePushBootstrap)과 같은 roles.ts routeForRole 하나를 쓴다(F-2).
        router.push(routeForRole(to, useSessionStore.getState().role) as never);
      } catch {
        /* 알 수 없는 경로면 무시 — 앱은 열려 있는 상태 유지 */
      }
    });
  });
}

// 사장 알림 푸시는 엣지가 종류와 상관없이 '/billing' 을 싣는다(push/index.ts sweepOwnerAlerts).
// tag 'owner-alert-<id>' 가 categoryIdentifier 로 오므로 그 행의 kind 로 목록과 같은 목적지를 고른다.
// ★알림 매장이 지금 활성 매장일 때만 바꾼다. 다른 매장이면 그 매장에서의 역할(직원·매니저)이나 노하우가
//   어긋난다(직원이면 /junior/brand-link 같은 없는 화면). 그때와 못 읽었을 때(세션 복원 전·RLS 0행)는
//   실린 url 그대로 간다. 지금 동작과 같다.
async function resolveTapUrl(url: string, category: string | null): Promise<string> {
  const m = /^owner-alert-(\d+)$/.exec(category ?? '');
  if (!m) return url;
  try {
    const a = await fetchOwnerAlertMeta(Number(m[1]));
    if (!a || a.unit_id !== useSessionStore.getState().unitId) return url;
    // 동적 import — notifications.ts 는 스토어(useWorkStore 등)를 끌고 와서 부팅 경로에 두지 않는다.
    const { ownerAlertRoute } = await import('@/lib/utils/notifications');
    return ownerAlertRoute(a.kind);
  } catch {
    return url;
  }
}

// expo-notifications 는 'undetermined'를 쓴다 — 웹의 PushPermission('default')과 어휘를 맞춘다.
function mapStatus(status: string): PushPermission {
  if (status === 'granted' || status === 'denied') return status;
  return 'default';
}

/** 현재 권한 상태(비동기 — 웹의 permissionState()와 달리 native API 자체가 async). */
export async function nativePermissionState(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notifications.getPermissionsAsync();
  return mapStatus(perm.status);
}

// ★성공 여부를 돌려준다(2026-08-25 감사 #9) — 예전엔 void 라 호출부가 저장 실패와 무관하게
//   'granted' 를 확정 반환했고, 토큰 행이 없어 **푸시가 영영 안 오는데 카드는 사라졌다**.
async function registerToken(unitId: string | null): Promise<boolean> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    // 오프라인 로그아웃이 남긴 pending 을 등록보다 먼저 푼다. 거꾸로 하면 같은 계정의 새 등록이 지워진다.
    // 같은 계정·같은 토큰이면 보내지 않는다(아래 save 가 덮어쓴다 · signOutPush.ts superseded).
    await releasePendingPushToken(token);
    const { error } = await supabase.rpc('save_push_device_token', {
      p_token: token,
      p_platform: platform,
      p_unit_id: unitId,
    });
    if (error) {
      reportError('push.native.saveToken', error);
      return false;
    }
    // 토큰을 기기에 캐시한다(오프라인 로그아웃 때 getExpoPushTokenAsync 는 실패한다). pending 은 지운다.
    await rememberRegisteredToken(authStorage, token);
    return true;
  } catch (e) {
    // 시뮬레이터/에뮬레이터(물리 기기 아님)거나 네트워크 문제 — 실기기에선 다음 부팅에 재시도된다.
    reportError('push.native.getToken', e);
    return false;
  }
}

/** 권한을 요청하고 토큰까지 등록한다. 사용자가 "알림 켜기"를 누를 때(웹의 enablePush 와 대응). */
export async function enableNativePush(unitId: string | null): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notifications.requestPermissionsAsync();
  const status = mapStatus(perm.status);
  if (status !== 'granted') return status;
  // OS 권한은 받았지만 우리 쪽 토큰 등록이 실패하면 켜진 게 아니다 — 카드를 남겨 재시도를 열어둔다.
  if (!(await registerToken(unitId))) return 'default';
  return 'granted';
}

let releasing: Promise<unknown> = Promise.resolve();

/** 오프라인 로그아웃이 남긴 pending 을 release_push_token(anon 허용)으로 푼다(A1).
 *  부팅 때와 앱을 다시 열 때(active) 로그인 여부와 상관없이 부르고, 등록 직전에도 부른다.
 *  token = 곧 등록할 토큰(없으면 캐시 토큰과 비교). 동시에 두 번 돌지 않게 한 줄로 세운다. */
export function releasePendingPushToken(token?: string): Promise<unknown> {
  if (!pushSupported()) return Promise.resolve();
  const run = () => {
    const s = useSessionStore.getState();
    return releasePendingPush(
      authStorage,
      async (p, signal) => {
        const { error } = await supabase
          .rpc('release_push_token', { p_token: p.token, p_user: p.userId })
          .abortSignal(signal);
        if (error && !signal.aborted) reportError('push.native.release', error);
        return !error;
      },
      undefined,
      { userId: s.status === 'signed_in' ? s.userId || null : null, token },
    );
  };
  releasing = releasing.then(run, run);
  return releasing;
}

/** 로그아웃 때 이전 계정의 알림 미리보기와 앱 아이콘 배지를 지운다. */
export async function clearDeviceNotifications(): Promise<void> {
  if (!pushSupported()) return;
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
  await Notifications.setBadgeCountAsync(0).catch(() => {});
}

/** 이미 권한이 있으면 조용히 토큰을 등록/갱신한다. 부팅 시(웹의 ensurePushSubscribed 와 대응). */
export async function ensureNativePushRegistered(unitId: string | null): Promise<void> {
  if (!pushSupported()) return;
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') return;
  await registerToken(unitId);
}
