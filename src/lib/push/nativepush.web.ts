// lib/push/nativepush.web.ts
// 웹 no-op — 웹 푸시는 webpush.ts(브라우저 Push API)가 담당한다. 여기는 expo-notifications 를
// 웹 번들에 정적 import 하지 않기 위한 자리(platform.md: 네이티브 전용 모듈은 웹 경로에서 정적 import 금지).
import type { PushPermission } from '@/lib/push/webpush';

export function pushSupported(): boolean {
  return false;
}
export function bindNotificationTapRouting(): void {}
export async function nativePermissionState(): Promise<PushPermission> {
  return 'unsupported';
}
export async function enableNativePush(_unitId: string | null): Promise<PushPermission> {
  return 'unsupported';
}
export async function ensureNativePushRegistered(_unitId: string | null): Promise<void> {}
