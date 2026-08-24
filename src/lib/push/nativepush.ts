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
import { canManage } from '@/lib/utils/roles';
import type { PushPermission } from '@/lib/push/webpush';

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

// 알림 클릭 목적지 교정 — usePushBootstrap(웹) 의 routeForRole 과 같은 규칙(발송 측이 수신자 역할을
// 모르므로 클릭 시점의 세션 역할로 접두사를 뒤집는다). 이벤트 소스가 완전히 다른 API 라(SW 메시지 ↔
// 알림 응답 리스너) 모듈은 나누되 규칙만 그대로 복제한다.
function routeForRole(url: string): string {
  const role = useSessionStore.getState().role;
  if (canManage(role) && url.startsWith('/junior/')) return '/owner/' + url.slice('/junior/'.length);
  if (role === 'junior' && url.startsWith('/owner/')) return '/junior/' + url.slice('/owner/'.length);
  return url;
}

let listenerBound = false;

/** 알림 탭 → 앱 내 라우팅. 부팅 1회만 건다. */
export function bindNotificationTapRouting(): void {
  if (listenerBound || !pushSupported()) return;
  listenerBound = true;
  Notifications.addNotificationResponseReceivedListener((res) => {
    const url = res.notification.request.content.data?.url as string | undefined;
    if (!url) return;
    try {
      router.push(routeForRole(url) as never);
    } catch {
      /* 알 수 없는 경로면 무시 — 앱은 열려 있는 상태 유지 */
    }
  });
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

async function registerToken(unitId: string | null): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const { error } = await supabase.rpc('save_push_device_token', {
      p_token: token,
      p_platform: platform,
      p_unit_id: unitId,
    });
    if (error) reportError('push.native.saveToken', error);
  } catch (e) {
    // 시뮬레이터/에뮬레이터(물리 기기 아님)거나 네트워크 문제 — 실기기에선 다음 부팅에 재시도된다.
    reportError('push.native.getToken', e);
  }
}

/** 권한을 요청하고 토큰까지 등록한다. 사용자가 "알림 켜기"를 누를 때(웹의 enablePush 와 대응). */
export async function enableNativePush(unitId: string | null): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notifications.requestPermissionsAsync();
  const status = mapStatus(perm.status);
  if (status !== 'granted') return status;
  await registerToken(unitId);
  return 'granted';
}

/** 이미 권한이 있으면 조용히 토큰을 등록/갱신한다. 부팅 시(웹의 ensurePushSubscribed 와 대응). */
export async function ensureNativePushRegistered(unitId: string | null): Promise<void> {
  if (!pushSupported()) return;
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') return;
  await registerToken(unitId);
}
