// 전역 동기화 상태 — 서버 쓰기 실패를 사용자에게 한 곳에서 알린다.
// 각 스토어는 낙관적 업데이트가 서버에 반영되지 못하면 noteError()를 호출하고,
// 화면 상단의 SyncBanner가 이를 표시한다. (조용한 데이터 유실 방지)
import { create } from 'zustand';

type SyncState = {
  error: string | null;
  noteError: (msg?: string) => void;
  clear: () => void;
};

const DEFAULT_MSG = '저장이 서버에 반영되지 못했어요. 인터넷 연결을 확인해 주세요.';

export const useSyncStore = create<SyncState>((set) => ({
  error: null,
  noteError: (msg) => set({ error: msg ?? DEFAULT_MSG }),
  clear: () => set({ error: null }),
}));

/** 스토어 액션에서 쓰기 결과(boolean Promise)를 받아, 실패면 롤백 콜백 실행 + 배너 표시. */
export async function guardWrite(
  result: Promise<boolean>,
  onFail: () => void,
  msg?: string,
): Promise<void> {
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
}
