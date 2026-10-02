// visibility.ts — 공개 수준(요약 / 노하우 공개 / 운영 공개)의 이름·설명 정본(기획정본 §4-A 표).
//
// 본사 설정 > 데이터 공개 안내와 점주 동의 화면·설정 > 본사 연결이 **같은 표**를 그린다 —
// 문구가 두 곳에서 어긋나면 점주가 동의한 것과 본사가 보는 것이 달라진다. 여기 한 곳만 고친다.
// 개인 축(급여·근태·직원 이름·개인 점수·채팅)은 어느 수준에도 없다 — 표에 "없음" 줄로 박아 둔다.
import type { BrandPayer, BrandRelation, BrandVisibility } from '@/lib/brand/brandDb';

export type VisibilityLevel = {
  key: BrandVisibility;
  label: string;
  /** 한 줄 요약 — 세그먼트·pill 아래 설명. */
  short: string;
  /** 본사가 보게 되는 것 — 동의 화면 경계표 본문. 앞 수준의 것을 **포함**한다. */
  sees: string[];
};

export const VISIBILITY_LEVELS: VisibilityLevel[] = [
  {
    key: 'summary',
    label: '요약',
    short: '매장 단위 숫자만',
    sees: ['연결 상태 · 요금 부담', '직원 수 · 노하우 수 · 미해결 질문 수', 'AI 사용량 · 본사 노하우 숙지율'],
  },
  {
    key: 'knowhow',
    label: '노하우 공개',
    short: '요약 + 매장 노하우 읽기',
    sees: ['요약의 전부', '매장이 직접 쓴 노하우 제목·본문(읽기만)'],
  },
  {
    key: 'ops',
    label: '운영 공개',
    short: '노하우 공개 + 운영 현황',
    sees: ['노하우 공개의 전부', '미해결 질문 내용(누가 물었는지는 없음)', '업무 완료 현황 · 매장 퀴즈 현황(매장 단위)'],
  },
];

/** 어느 수준에서도 본사에 가지 않는 것 — 스키마 수준에서 경로가 없다(brand-boundary 규칙). */
export const NEVER_SHARED = ['급여 · 시급 · 근태', '직원 이름 · 전화번호', '직원 개인별 점수 · 이수 기록', '업무 채팅'];

export const visibilityLabel = (v: BrandVisibility): string =>
  VISIBILITY_LEVELS.find((l) => l.key === v)?.label ?? v;

export const payerLabel = (p: BrandPayer): string => (p === 'brand' ? '본사 부담' : '매장 부담');

/**
 * 관계 이름(0223 · 정본 02 §2). 본사 표·드로어·점주 화면이 **같은 단어**를 쓴다 —
 * 한쪽만 '직영점'이고 다른 쪽이 '본사 직영'이면 같은 것을 두 개로 읽는다.
 */
export const relationLabel = (r: BrandRelation): string => (r === 'direct' ? '직영' : '가맹');

/**
 * 본사 화면 배지 색 — 목록·상세·대시보드가 같은 매장을 같은 색으로 그리게 한 곳에 둔다(전엔 화면마다 복제).
 * 관계는 직영만 색을 준다 — 가맹이 기본값이고 대부분이라 둘 다 물들이면 표가 시끄럽다.
 * (PillTone 값만 쓴다 — 표시 부품 HqKit 을 lib 가 import 하지 않게 글자 그대로 둔다.)
 */
export const VIS_TONE: Record<BrandVisibility, 'n' | 'i' | 'g'> = { summary: 'n', knowhow: 'i', ops: 'g' };
export const REL_TONE: Record<BrandRelation, 'i' | 'n'> = { direct: 'i', franchise: 'n' };

/** 표 필터·세그먼트의 순서 정본. '전체'는 화면이 앞에 붙인다. */
export const RELATIONS: { key: BrandRelation; label: string }[] = [
  { key: 'direct', label: '직영' },
  { key: 'franchise', label: '가맹' },
];

/** 수준 순서 비교 — 0224 `brand_visibility_rank` 와 **같은 표**여야 한다(하한 판정이 서버와 갈리면 안 된다). */
const RANK: Record<BrandVisibility, number> = { summary: 1, knowhow: 2, ops: 3 };
export const visibilityRank = (v: BrandVisibility): number => RANK[v] ?? 0;
/** 이 수준을 점주가 고를 수 있나 — 하한 아래는 회색 + 자물쇠다(정본 §5). */
export const isBelowFloor = (v: BrandVisibility, floor: BrandVisibility): boolean =>
  visibilityRank(v) < visibilityRank(floor);

/**
 * 관계별 경계표(정본 §4 항목표) — **한 곳**이 그린다. 점주 동의 화면과 설정 > 본사 연결이 같은 표를 쓴다.
 * 못 켜는 항목을 숨기지 않고 회색 + 이유로 보여 주는 것이 원칙이다(정본 §2 ②):
 * 안 보이면 버그로 읽고 문의하지만, 이유 한 줄이 붙으면 그 줄이 곧 영업 문구가 된다.
 */
export type RelationRule = { label: string; franchise: string; direct: string };
export const RELATION_RULES: RelationRule[] = [
  { label: '공개 수준', franchise: '점주가 정해요(본사는 요청만)', direct: '본사가 최소 범위를 정하고, 점장은 그 위로만' },
  { label: '받은 노하우 숨기기', franchise: '언제든 숨길 수 있어요', direct: '본사가 필수로 보낸 것은 숨길 수 없어요' },
  { label: '연결 해제', franchise: '점주가 끊을 수 있어요', direct: '본사만 끊을 수 있어요' },
  { label: '요금 부담', franchise: '양쪽이 제안하고 상대가 수락해요', direct: '본사 부담으로 고정돼요' },
  { label: '급여 · 근태 · 직원 개인 기록', franchise: '본사에 가지 않아요', direct: '본사에 가지 않아요' },
];

/** 잠긴 칸 옆에 붙는 이유 한 줄. 가맹에서 못 켜는 것은 **법**이 이유다(정본 §2 ②). */
export const LOCK_REASON = {
  direct: '직영점은 본사가 정해요. 바꾸려면 본사에 문의해 주세요.',
  franchise: '가맹점은 법적으로 켤 수 없어요(가맹사업법 제12조).',
} as const;

/**
 * 배포 대상이 직영·가맹으로 섞였을 때 **미리 말해 주는** 한 줄(정본 02 §9).
 * 관계가 섞이는 것은 정상이고 배포도 그대로 나간다 — 다만 내려간 뒤의 규칙이 매장마다 다르다.
 * ★이 문장이 없으면 본사는 40곳 모두에 강제된다고 오해하고, 그 오해가 곧 가맹사업법 위반 통보가 된다.
 * 한 관계만 골랐으면 null — 설명할 차이가 없는데 말을 붙이면 소음이다.
 */
export const deployMixNotice = (
  targets: { relation: BrandRelation }[],
  required: boolean,
): string | null => {
  const d = targets.filter((t) => t.relation === 'direct').length;
  const f = targets.length - d;
  if (d === 0 || f === 0) return null;
  return required
    ? `직영 ${d}곳엔 필수로, 가맹 ${f}곳엔 권장으로 내려가요. 가맹점은 받은 내용을 숨길 수 있어요.`
    : `직영 ${d}곳 · 가맹 ${f}곳에 같이 내려가요. 어느 쪽이든 점주가 숨길 수 있어요.`;
};

/** [필수로 내리기] 체크 옆 설명 — 가맹에는 걸 수 없다는 것을 **체크하는 시점에** 말한다. */
export const REQUIRED_HINT = '직영점에만 걸려요. 가맹점은 법적으로 필수 배포를 걸 수 없어요(가맹사업법 제12조).';

/** 연결 해제 사유 — 원장(brand_units.end_reason)에 그대로 남는다. 자유 입력은 받지 않는다. */
export const END_REASONS: { key: string; label: string }[] = [
  { key: 'contract_ended', label: '본사와 계약이 끝났어요' },
  { key: 'self_manage', label: '매장이 직접 관리할게요' },
  { key: 'privacy', label: '공개 범위가 부담돼요' },
  { key: 'other', label: '그 밖의 이유' },
];
