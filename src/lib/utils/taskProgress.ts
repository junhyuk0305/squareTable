/**
 * 업무 진도 파생 — "이 직원이 아직 통과 못 한 업무"를 사장 홈과 직원 목록이 **같은 말로** 하게 하는 곳.
 *
 * 판정 본체는 `useWorkStore`의 `understandsTask`(파생 규칙 SSOT)다. 여기는 그 위에
 * "어떤 업무가 판정 대상인가"라는 게이트 하나만 얹는다 — 그 게이트를 두 화면이 각자 쓰면
 * 한쪽은 "다 했음", 다른 쪽은 "하나도 안 했음"이 된다.
 *
 * ★ 게이트가 왜 필요한가: 노하우가 안 붙은 업무는 `understandsTask`가 전원 false를 돌려준다
 *   (`staffWhoUnderstandTask`가 빈 배열). "아무도 모름"이 아니라 "잴 수 없음"인데 구분이 안 된다.
 *   문항이 0개인 업무도 마찬가지 — 직원에게 나가지도 않은 걸 "안 했다"고 말할 수 없다.
 *
 * ★ 표기 규칙: 결과를 화면에 쓸 때 점수(`0/7`)로 쓰지 않는다. 숫자로 쓰면 직원 줄세우기이고
 *   업무 이름으로 쓰면 진도다(감시원칙 D1~D5). 그래서 `firstTask`(업무 이름)를 같이 돌려준다.
 */
import {
  knowhowIdsForTask,
  quizCountForTask,
  understandsTask,
  type KnowhowLink,
  type UnderstandingRow,
} from '@/lib/store/useWorkStore';

/** 이 파생에 필요한 업무의 최소 형태 — 스토어 타입 전체를 끌고 오지 않는다. */
type GradableTask = { id: string; text: string; hidden?: boolean };

export type StaffBehind = {
  staffId: string;
  name: string;
  /** 아직 통과 못 한 업무 중 첫 번째 이름 — 화면에는 이걸 쓴다. */
  firstTask: string;
  /** 아직 통과 못 한 업무 총 개수(firstTask 포함). */
  total: number;
};

/**
 * 진도를 잴 수 있는 업무만 남긴다 — 노하우가 1개 이상 붙었고, 실제로 낼 문항이 1개 이상 있는 것.
 * (숨긴 업무·합성 루틴은 노하우 연결이 없어 자동으로 빠진다.)
 */
export function gradableTasks<T extends GradableTask>(
  templates: T[],
  links: KnowhowLink[],
  quizCounts: Record<string, number>,
): T[] {
  return templates.filter(
    (t) =>
      !t.hidden &&
      knowhowIdsForTask(links, t.id).length > 0 &&
      quizCountForTask(quizCounts, links, t.id) > 0,
  );
}

/**
 * 아직 통과 못 한 업무가 있는 직원만 — 많이 밀린 사람이 앞에 온다.
 *
 * 재확인 주기(dueDays)는 코스 속성이라 여기서는 넘기지 않는다(업무에는 소속 코스가 없다).
 * 주기가 다른 코스의 통과 기록을 한 잣대로 재면 어느 쪽도 맞지 않는다.
 */
export function staffBehind(
  staff: { id: string; name: string }[],
  gradable: GradableTask[],
  understanding: UnderstandingRow[],
  links: KnowhowLink[],
): StaffBehind[] {
  return staff
    .map((p) => {
      const undone = gradable.filter((t) => !understandsTask(understanding, links, t.id, p.id));
      return undone.length > 0
        ? { staffId: p.id, name: p.name, firstTask: undone[0].text, total: undone.length }
        : null;
    })
    .filter((x): x is StaffBehind => x !== null)
    .sort((a, b) => b.total - a.total);
}
