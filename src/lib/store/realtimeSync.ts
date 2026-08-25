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

/**
 * 정해진 시간 안에 **반드시 끝나게** 만든다 — `loaded` 계약의 마지막 조각.
 *
 * ★왜 필요한가(2026-08-26 브라우저 실측):
 *   `loaded = "시도가 끝났다"` 로 계약을 통일하고 실패 경로·예외 경로를 다 막아도,
 *   **fetch 가 영영 settle 되지 않으면** 그 계약이 성립하지 않는다. 백엔드가 통째로 끊긴 상태에서
 *   supabase 클라이언트가 토큰 갱신을 기다리며 매달리면 `Promise.all` 이 resolve 도 reject 도
 *   하지 않고, hydrate 가 끝나지 않아 게이트가 **영구 스피너**가 된다(업무·노하우 목록에서 실제로 재현).
 *   실패(에러 반환)와 예외(throw)는 막았는데 **정지(hang)** 는 안 막혀 있었다.
 *
 *   타임아웃은 "느린 연결을 실패로 단정하는 것" 아닌가? — 그래서 넉넉히 준다(기본 15초).
 *   그 시간을 넘겼는데도 화면이 스피너인 것보다, "못 불러왔어요 · 다시 시도"가 사용자에게 낫다.
 *   재시도 버튼이 있으므로 되돌릴 수 있는 판정이다.
 */
export function settleWithin<T>(ms: number, work: Promise<T>, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn(`[hydrate] ${ms}ms 안에 끝나지 않아 실패로 처리한다(정지 방지)`);
      resolve(onTimeout());
    }, ms);
    work.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(timer); console.warn('[hydrate] 실패:', e); resolve(onTimeout()); } },
    );
  });
}

/** hydrate 정지 방지 기본 시간 — 느린 3G 왕복(여러 쿼리 병렬)을 넉넉히 덮는 값. */
export const HYDRATE_TIMEOUT_MS = 15_000;
