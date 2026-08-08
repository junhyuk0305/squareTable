// 훈련 퀴즈 v2 — 지식 유형(kind) 판정기
//
// 설계 근거: 산출물/퀴즈시스템_설계_2026-07-29.html §02 "판정은 코드가 한다 — AI 아님"
//   판정 근거가 전부 이미 DB에 있는 값이라 AI를 안 쓴다 → 한도를 안 먹고 결과가 매번 같다.
//   AI에게 유형을 묻지 않는다(07-29 확정 사항).
//
// ★ 순수 함수다. supabase·store·db 를 import 하지 않는다(단위 테스트 가능해야 함).

import type { PlaybookEntry } from '@/types';
import type { QuizKind } from './types';

// ── 본문 모으기 ────────────────────────────────────────────
function bodyOf(entry: PlaybookEntry): string {
  const sq = entry?.square;
  return [
    entry?.title,
    sq?.situation,
    ...(sq?.action?.steps ?? []),
    sq?.extract?.do,
    sq?.extract?.dont,
  ]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

// ── t1 순서 ────────────────────────────────────────────────
// 계약 §1: steps.length >= 3. 07-29 는 여기에 "순서 의존성 표시"를 더 요구하지만
// 그건 신뢰도로 반영한다 — 표지가 없어도 t1 후보로는 두고, 있으면 순위를 올린다.
// (표지 없는 단순 나열에 순서 문제를 억지로 내지 않게 하는 건 엣지 프롬프트가 맡는다:
//  "순서가 중요하지 않은 나열이면 출제하지 마라" → 못 내면 빈 배열.)
const T1_ORDER = /먼저|그\s?다음|다음으로|마지막|끝으로|순서|차례|이어서|한\s?뒤|한\s?후|하기\s?전|전에|후에|①|②|③/;

// ── t2 수치 ────────────────────────────────────────────────
// 오탐(전화번호·날짜·시각·가격)을 먼저 지우고 나서 "수치+단위"를 찾는다.
const T2_NOISE = /\d{2,4}-\d{3,4}-\d{4}|\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}:\d{2}|\d{1,2}월\s?\d{1,2}일|[\d,]{4,}원/g;
const T2_NUM = '(?:\\d{1,3}(?:\\.\\d+)?|[한두세네]|다섯|여섯|일곱|여덟|아홉|열)';
// 단위는 화이트리스트. "명·원·년" 처럼 매장 노하우에서 값으로 쓰이지 않는 건 일부러 뺐다.
const T2_UNIT =
  '(?:펌프|샷|스푼|컵|잔|장|개|병|팩|봉지|캔|알|판|인분|조각|방울|회|바퀴|번'
  + '|도|℃|분|초|시간|개월|주일|주|일|배|퍼센트|%|㎖|ml|mL|리터|L|그램|kg|g|cm|mm)';
// 단위 뒤에 붙는 조사·접미. 긴 것을 먼저 둬야 "이상"이 "이"로 먼저 걸리지 않는다.
const T2_TAIL = '(?:이상|이하|이내|정도|가량|짜리|보다|부터|까지|으로|씩|만|간|당|쯤|을|를|은|는|이|가|에|로|와|과|나)?';
// "3번 테이블"처럼 자리를 가리키는 서수는 값이 아니다.
const T2_ORDINAL_NOUN = '(?!\\s?(?:테이블|서랍|자리|칸|줄|호|라인|지점|매장|자))';
const T2_RE = new RegExp(
  `(?:^|[^0-9A-Za-z가-힣])${T2_NUM}\\s?${T2_UNIT}${T2_ORDINAL_NOUN}${T2_TAIL}(?![가-힣A-Za-z0-9])`,
);
// 조리 분수(1/2 · 1/3 · 1/4). 날짜(8/3)와 겹치지 않게 분자를 1로 못 박는다.
const T2_FRACTION = /(?:^|[^0-9])1\s?\/\s?[234](?![0-9])/;

function hasNumericValue(text: string): boolean {
  const clean = text.replace(T2_NOISE, ' ');
  return T2_RE.test(clean) || T2_FRACTION.test(clean);
}

// ── t5 갈래 ────────────────────────────────────────────────
// 조건 표지가 **먼저** 있어야 갈래다. 그 위에 분기 신호를 본다.
// (분기 신호만으로 판정하면 "청소하고, 정리한다" 같은 단순 나열이 갈래로 잡힌다.)
const T5_COND =
  /(?:으면|하면|되면|이면|나면|않으면|없으면|있으면|같으면|많으면|적으면|오면|가면|모르면|보이면|생기면|넘으면)|(?:할|일|인|했을|있을|없을|오는|가는|하는|바쁜|한가한)\s?(?:때|땐|경우)|경우에는|경우엔|에\s?따라|인지|인가/g;
// 명시적 분기어 + 대조 나열("버리고, ~ 쓴다"). 후자는 조건 표지가 있을 때만 의미가 있다.
const T5_BRANCH = /아니면|그렇지\s?않으면|반대로|둘\s?중|각각|나눠|또는|이거나|[가-힣](?:고|거나),\s?/;

function branchScore(situation: string): number {
  if (!situation) return 0;
  T5_COND.lastIndex = 0;
  const marks = situation.match(T5_COND) ?? [];
  if (marks.length === 0) return 0;
  if (T5_BRANCH.test(situation)) return 65;   // 조건 + 명시적 갈림
  if (marks.length >= 2) return 55;           // 조건이 둘 이상이면 그 자체로 갈림
  // 조건 하나뿐이면 뒤에 결과 서술이 이어져야 갈래다. 문장 끝에 걸친 표지 하나는 갈래가 아니다.
  const last = situation.lastIndexOf(marks[marks.length - 1]) + marks[marks.length - 1].length;
  return situation.length - last >= 4 ? 50 : 0;
}

// ── t6 이름 ────────────────────────────────────────────────
// 07-29 가 스스로 인정한 대로 이 판정이 가장 약하다. tags 를 1순위 근거로 쓰고,
// 본문 반복 등장은 보조로만 쓴다. 확신이 없으면 t6 를 넣지 않는다 — 억지 출제가 최악이다.
const T6_STOP = new Set([
  '청소', '마감', '오픈', '준비', '정리', '확인', '교체', '사용', '손님', '고객', '직원', '매장',
  '주문', '계산', '결제', '음료', '커피', '재료', '위생', '안전', '관리', '보관', '세척', '소독',
  '매일', '매주', '시간', '방법', '순서', '주의', '금지', '업무', '노하우', '방문', '응대',
  '서비스', '포장', '배달', '판매', '진열', '발주', '재고', '냉장고', '냉동고', '화장실',
  '카운터', '테이블', '주방', '기계', '장비', '도구', '그릇', '접시', '쓰레기', '온도', '기준',
  '상태', '문제', '사고', '처리', '교육', '훈련', '담당', '시작', '종료', '전화', '예약',
  '할인', '쿠폰', '영수증', '현금', '카드', '위치', '표시', '작성', '기록', '보고', '요청',
]);
const JOSA = /(?:에서|으로|까지|부터|이랑|한테|에게|을|를|은|는|이|가|에|의|와|과|로|도|만|랑)$/;
const TOKEN_RE = /[가-힣]{2,8}|[A-Za-z][A-Za-z0-9]{1,11}/g;

function normalizeTerm(raw: string): string {
  return String(raw ?? '').trim().replace(JOSA, '').trim();
}

function countIn(text: string, term: string): number {
  if (!term) return 0;
  let n = 0;
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + term.length)) n += 1;
  return n;
}

/**
 * 이 노하우가 쓰는 "매장 고유 용어" 후보. t6 판정 근거이자, 이름 문항을 낼 때
 * 모델에 흘려 줄 재료다(생성기가 프롬프트에 싣는다).
 *
 * 1순위 = tags 중 본문에도 나오는 것. 2순위 = 본문에 3번 이상 나오는 낯선 말.
 * 흔한 운영 단어(청소·마감 …)는 어느 매장에서나 쓰므로 제외한다.
 */
export function storeTerms(entry: PlaybookEntry): string[] {
  const body = bodyOf(entry);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const t = normalizeTerm(raw);
    if (t.length < 2 || t.length > 12) return;
    if (T6_STOP.has(t) || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  // 1순위 — 사장이 붙인 tags 중 본문에 실제로 등장하는 것
  for (const tag of entry?.tags ?? []) {
    const t = normalizeTerm(tag);
    if (t && !T6_STOP.has(t) && countIn(body, t) >= 1) push(t);
  }

  // 2순위 — 본문에 3번 이상 반복 등장하는 말
  const counts = new Map<string, number>();
  for (const m of body.match(TOKEN_RE) ?? []) {
    const t = normalizeTerm(m);
    if (t.length < 2 || T6_STOP.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  for (const [t, n] of counts) if (n >= 3) push(t);

  return out;
}

// ── 판정 ───────────────────────────────────────────────────
/**
 * 이 노하우로 낼 수 있는 지식 유형들. **신뢰도 높은 순**으로 정렬하고 항상 t0 을 포함한다(안전망).
 * t0 는 언제나 마지막이다 — 다른 유형이 하나라도 잡히면 그쪽이 먼저다.
 *
 * 한 노하우가 여러 유형을 동시에 갖는 게 정상이다(07-29 §02). 같은 노하우가 세 번째 나올 때
 * 매번 다른 형태로 나와야 복습이 지루해지지 않는다.
 */
export function detectKinds(entry: PlaybookEntry): QuizKind[] {
  const sq = entry?.square;
  const steps = sq?.action?.steps ?? [];
  const dont = String(sq?.extract?.dont ?? '').trim();
  const situation = String(sq?.situation ?? '').trim();
  const body = bodyOf(entry);

  const scored: { kind: QuizKind; score: number }[] = [];

  // t3 금지 — 07-29 §03 "출제 1순위". dont 가 적혀 있다는 건 그 매장에서 이미 사고가 났다는 뜻.
  if (dont) scored.push({ kind: 't3', score: 100 });

  // t2 수치 — standard(등록 화면에서 구조로 받은 값)가 있으면 확실하고, 본문 패턴은 그다음.
  if (sq?.standard?.kind === 'count' || sq?.standard?.kind === 'spectrum') {
    scored.push({ kind: 't2', score: 90 });
  } else if (hasNumericValue(body)) {
    scored.push({ kind: 't2', score: 70 });
  }

  // t1 순서 — 계약 §1 은 steps>=3 만 본다. 순서 표지가 있으면 신뢰도를 올린다.
  if (steps.filter((s) => String(s ?? '').trim()).length >= 3) {
    scored.push({ kind: 't1', score: T1_ORDER.test(body) ? 85 : 60 });
  }

  // t5 갈래 — situation 의 조건 표지 + 결과 분기.
  const branch = branchScore(situation);
  if (branch > 0) scored.push({ kind: 't5', score: branch });

  // t6 이름 — 용어가 2개 이상일 때만. 하나뿐이면 오답 후보가 없어 문항이 성립하지 않는다
  //   (일반 명사를 오답으로 쓰면 정답이 바로 티가 난다) → 억지 출제가 되므로 아예 넣지 않는다.
  const terms = storeTerms(entry);
  if (terms.length >= 2) scored.push({ kind: 't6', score: terms.length >= 3 ? 55 : 45 });

  scored.sort((a, b) => b.score - a.score);
  return [...scored.map((s) => s.kind), 't0'];
}
