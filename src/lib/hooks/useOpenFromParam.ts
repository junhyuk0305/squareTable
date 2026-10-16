// useOpenFromParam — "주소의 id 파라미터로 그 항목을 연다"의 공용 훅(2026-10-16 P1 역 ⑤).
//   WorkBoard(?quiz=) · NoticePanel(?feed=) · WorkChat(?feed=) · 명부(?member=) 가 같은 모양을 쓴다.
//   같은 값으로는 한 번만 연다(사용자가 스크롤한 걸 되돌리지 않는다). 값이 바뀌면 다시 연다(알림을 또 누른 경우).
//   setState-in-effect 대신 "이전 값과 비교해 렌더 중 조정"(React 권장 · WorkBoard ?view= 패턴).
import { useState } from 'react';

/** [아직 열지 않은 id, 열었다고 표시하는 함수]. 열 대상이 생기는 순간 호출부가 한 번 열고 done() 한다. */
export function useOpenFromParam(param: string | undefined): [string | null, () => void] {
  const [pending, setPending] = useState<string | null>(param ?? null);
  const [prev, setPrev] = useState(param);
  if (param !== prev) {
    setPrev(param);
    setPending(param ?? null);
  }
  return [pending, () => setPending(null)];
}
