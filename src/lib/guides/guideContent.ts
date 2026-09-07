// 사용 안내 팝업 가이드의 **문구 정본**. 화면 코드는 id 만 알고, 문장은 전부 여기 모은다.
// (화면마다 문장을 흩어 두면 말투가 갈라진다 — 워딩 표준을 한 곳에서 지키기 위한 배치다.)
//
// 규격: 1개 가이드 = 2~3장. 장당 제목 1줄 + 본문 2줄. 아이콘·일러스트 없음.
// 문장은 기능 설명이 아니라 **결과**로 쓴다("~할 수 있어요" ✗ → "~하면 ~돼요" ✓).

export type GuidePage = {
  title: string;
  body: string;
};

export type Guide = {
  pages: GuidePage[];
  /** 마지막 장 버튼 라벨(기본 '시작하기'). */
  ctaLabel?: string;
};

/** 가이드 id — '본 적 있음'은 useTourStore 의 seen 과 같은 네임스페이스를 쓴다(코치마크 owner_home_v1 과 나란히). */
export type GuideId =
  | 'owner_knowhow_v1'
  | 'owner_quiz_v1'
  | 'owner_schedule_v1'
  | 'owner_payroll_v1'
  | 'junior_home_v1'
  | 'junior_work_v1';

export const GUIDES: Record<GuideId, Guide> = {
  junior_home_v1: {
    pages: [
      {
        title: '오늘 할 일이 여기 떠요',
        body: '출근하면 오늘 뭘 해야 하는지 이 화면에 나와요. 다 한 건 눌러서 체크하면 돼요.',
      },
      {
        title: '모르면 물어보세요',
        body: '아래 ‘업무’에서 물으면 사장님이 알려준 답이 바로 나와요. 사장님을 부르지 않아도 돼요.',
      },
      {
        title: '근무·출퇴근은 아래 탭에서',
        body: '내 근무표와 출퇴근 기록은 아래 칸에서 언제든 볼 수 있어요.',
      },
    ],
  },
  junior_work_v1: {
    pages: [
      {
        title: '여기서 물어보면 답이 나와요',
        body: '사장님이 미리 알려준 내용이면 바로 답해줘요. 없으면 사장님한테 질문이 전달돼요.',
      },
      {
        title: '공지와 할 일도 여기 있어요',
        body: '오른쪽 위에서 매장 공지와 오늘 할 일을 볼 수 있어요.',
      },
    ],
  },
  owner_knowhow_v1: {
    pages: [
      {
        title: '노하우 하나 = 직원 질문 하나',
        body: '여기 적어두면 직원이 물었을 때 사장님 대신 답이 나가요.',
      },
      {
        title: '‘할 일’부터 보세요',
        body: '직원이 물었는데 답이 없던 것들이 ‘할 일’에 모여요. 거기부터 채우면 빠져요.',
      },
    ],
  },
  owner_quiz_v1: {
    pages: [
      {
        title: '노하우로 문제가 만들어져요',
        body: '적어둔 노하우에서 문제를 뽑아 직원이 아는지 확인해요.',
      },
      {
        title: '링크로 보내면 끝',
        body: '앱을 안 깐 직원도 링크로 풀 수 있어요. 결과는 여기로 돌아와요.',
      },
    ],
  },
  owner_schedule_v1: {
    pages: [
      {
        title: '여기가 급여의 기준이에요',
        body: '근무표에 찍힌 시간으로 급여가 계산돼요. 여기서 고치면 급여도 같이 바뀌어요.',
      },
      {
        title: '교대 요청은 승인만 하면 돼요',
        body: '직원이 바꿔달라고 하면 위에 뜨고, 승인하면 근무표에 바로 반영돼요.',
      },
    ],
  },
  owner_payroll_v1: {
    pages: [
      {
        title: '켠 항목만 계산에 들어가요',
        body: '야간·주휴 같은 수당은 켜두면 자동으로 반영돼요. 따로 더 챙겨줄 필요 없어요.',
      },
      {
        title: '금액은 근무표에서 정해져요',
        body: '이 화면은 규칙만 정하는 곳이에요. 실제 일한 시간은 근무표를 따라가요.',
      },
    ],
  },
};

/** 역할별 가이드 id — 설정의 '사용 안내 다시 보기'가 지울 대상. */
export const GUIDE_IDS_BY_ROLE: Record<'owner' | 'junior', readonly string[]> = {
  // 사장 홈의 스포트라이트 투어(owner_home_v1)도 함께 되살린다 — 사장이 보기엔 같은 '사용 안내'다.
  owner: ['owner_home_v1', 'owner_knowhow_v1', 'owner_quiz_v1', 'owner_schedule_v1', 'owner_payroll_v1'],
  junior: ['junior_home_v1', 'junior_work_v1'],
};
