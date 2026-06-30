/**
 * 노하우 입력 검증 — 실제 고객은 난잡한 입력을 한다(자모·반복·기호·인사·욕설·테스트).
 * AI에 넘기기 전/후로 "노하우가 아닌 입력"을 걸러 가짜 카드·프롬프트 누출을 막는다.
 *
 * 3중 방어:
 *  1) isJunkInput      — 명백한 잡음(자모만·한 글자 반복·기호·숫자·이모지·초단문) → AI 호출 전 즉시 차단(비용 0).
 *  2) (Edge) usable=false — 의미상 노하우가 아닌 정상 문장(인사·잡담·테스트) → AI가 판정.
 *  3) looksLikePromptLeak — flash-lite가 시스템 프롬프트를 노하우로 토해낸 경우 방어선.
 */

/** 완성형 한글 음절 또는 2자 이상 라틴 단어가 하나라도 있는가(의미 글자 존재 여부). */
function hasMeaningfulChars(t: string): boolean {
  return /[가-힣]/.test(t) || /[a-zA-Z]{2,}/.test(t);
}

/** 명백한 잡음이면 true — AI 호출 없이 즉시 되묻기. */
export function isJunkInput(raw: string): boolean {
  const t = (raw ?? '').trim();
  if (t.length < 2) return true; // 한 글자/빈값
  const compact = t.replace(/\s+/g, '');
  // 자모(ㅁㄴㅇㄹ·ㅋㅋ·ㅠㅠ·ㅏㅏ)만, 또는 기호·숫자·이모지만 → 완성형 음절/라틴 없음
  if (!hasMeaningfulChars(t)) return true;
  // 같은 문자 1~2종이 3자 이상 반복 (아아아아, ㅎㅎㅎ, !!!!!)
  if (new Set(compact).size <= 2 && compact.length >= 3) return true;
  // 한 글자 3회+ 반복 (와아아, 음음음)
  if (/^(.)\1{2,}$/.test(compact)) return true;
  // 의미 글자(완성형 음절+라틴) 총량이 2 미만 (예: "1번"→"번" 1개)
  const meaningful = (t.match(/[가-힣a-zA-Z]/g) || []).length;
  if (meaningful < 2) return true;
  return false;
}

// flash-lite가 정리 대신 [지침]/스키마를 노하우로 토해낸 흔적(프롬프트 누출).
const LEAK_RE =
  /매장 노하우.*정리|원문.*(분석|정리)|알바가 바로 따라 할 수 있게|entries\s*배열|scale_prompt|situation\b|category를?\s*분류|꼬리질문\(followups\)|정리할.*원문.*입력/i;

/** AI 출력(title·steps)이 시스템 프롬프트 누출로 보이면 true → 카드 대신 되묻기. */
export function looksLikePromptLeak(title: string, steps: string[]): boolean {
  const hay = [title, ...(steps ?? [])].join(' ');
  return LEAK_RE.test(hay);
}

/* ───────────────────────────────────────────────────────────
 * 비노하우 입력 종류 분류 + 종류별 안내 문구.
 * "그냥 카드 미생성"이 아니라, 입력 성격에 맞는 안내를 돌려준다.
 * (잡음 차단·usable=false 양쪽에서 원문으로 호출 — 같은 문구 체계 공유)
 * ─────────────────────────────────────────────────────────── */
export type NonKnowhowKind =
  | 'abuse' | 'greeting' | 'thanks' | 'test' | 'vague'
  | 'jamo' | 'repeat' | 'symbol' | 'short' | 'generic';

export function classifyNonKnowhow(raw: string): NonKnowhowKind {
  const t = (raw ?? '').trim();
  if (t.length === 0) return 'short';
  const compact = t.replace(/\s+/g, '');
  // 의미 키워드(완성형 음절 입력)부터 — 자모/반복 판정보다 우선.
  if (/(시발|씨발|ㅅㅂ|존나|꺼져|닥쳐|개새|병신|미친|엿먹|fuck|shit)/i.test(t)) return 'abuse';
  if (/(안녕|반가|하이|ㅎㅇ|좋은\s*아침|수고|^hi$|^hello$)/i.test(t)) return 'greeting';
  if (/(고마|감사|사랑|최고|멋(져|있)|ㄳ|ㄱㅅ)/.test(t)) return 'thanks';
  if (/(테스트|시험|^test$|asdf|qwer|ㅁㄴㅇㄹ)/i.test(t)) return 'test';
  if (/^(그냥|몰라|모름|없음|없어|음+|흠+|글쎄|뭐지|아무거나)$/.test(t)) return 'vague';
  // 완성형 음절·라틴 단어가 전혀 없음 → 자모 / 기호·숫자·이모지
  if (!/[가-힣]/.test(t) && !/[a-zA-Z]{2,}/.test(t)) {
    return /[ㄱ-ㅎㅏ-ㅣ]/.test(compact) ? 'jamo' : 'symbol';
  }
  // 같은 글자 반복 (아아아아 / 와와와 / 음음음)
  if (/^(.)\1{2,}$/.test(compact) || (new Set(compact).size <= 2 && compact.length >= 3)) return 'repeat';
  // 의미 글자가 너무 적음
  if ((t.match(/[가-힣a-zA-Z]/g) || []).length < 2) return 'short';
  return 'generic';
}

const EX = '예) “마감 때 그릴 끄고 기름통 비우기”';
const GUIDANCE: Record<NonKnowhowKind, string> = {
  abuse: `편하게 말씀하셔도 돼요 🙂 알려주실 매장 노하우를 한 줄 적어주시면 제가 정리할게요.\n예) “컴플레인 들어오면 우선 사과부터”`,
  greeting: `안녕하세요! 😊 알려주실 매장 노하우를 적어주시면 제가 깔끔히 정리해드릴게요.\n예) “손님 많을 때 포장 먼저 처리하기”`,
  thanks: `감사해요 🙂 이제 알려주실 노하우를 한 줄 적어주시면 바로 정리할게요.\n예) “재료 떨어지면 사장님께 바로 문자”`,
  test: `테스트 중이시군요! 실제로 알려주실 노하우를 적어보세요 — 짧아도 제가 되물어가며 정리해요.\n예) “마감 청소 순서”`,
  vague: `괜찮아요, 떠오르는 대로 적어주셔도 돼요. 어떤 상황의 무슨 노하우인지 한 줄이면 시작돼요.\n예) “바쁠 때 주문 받는 요령”`,
  jamo: `글자가 깨져서 들어온 것 같아요 🙂 한글로 또박또박 적어주세요.\n${EX}`,
  repeat: `같은 글자가 반복돼서 내용을 못 읽었어요. 알려주실 노하우를 문장으로 적어주세요.\n예) “음료 식었다고 하면 새로 만들어 드리기”`,
  symbol: `기호·숫자만으로는 정리하기 어려워요. 무엇을 어떻게 하는지 글로 적어주세요.\n예) “오픈하면 에어컨 켜고 음악 틀기”`,
  short: `조금만 더 적어주세요. “언제 / 무엇을 / 어떻게”가 담기면 제가 정리할게요.\n${EX}`,
  generic: `음… 매장 노하우 내용이 잘 안 보여요. “언제 / 무엇을 / 어떻게”가 담기게 적어주세요.\n${EX}`,
};

/** 비노하우 입력에 대한 종류별 안내 문구. */
export function knowhowGuidanceMessage(raw: string): string {
  return GUIDANCE[classifyNonKnowhow(raw)];
}

/**
 * 출력이 "통째로 영어"인지 — 라틴 글자 4자+ 인데 한글 음절이 하나도 없으면 영어 드리프트로 본다.
 * (혼용은 허용: 한글이 하나라도 섞이면 false → "모닝 그라인더"·"grinder 청소" OK)
 */
export function isEnglishDominant(text: string): boolean {
  const ko = (text.match(/[가-힣]/g) || []).length;
  const en = (text.match(/[a-zA-Z]/g) || []).length;
  return en >= 4 && ko === 0;
}
