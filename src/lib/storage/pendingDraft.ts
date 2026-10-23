import AsyncStorage from '@react-native-async-storage/async-storage';

// 실패를 메모리 저장 성공으로 바꾸지 않는다. 디스크에 남긴 뒤에만 서버로 전송한다.
export const pendingDraftKey = (kind: string, userId: string, unitId: string, item = '') =>
  `sqt.pending.v1:${JSON.stringify([kind, userId, unitId, item])}`;

export async function loadPendingDraft<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw) as T;
}

export async function savePendingDraft<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function clearPendingDraft(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
