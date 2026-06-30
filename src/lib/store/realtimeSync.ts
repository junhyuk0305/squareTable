/**
 * realtime 구독 → 전체 재조회(hydrate) 공통 배선.
 *
 * 문제: 쓰기 1건이 여러 테이블/이벤트로 에코되면 이벤트마다 풀 hydrate가 돈다.
 *       (예: 할일 체크 1번 = work_done+work_feed 2쓰기 → 2이벤트 → 매번 3쿼리 재조회 + 전체 리렌더.)
 *       빠른 연속 작업(체크 연타·출퇴근 다회·교대요청 등)에선 이게 폭주해 UI가 입력을 못 따라가
 *       밀리고, 서버 스냅샷이 낙관적 상태를 잠깐 덮어써 깜빡인다.
 *
 * 해결 두 겹:
 *   1) coalesce — hydrate 동시 호출 합치기. 이미 돌고 있으면 새 fetch를 또 띄우지 않고
 *      '한 번 더' 플래그만 세워, 끝나고 1회만 더 돈다(병렬 풀 fetch 차단).
 *   2) subscribeDebounced — realtime 이벤트 버스트를 트레일링 디바운스로 1회 재조회에 합친다.
 *      마운트 시의 명시적 hydrate() 호출은 디바운스를 타지 않으니 첫 로딩은 즉시다.
 */

/** 동시 호출 합치기: 진행 중이면 재실행만 예약하고 진행 중 Promise를 돌려준다. */
export function coalesce(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let again = false;
  return () => {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        again = false;
        await run();
      } while (again);
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/** subscribeFn(onChange) 를 트레일링 디바운스(기본 300ms)로 감싸 구독한다. */
export function subscribeDebounced(
  subscribeFn: (onChange: () => void) => () => void,
  onChange: () => void,
  ms = 300,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = subscribeFn(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, ms);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
