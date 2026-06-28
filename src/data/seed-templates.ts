import type { Category } from '@/types';

/**
 * 콜드스타트 방어용 업종 씨앗 템플릿 (요식업/카페).
 * 전략업데이트_2026-06-22 §2: "빈 챗봇으로 파일럿 사망 방지" — 새 매장이 0건에서
 * 시작하지 않도록, 사장 발화체 초안을 미리 제공한다. 사장은 탭 → AI 정리 → 수정·발행.
 * (멘토 가설 "못하는 사장이 씨앗을 수정은 할 수 있는가" 검증용)
 *
 * draft 는 대화형 입력(owner/coach)에 그대로 프리필되어 AI 가 SQUARE 로 정형화한다.
 */
export type SeedTemplate = {
  id: string;
  category: Category;
  title: string; // 칩에 보일 짧은 제목
  draft: string; // owner/coach 에 프리필될 사장 발화체 초안
};

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    id: 'seed_open',
    category: 'Routine',
    title: '오픈 준비 순서',
    draft:
      '오픈하면 제일 먼저 간판이랑 조명 켜고, 에스프레소 머신 전원 넣고 10분 예열해. 그동안 우유랑 시럽 채워두고, 포스기 켜서 시재 5만원 맞는지 확인해. 화장실 휴지랑 비누도 체크하고.',
  },
  {
    id: 'seed_close',
    category: 'Routine',
    title: '마감 청소·정산',
    draft:
      '마감은 머신 그룹헤드 청소하고 약품으로 백플러시 돌려. 우유 거품기랑 스팀 노즐 꼭 닦고. 바닥 쓸고 닦은 다음에 포스에서 마감 정산 눌러서 현금이랑 카드 맞는지 보고, 시재 5만원만 남기고 나머지는 금고에 넣어.',
  },
  {
    id: 'seed_hair',
    category: 'Event',
    title: '이물질 클레임 응대',
    draft:
      '음료나 디저트에서 머리카락 같은 이물질 나왔다고 하면 일단 진심으로 사과부터 하고 바로 새로 만들어드려. 환불 원하시면 환불해드리고. 절대 손님 탓하거나 변명하지 마. 나한테도 바로 알려줘.',
  },
  {
    id: 'seed_refund',
    category: 'Context',
    title: '환불·교환 기준',
    draft:
      '제조 음료는 한 모금이라도 드셨으면 환불 안 되지만, 우리 실수로 잘못 나간 건 무조건 새로 해드리거나 환불해. 미개봉 원두나 굿즈는 영수증 있으면 7일 안에 교환 가능. 애매하면 손님 편의 봐드리는 쪽으로.',
  },
  {
    id: 'seed_pack',
    category: 'Know-how',
    title: '포장 빠르게 싸는 법',
    draft:
      '포장 주문 들어오면 뜨거운 거랑 찬 거 봉투 따로 담고, 음료는 캐리어에 꽂아. 뚜껑은 꽉 눌러서 닫고 빨대랑 냅킨은 봉투 안쪽에. 영수증에 포장 표시해서 픽업대에 올려두면 헷갈리지 않아.',
  },
];
