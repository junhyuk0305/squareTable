/**
 * 교육 링크 손님 열쇠 보관(0401 · 3판 9-2) — 이 기기(브라우저)에만 둔다. 링크 하나에 열쇠 하나와 적은 이름.
 * 열쇠는 서버가 처음 물을 때 한 번만 준다. 잃으면(브라우저 데이터 지움 · 다른 기기) 그 질문 기록은 다시 못 연다(의도 · 처리방침 v2.5).
 * 저장소를 못 쓰는 환경(사생활 보호 창 등)에서도 화면은 돈다: 읽기 실패 = 열쇠 없음, 쓰기 실패 = 이번 화면에서만 기억.
 * 가입 뒤 질문 옮기기(4번 뒷부분)는 이 열쇠를 서버에 한 번 더 보내 손님 행을 찾는다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type EduGuest = { key: string; name: string };

// 토큰 원문을 저장소 키 이름에 그대로 쓰지 않는다(브라우저 저장소 목록에 주소가 그대로 남지 않게 · 짧은 지문만).
function slot(token: string): string {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return `sqt.eduGuest.v1:${(h >>> 0).toString(16)}:${token.length}`;
}

export async function loadEduGuest(token: string): Promise<EduGuest | null> {
  try {
    const raw = await AsyncStorage.getItem(slot(token));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<EduGuest>;
    return typeof v.key === 'string' && typeof v.name === 'string' ? { key: v.key, name: v.name } : null;
  } catch {
    return null;
  }
}

export async function saveEduGuest(token: string, guest: EduGuest): Promise<void> {
  try {
    await AsyncStorage.setItem(slot(token), JSON.stringify(guest));
  } catch {
    // 저장 못 하면 이번 화면에서만 기억한다(위 머리말).
  }
}

const PREFIX = 'sqt.eduGuest.v1:';

/** 이 기기에 둔 손님 열쇠 전부(가입 뒤 자동 옮기기 · autoClaim.ts). 저장소를 못 읽으면 빈 목록. */
export async function listEduGuestKeys(): Promise<string[]> {
  try {
    const names = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (names.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(names);
    const keys: string[] = [];
    for (const [, raw] of pairs) {
      if (!raw) continue;
      try {
        const v = JSON.parse(raw) as Partial<EduGuest>;
        if (typeof v.key === 'string' && v.key) keys.push(v.key);
      } catch {
        // 깨진 값은 건너뛴다.
      }
    }
    return keys;
  } catch {
    return [];
  }
}
