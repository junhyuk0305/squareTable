// 화면 안 뒤로가기 가로채기 스택(LIFO · J13). 순수 모듈 — 등록은 useBackIntercept 가 한다.
// 업무 채팅 패널·매뉴얼 올리기 2단계처럼 "한 화면 안의 앞 단계"가 있는 곳에서, 안드 뒤로가 화면을 떠나기 전에 먼저 받는다.

const stack: { fn: () => void }[] = [];

/** 등록하고, 빼는 함수를 돌려준다. 나중에 등록한 것이 먼저 받는다. */
export function pushBackIntercept(fn: () => void): () => void {
  const entry = { fn };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 맨 위 것을 부르고 true. 비어 있으면 false(규칙표로 넘어간다). */
export function runBackIntercept(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.fn();
  return true;
}
