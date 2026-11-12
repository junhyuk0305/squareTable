import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { todayStr } from '@/lib/utils/attendance';

/**
 * 오늘(KST) "YYYY-MM-DD". 날짜가 바뀌면 다시 그린다.
 *
 * ★화면·훅 몸통에서 todayStr() 를 바로 부르지 않는다(React Compiler · 2026-11-12 S6).
 *   컴파일러는 인자 없는 호출을 의존성 없는 값으로 보고 첫 렌더 값을 캐시에 묶는다
 *   (번들에서 `memo_cache_sentinel` 블록 안에 todayStr() 가 들어간 것을 확인했다).
 *   그러면 앱을 켜 둔 채 자정을 넘기면 다시 그려도 어제를 오늘로 센다.
 * 1분마다, 그리고 앱이 앞으로 올 때 다시 잰다. 날짜가 같으면 같은 값을 돌려줘 React 가 다시 그리지 않는다.
 */
function useDayStamp(): { day: string; at: number } {
  const [stamp, setStamp] = useState(() => ({ day: todayStr(), at: Date.now() }));
  useEffect(() => {
    const tick = () =>
      setStamp((p) => {
        const day = todayStr();
        return day === p.day ? p : { day, at: Date.now() };
      });
    const id = setInterval(tick, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return stamp;
}

export function useToday(): string {
  return useDayStamp().day;
}

/**
 * 판정 기준 시각(ms) — 마운트 때 한 번 재고, 날짜(KST)가 바뀌면 다시 잰다(2026-11-13 A-1).
 * 렌더 중 Date.now() 를 부르지 않는 화면이 "마운트 1회"에 묶여 자정을 넘기면 어제 기준으로 판정하던 자리에 쓴다.
 */
export function useDayNow(): number {
  return useDayStamp().at;
}
