/**
 * 퀴즈 화면 판정(화면조립표 2026-11-17 11절 1·2·3·4번). 화면에 흩지 않고 여기 한 곳에 둔다.
 * 순수 함수다. 다른 모듈을 부르지 않는다. 검사 = scripts/qa-quiz-screen-plans.mjs.
 */

/**
 * 퀴즈 탭(/owner/training)의 만들기 입구(11절 1·2번). 노란 버튼 = 새 퀴즈 만들기 하나.
 * - 퀴즈가 1개 이상이고 낼 노하우가 있으면 오른쪽 아래 떠 있는 노란 알약(글자 붙음).
 * - 퀴즈가 0개면 떠 있는 버튼을 그리지 않는다. 빈 상태 카드의 노란 버튼이 같은 일을 한다.
 * - 낼 노하우가 0개면 퀴즈를 만들 수 없다. 빈 상태의 노란 버튼은 노하우 추가로 간다.
 */
export function trainingMakeEntry(v: { quizzes: number; usable: number }): 'fab' | 'card' | 'knowhow' {
  if (v.usable === 0) return 'knowhow';
  return v.quizzes > 0 ? 'fab' : 'card';
}

/** 퀴즈 만들기(/owner/quiz-new) 단계. 1~5 = 단계, 6 = 링크를 만든 뒤(외부용 결과 화면). */
export type QuizNewStep = 1 | 2 | 3 | 4 | 5 | 6;

export type QuizNewDock =
  | { kind: 'go'; to: QuizNewStep; label: string; disabled: boolean }
  | { kind: 'make'; label: string; disabled: boolean }
  | { kind: 'publish'; label: string; disabled: boolean }
  | { kind: 'copy' };

/**
 * 맨 아래 고정 노란 버튼 하나(11절 3번). 이름 = 다음 단계 이름. "다음"·"확인"·"완료"를 쓰지 않는다.
 * - 3단계(문제를 만드는 중)는 버튼이 없다. 만들기가 끝나면 4단계로 저절로 간다.
 * - 4단계에서 문항이 0개면 보낼 수 없다(서버 quiz_no_items). 노하우 고르기로 돌아간다.
 * - 6 = 링크를 만든 뒤. 주 버튼 = 링크 복사(1차 추천대로 · 교육 링크 만들기와 같다). 이름은 화면이 COPY_LINK_LABEL 로 단다.
 */
export function quizNewDock(v: {
  step: QuizNewStep;
  audience: 'staff' | 'guest';
  picked: number;
  okItems: number;
  to: number;
  sendNow: boolean;
  busy: boolean;
  /** 1단계를 그릴 재료(노하우·퀴즈 판)가 다 왔는가. 안 왔으면 1단계 버튼을 누를 수 없다. */
  ready: boolean;
  /** 예약 시각 형식이 맞나(0931). 없으면 맞다고 본다. 예약인데 틀리면 예약 버튼을 막는다. */
  timeOk?: boolean;
}): QuizNewDock | null {
  const guest = v.audience === 'guest';
  switch (v.step) {
    case 1:
      return { kind: 'go', to: 2, label: '노하우 고르기', disabled: !v.ready };
    case 2:
      return { kind: 'make', label: v.picked > 0 ? `${v.picked}개로 문제 만들기` : '노하우를 골라 주세요', disabled: v.busy || v.picked === 0 };
    case 3:
      return null;
    case 4:
      return v.okItems === 0
        ? { kind: 'go', to: 2, label: '노하우 다시 고르기', disabled: false }
        : { kind: 'go', to: 5, label: guest ? '링크 기간 정하기' : '받는 사람 고르기', disabled: false };
    case 5: {
      const label = v.busy
        ? guest ? '링크 만드는 중…' : '보내는 중…'
        : guest ? '링크 만들기' : v.sendNow ? `${v.to}명에게 보내기` : `${v.to}명에게 예약하기`;
      return { kind: 'publish', label, disabled: v.busy || (!guest && v.to === 0) || (!guest && !v.sendNow && v.timeOk === false) };
    }
    case 6:
      return { kind: 'copy' };
  }
}

/**
 * 머리의 뒤로(안드 뒤로도 같다). null = 화면을 나간다.
 * - 첫 단계에서만 나간다(11절 3번 보충).
 * - 3단계는 만드는 중이라 앞 단계로 돌리면 만들기가 끝난 뒤 4단계로 튄다. 그래서 나간다(만든 문항은 초안으로 남는다).
 * - 4단계의 앞은 2단계다. 3단계는 저절로 지나가는 진행 화면이라 돌아갈 자리가 아니다.
 * - 6(링크를 만든 뒤)은 이미 보냈다. 5단계로 돌리면 링크를 한 번 더 만들 수 있어 나간다.
 */
export function quizNewBack(step: QuizNewStep): QuizNewStep | null {
  switch (step) {
    case 2: return 1;
    case 4: return 2;
    case 5: return 4;
    default: return null;
  }
}

/**
 * 링크로 퀴즈 풀기(/q/[token])의 문항 넘김. at = 지금 문항 순서(0부터).
 * - 주 버튼 이름 = 다음 문항 이름("n번 문제"). 마지막 문항은 "제출하기". 하나도 안 풀었으면 낼 수 없다.
 * - 뒤로 = 앞 문항. 첫 문항에서는 null(문항 안에서 갈 앞이 없다).
 */
export function linkQuizNav(at: number, total: number, unanswered: number): {
  primary: { kind: 'go'; to: number; label: string } | { kind: 'submit'; label: string; disabled: boolean };
  back: number | null;
} {
  const last = at >= total - 1;
  return {
    primary: last
      ? { kind: 'submit', label: '제출하기', disabled: unanswered >= total }
      : { kind: 'go', to: at + 1, label: `${at + 2}번 문제` },
    back: at > 0 ? at - 1 : null,
  };
}

/** 퀴즈 상세(/owner/quiz/[id]) 맨 위 칸 고르기 = [결과 | 문항 | 설정](11절 4번). ?tab= 의 모르는 값은 결과다. */
export type QuizDetailSeg = 'people' | 'items' | 'settings';
export function quizDetailSeg(tab: string | undefined): QuizDetailSeg {
  return tab === 'settings' ? 'settings' : tab === 'items' ? 'items' : 'people';
}

/**
 * 결과 칸 맨 위의 처리할 것(11절 4번) = 아직 안 푼 사람에게 다시 알리기(노랑).
 * 대상 수는 상세 화면의 notDone(지금 직원 · 한 번도 다 풀지 않음 · 최신 발송 미완료)이다. 0명이면 버튼이 없다.
 */
export function quizResultTop(notDone: number): { resendLabel: string } | null {
  return notDone > 0 ? { resendLabel: `아직 안 푼 ${notDone}명에게 다시 알리기` } : null;
}
