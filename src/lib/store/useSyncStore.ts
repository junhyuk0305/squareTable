// 전역 동기화 상태 — 서버와의 통신 실패를 사용자에게 **한 곳에서** 알린다.
//
// 축이 둘이고 성격이 다르다. 섞으면 한쪽이 다른 쪽을 덮어써서 둘 다 못 쓰게 된다.
//
//   ① 쓰기 실패(error)      "저장이 안 됐다" — 사건이다. 이미 롤백됐고 사용자는 다시 누르면 된다.
//                           → 3초 뒤 자동 소거(SyncBanner). 기존 동작 그대로.
//   ② 읽기 실패(readError)  "지금 보이는 게 전부가 아니다" — 상태다. 연결이 돌아올 때까지 계속 참이다.
//                           → **자동 소거하지 않는다.** 연결 복구(online) 또는 사용자가 닫을 때만 사라진다.
//
// ★왜 갈랐나 (2026-08-11 실측 QA · [P2-#3]·[P5-#5]·기존-14)
//   예전엔 읽기 실패도 noteError 로 들어가 **3초 뒤 사라졌다.** 그래서
//   "백엔드가 죽었는데 화면은 '아직 등록된 노하우가 없어요'" 상태가 **아무 표시 없이** 유지됐다.
//   배너가 없던 게 아니라, 있다가 사라진 뒤가 문제였다. 읽기 실패는 사건이 아니라 상태다.
import { create } from 'zustand';

type SyncState = {
  /** 쓰기 실패 문구(사건 — 자동 소거). */
  error: string | null;
  /** 오류 발생 시퀀스 — 같은 문구가 연달아 와도 배너 자동소거 타이머가 리셋되도록 구분자 역할. */
  seq: number;
  /** 읽기 실패 문구(상태 — 자동 소거 없음). */
  readError: string | null;
  noteError: (msg?: string) => void;
  /** 읽기 실패. 판정 SSOT 는 db.ts readFail 하나이고, 화면이 개별로 부르지 않는다. */
  noteReadFail: (msg?: string) => void;
  /** 연결이 돌아왔거나 사용자가 닫았다. */
  clearRead: () => void;
  clear: () => void;
};

const DEFAULT_MSG = '저장이 서버에 반영되지 못했어요. 인터넷 연결을 확인해 주세요.';
// 읽기 실패는 "무엇을 못 불러왔는지"보다 **무엇을 하면 되는지**를 앞에 둔다.
export const READ_FAIL_MSG = '인터넷 연결을 확인해 주세요. 지금 보이는 정보가 전부가 아닐 수 있어요.';

export const useSyncStore = create<SyncState>((set) => ({
  error: null,
  seq: 0,
  readError: null,
  noteError: (msg) => set((s) => ({ error: msg ?? DEFAULT_MSG, seq: s.seq + 1 })),
  // 같은 문구면 상태를 다시 쓰지 않는다 — 읽기 실패는 여러 fetch 에서 동시에 쏟아지므로
  // 매번 set 하면 배너가 계속 리렌더된다(자동 소거가 없어 타이머 리셋 목적의 seq 도 필요 없다).
  noteReadFail: (msg) =>
    set((s) => (s.readError === (msg ?? READ_FAIL_MSG) ? s : { readError: msg ?? READ_FAIL_MSG })),
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
  } else {
    // 쓰기가 성공했다 = 서버까지 닿았다. 읽기 실패 상태를 계속 들고 있을 이유가 없다.
    useSyncStore.getState().clearRead();
  }
  return ok;
}
