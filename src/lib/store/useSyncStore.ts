// 전역 동기화 상태 — 서버와의 통신 실패를 사용자에게 **한 곳에서** 알린다.
//
// 축이 둘이고 성격이 다르다. 섞으면 한쪽이 다른 쪽을 덮어써서 둘 다 못 쓰게 된다.
//
//   ① 쓰기 실패(error)      "저장이 안 됐다" — 사건이다. 이미 롤백됐고 사용자는 다시 누르면 된다.
//                           → 3초 뒤 자동 소거(SyncBanner). 기존 동작 그대로.
//   ② 읽기 실패(readError)  "지금 보이는 게 전부가 아니다" — 상태다. 그래서 자동 소거가 없다.
//                           → 사라지는 조건은 **실패 종류마다 다르다**(바로 아래).
//
// ★왜 갈랐나 (2026-08-11 실측 QA · [P2-#3]·[P5-#5]·기존-14)
//   예전엔 읽기 실패도 noteError 로 들어가 **3초 뒤 사라졌다.** 그래서
//   "백엔드가 죽었는데 화면은 '아직 등록된 노하우가 없어요'" 상태가 **아무 표시 없이** 유지됐다.
//   배너가 없던 게 아니라, 있다가 사라진 뒤가 문제였다. 읽기 실패는 사건이 아니라 상태다.
//
// ★읽기 실패를 다시 둘로 가른 이유 (2026-08-11 두 번째 실측)
//   0138 미적용으로 shift_templates.shift_date 조회가 42703 을 뱉는 동안, 배너는 **인터넷 탓**을 했다.
//   연결은 멀쩡했고 나머지 화면은 다 됐다 — 사용자는 "잘 되는데 왜 이 문구가 뜨지"가 된다.
//   서버가 응답을 준 실패와, 서버에 닿지도 못한 실패는 원인도 복구 조건도 다르다.
//     offline  서버에 못 닿음 → 연결이 돌아오면 **저절로** 참이 아니게 된다(성공 왕복·online 이벤트로 해제).
//     server   서버가 응답한 쿼리 실패(스키마 드리프트·권한·5xx) → 옆 요청이 성공해도 이건 여전히 깨져 있다.
//              **자동 해제하지 않는다.** 여기서 자동 해제를 넣으면 오늘 잡은 무음실패가 그대로 다시 숨는다.
import { create } from 'zustand';

/** 서버가 응답을 준 실패인가(server), 서버에 닿지도 못했나(offline). */
export type ReadFailKind = 'offline' | 'server';
type ReadFail = { kind: ReadFailKind; msg: string };

type SyncState = {
  /** 쓰기 실패 문구(사건 — 자동 소거). */
  error: string | null;
  /** 오류 발생 시퀀스 — 같은 문구가 연달아 와도 배너 자동소거 타이머가 리셋되도록 구분자 역할. */
  seq: number;
  /** 읽기 실패(상태 — 자동 소거 없음). 종류에 따라 해제 조건이 다르다. */
  readError: ReadFail | null;
  noteError: (msg?: string) => void;
  /** 읽기 실패. 판정 SSOT 는 db.ts readFail 하나이고, 화면이 개별로 부르지 않는다. */
  noteReadFail: (error?: unknown) => void;
  /** 서버 왕복이 성공했다(또는 online 이벤트) — **연결 축만** 해제한다. */
  clearOffline: () => void;
  /** 사용자가 배너를 닫았다 — 종류와 무관하게 지운다. */
  clearRead: () => void;
  clear: () => void;
};

const DEFAULT_MSG = '저장이 서버에 반영되지 못했어요. 인터넷 연결을 확인해 주세요.';
// 연결 실패는 "무엇을 못 불러왔는지"보다 **무엇을 하면 되는지**를 앞에 둔다.
export const OFFLINE_MSG = '인터넷 연결을 확인해 주세요. 지금 보이는 정보가 전부가 아닐 수 있어요.';
// 서버 쪽 실패는 사용자가 할 수 있는 게 없다 — 연결 탓으로 돌리지 말고 **화면을 믿지 말라**고만 말한다.
export const SERVER_FAIL_MSG = '일부 정보를 불러오지 못했어요. 지금 보이는 정보가 전부가 아닐 수 있어요.';

// PostgREST/Supabase 는 서버가 응답한 실패에 code 를 채운다('42703'·'PGRST116'·'PGRST301'…).
// 서버에 닿지 못한 실패(fetch 자체 실패)는 code 없이 message 만 들어온다('TypeError: Failed to fetch').
// 그래서 code 유무가 곧 "응답을 받았나"다 — 이 판정은 여기 한 곳에만 둔다.
function kindOf(error: unknown): ReadFailKind {
  return (error as { code?: string } | null | undefined)?.code ? 'server' : 'offline';
}

export const useSyncStore = create<SyncState>((set) => ({
  error: null,
  seq: 0,
  readError: null,
  noteError: (msg) => set((s) => ({ error: msg ?? DEFAULT_MSG, seq: s.seq + 1 })),
  // 같은 종류면 상태를 다시 쓰지 않는다 — 읽기 실패는 여러 fetch 에서 동시에 쏟아지므로
  // 매번 set 하면 배너가 계속 리렌더된다(자동 소거가 없어 타이머 리셋 목적의 seq 도 필요 없다).
  // 종류가 바뀌면 덮어쓴다: 마지막 왕복이 말해주는 게 지금 상태다.
  noteReadFail: (error) =>
    set((s) => {
      const kind = kindOf(error);
      if (s.readError?.kind === kind) return s;
      return { readError: { kind, msg: kind === 'server' ? SERVER_FAIL_MSG : OFFLINE_MSG } };
    }),
  clearOffline: () => set((s) => (s.readError?.kind === 'offline' ? { readError: null } : s)),
  clearRead: () => set((s) => (s.readError === null ? s : { readError: null })),
  clear: () => set({ error: null }),
}));

/**
 * 스토어 액션에서 쓰기 결과(boolean Promise)를 받아, 실패면 롤백 콜백 실행 + 배너 표시.
 * 성공/실패(ok)를 반환한다 — 호출부가 "저장이 실제로 됐을 때만" 성공 UI(토스트·네비)를 띄우도록.
 * (기존 `void guardWrite(...)` 호출부는 반환값을 무시하므로 하위호환.)
 */
export async function guardWrite(
  result: Promise<boolean>,
  onFail: () => void,
  msg?: string,
): Promise<boolean> {
  let ok = false;
  try {
    ok = await result;
  } catch {
    ok = false;
  }
  if (!ok) {
    onFail();
    useSyncStore.getState().noteError(msg);
  }
  // 성공 시 연결 축 해제는 여기서 하지 않는다 — "서버 왕복이 성공했다"는 판정은
  // supabase.ts 의 fetch 래퍼 한 곳에만 있다(읽기·쓰기·엣지 함수가 전부 그리로 지나간다).
  return ok;
}
