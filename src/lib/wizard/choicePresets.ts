/**
 * 등록 위저드 객관식 보기 — 업종별 프리셋.
 *
 * 기존엔 각 Flow 컴포넌트에 보기가 하드코딩돼 어떤 가게·주제든 똑같은 4개가 떴다.
 * 여기로 데이터를 모아 업종(industry)별로 보기를 다르게 주고, 새 업종 추가도 이 파일만 수정.
 * 매칭 업종이 없으면 'default'(범용)로 폴백한다. 보기 외 '직접 입력'은 ChoiceStep이 항상 덧붙인다.
 */
import contextPack from '@/data/context-pack.json';

export type ChoiceOption = { v: string; icon: string; hint?: string };

export type WizardStepKey =
  | 'timing'
  | 'frequency'
  | 'missedPart'
  | 'firstAction'
  | 'forbidden'
  | 'report'
  | 'location'
  | 'criterion';

type Industry = 'fnb' | 'retail' | 'beauty' | 'default';

/** step별 보기: 업종 키 → 보기 배열. 'default'는 필수(폴백). */
type StepPresets = Partial<Record<Industry, ChoiceOption[]>> & { default: ChoiceOption[] };

const PRESETS: Record<WizardStepKey, StepPresets> = {
  // ── 루틴(반복 업무) ──────────────────────────────
  timing: {
    default: [
      { v: '업무 시작 직후', icon: '🌅', hint: '문 열고 가장 먼저' },
      { v: '중간 시간', icon: '☀', hint: '한가/바쁜 중간' },
      { v: '마감 후', icon: '🌙', hint: '영업 종료 후' },
      { v: '그때그때', icon: '🔄', hint: '상황 따라 다름' },
    ],
    fnb: [
      { v: '오픈 직후', icon: '🌅', hint: '아침 오픈 1시간 안' },
      { v: '미들 시간', icon: '☀', hint: '피크/한가한 중간' },
      { v: '마감 후', icon: '🌙', hint: '영업 종료 후' },
      { v: '그때그때', icon: '🔄', hint: '상황 따라 다름' },
    ],
    retail: [
      { v: '개점 준비', icon: '🌅', hint: '오픈 진열·정리' },
      { v: '영업 중', icon: '☀', hint: '응대 사이사이' },
      { v: '마감 정산', icon: '🌙', hint: '마감 후 정리' },
      { v: '입고 때', icon: '📦', hint: '물건 들어올 때' },
    ],
  },
  frequency: {
    default: [
      { v: '매일', icon: '📅', hint: '하루도 빠짐없이' },
      { v: '주 N회', icon: '🗓', hint: '주 2~3회 정도' },
      { v: '월 N회', icon: '📆', hint: '월 1~2회' },
      { v: '비정기', icon: '❓', hint: '필요할 때만' },
    ],
  },
  missedPart: {
    default: [
      { v: '체크 빼먹음', icon: '☐', hint: '확인을 안 함' },
      { v: '순서 바뀜', icon: '🔀', hint: '순서가 틀림' },
      { v: '안 함 자체', icon: '🚫', hint: '아예 잊어버림' },
      { v: '기준 모름', icon: '❓', hint: '어디까지 할지 모름' },
    ],
  },

  // ── 돌발(이벤트) ────────────────────────────────
  firstAction: {
    default: [
      { v: '사과 먼저', icon: '🙇', hint: '손님께 먼저 사과' },
      { v: '매뉴얼 확인', icon: '📘', hint: '비치된 매뉴얼 확인' },
      { v: '사장 보고', icon: '📞', hint: '사장님께 즉시 연락' },
      { v: '먼저 조치 후 보고', icon: '⚡', hint: '급하면 조치부터' },
    ],
  },
  forbidden: {
    default: [
      { v: '책임 회피 멘트', icon: '🙅', hint: '"제 잘못 아니에요" 같은 말' },
      { v: '손님 비교', icon: '⚖', hint: '다른 손님 사례 언급' },
      { v: '매장 외부 발설', icon: '📢', hint: 'SNS·외부에 말함' },
      { v: '큰 소리', icon: '🔊', hint: '언성 높임' },
    ],
  },
  report: {
    default: [
      { v: '즉시 전화', icon: '☎', hint: '바로 전화로' },
      { v: '메신저로', icon: '💬', hint: '카톡 등 메시지' },
      { v: '마감 때 한 번에', icon: '🌙', hint: '마감 후 정리해서' },
    ],
  },

  // ── 원칙(컨텍스트·위치) ──────────────────────────
  location: {
    default: [
      { v: '계산대 근처', icon: '🗄', hint: '카운터/계산대 주변' },
      { v: '작업 공간 안쪽', icon: '🍳', hint: '주방/창고 등' },
      { v: '주요 기기 옆', icon: '⚙', hint: '핵심 장비 주변' },
      { v: '직접 사진 첨부', icon: '📷', hint: '사진으로 보여드릴게요' },
    ],
    fnb: [
      { v: '카운터 하단', icon: '🗄', hint: '계산대 아래' },
      { v: '주방 안쪽', icon: '🍳', hint: '주방 캐비닛/선반' },
      { v: '머신 옆', icon: '☕', hint: '에스프레소 머신 주변' },
      { v: '직접 사진 첨부', icon: '📷', hint: '사진으로 보여드릴게요' },
    ],
  },

  // ── 꿀팁(노하우 판단 기준) ───────────────────────
  criterion: {
    default: [
      { v: '시각', icon: '👀', hint: '보면 알아요' },
      { v: '시간', icon: '⏱', hint: '몇 분 지나면' },
      { v: '손님 반응', icon: '😊', hint: '손님 표정·말' },
      { v: '촉감 또는 소리', icon: '👂', hint: '만져보거나 소리로' },
    ],
  },
};

/** 현재 매장 업종 (context-pack 기반). */
export function getIndustry(): Industry {
  const i = (contextPack as { industry?: string }).industry;
  return (i as Industry) ?? 'default';
}

/** step에 맞는 보기 목록 — 업종 프리셋 우선, 없으면 default. */
export function getChoices(step: WizardStepKey, industry: Industry = getIndustry()): ChoiceOption[] {
  const preset = PRESETS[step];
  return preset[industry] ?? preset.default;
}
