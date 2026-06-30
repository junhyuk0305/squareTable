// 낙관적 리스트 CRUD 공통 헬퍼 — 스토어 9곳에 복붙되던 "낙관적 갱신 → guardWrite → 실패 시 롤백"
// 3패턴(추가/부분수정/삭제)을 일반화한다. useUnknownQueueStore.transition()의 검증된 패턴을 확장.
//
// 설계 메모:
// - 대상이 없으면(id 미존재) 조기 반환 — transition() 프로토타입과 동일. 존재하지 않는 행에 DB write를
//   쏘지 않으므로 기존 "no-op set + 헛쓰기"보다 안전(의미 보존 + 약간 개선).
// - DB 호출은 thunk(() => Promise<boolean>)로 받아 낙관적 set 이후에 시작 — 기존 호출 순서와 동일.
// - guardWrite가 실패를 감지하면 롤백 콜백 실행 + SyncBanner 표시.
import { guardWrite } from '@/lib/store/useSyncStore';

type WithId = { id: string };
type Setter<S> = (fn: (s: S) => Partial<S>) => void;
type Getter<S> = () => S;

/** 낙관적 추가 + 실패 시 제거 롤백. at='end'(기본) | 'start'(맨 앞). */
export function optimisticAdd<S, T extends WithId>(
  set: Setter<S>,
  key: keyof S,
  item: T,
  db: () => Promise<boolean>,
  failMsg: string,
  at: 'start' | 'end' = 'end',
): void {
  set((s) => {
    const arr = s[key] as unknown as T[];
    return { [key]: at === 'start' ? [item, ...arr] : [...arr, item] } as unknown as Partial<S>;
  });
  void guardWrite(
    db(),
    () => set((s) => ({ [key]: (s[key] as unknown as T[]).filter((x) => x.id !== item.id) } as unknown as Partial<S>)),
    failMsg,
  );
}

/** 낙관적 부분수정 + 실패 시 이전값 복원. 대상 없으면 no-op. */
export function optimisticPatch<S>(
  set: Setter<S>,
  get: Getter<S>,
  key: keyof S,
  id: string,
  patch: Record<string, unknown>,
  db: () => Promise<boolean>,
  failMsg: string,
): void {
  const before = (get()[key] as unknown as WithId[]).find((x) => x.id === id);
  if (!before) return;
  set((s) => ({ [key]: (s[key] as unknown as WithId[]).map((x) => (x.id === id ? { ...x, ...patch } : x)) } as unknown as Partial<S>));
  void guardWrite(
    db(),
    () => set((s) => ({ [key]: (s[key] as unknown as WithId[]).map((x) => (x.id === id ? before : x)) } as unknown as Partial<S>)),
    failMsg,
  );
}

/** 낙관적 삭제 + 실패 시 원위치 복원(인덱스 보존). 대상 없으면 no-op. */
export function optimisticRemove<S>(
  set: Setter<S>,
  get: Getter<S>,
  key: keyof S,
  id: string,
  db: () => Promise<boolean>,
  failMsg: string,
): void {
  const arr = get()[key] as unknown as WithId[];
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const removed = arr[idx];
  set((s) => ({ [key]: (s[key] as unknown as WithId[]).filter((x) => x.id !== id) } as unknown as Partial<S>));
  void guardWrite(
    db(),
    () =>
      set((s) => {
        const next = (s[key] as unknown as WithId[]).slice();
        next.splice(Math.min(idx, next.length), 0, removed);
        return { [key]: next } as unknown as Partial<S>;
      }),
    failMsg,
  );
}
