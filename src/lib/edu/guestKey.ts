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

/** 이 기기에 둔 손님 열쇠 전부와 그 저장 칸(옮기기 확인 · autoClaim.ts). 저장소를 못 읽으면 빈 목록. */
export async function listEduGuestKeys(): Promise<{ slot: string; key: string }[]> {
  try {
    const names = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (names.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(names);
    const keys: { slot: string; key: string }[] = [];
    for (const [name, raw] of pairs) {
      if (!raw) continue;
      try {
        const v = JSON.parse(raw) as Partial<EduGuest>;
        if (typeof v.key === 'string' && v.key) keys.push({ slot: name, key: v.key });
      } catch {
        // 깨진 값은 건너뛴다.
      }
    }
    return keys;
  } catch {
    return [];
  }
}

/** 옮기지 않기로 한 열쇠를 이 기기에서 지운다(공용 기기 · 1112 fix 5). 못 지우면 그대로 둔다. */
export async function forgetEduGuests(slots: string[]): Promise<void> {
  try {
    if (slots.length > 0) await AsyncStorage.multiRemove(slots);
  } catch {
    // 저장소를 못 쓰면 다음 로그인에 다시 묻는다.
  }
}

// 이미 답한 (계정 · 열쇠) — 열쇠 원문 대신 짧은 지문으로 둔다(저장소 목록에 열쇠가 두 번 남지 않게).
const ASKED = 'sqt.eduGuestAsked.v1';
export const askedTag = (uid: string, key: string): string => `${uid}:${slot(key).slice(PREFIX.length)}`;

export async function loadAskedTags(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(ASKED);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export async function saveAskedTags(tags: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(ASKED, JSON.stringify([...tags]));
  } catch {
    // 저장 못 하면 다음 로그인에 다시 묻는다.
  }
}
