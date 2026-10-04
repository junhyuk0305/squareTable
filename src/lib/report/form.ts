// 설정의 신고하기(F-1 · 0241) — 오류 코드 문구와 보내기 전 검사. 순수 파일이다(RN·supabase 를 import 하지 않는다).
// 검증 = scripts/qa-report-form.mjs.
//
// 서버 규칙(0241 submit_user_report)과 같은 것을 먼저 본다. 서버가 정본이고 여기는 빨리 알려 주는 자리다.
//   · 대상이 없으면 분류는 'ai_answer' 만(정책 M5 · AI 답변 신고).
//   · 내용은 앞뒤 공백을 걷은 뒤 5~1000자. 서버 char_length 는 코드 포인트로 센다 → JS length(UTF-16)로 세지 않는다.
//   · 있었던 때는 KST 로 만든다. 10분 넘게 미래면 서버가 invalid_occurred_at 으로 거절한다.
import type { DbErr } from '@/lib/db';

export type PersonCategory = 'harassment' | 'sexual' | 'inappropriate' | 'spam' | 'other';
export type ReportCategory = PersonCategory | 'ai_answer';

/** 사람 신고 분류. 순서는 0241 CHECK 와 같다. */
export const PERSON_CATEGORIES: { key: PersonCategory; label: string }[] = [
  { key: 'harassment', label: '괴롭힘·폭언' },
  { key: 'sexual', label: '성희롱' },
  { key: 'inappropriate', label: '부적절한 말·사진' },
  { key: 'spam', label: '스팸·광고' },
  { key: 'other', label: '기타' },
];

export const AI_TARGET_LABEL = 'AI 답변 문제';
export const REPORT_DONE_TEXT = '접수했어요. 운영팀이 확인해요.';
export const REPORT_NO_STORE_TEXT = '매장에 소속돼 있을 때 신고할 수 있어요.';
/** 있었던 때 날짜 칩. 더 전 일은 내용에 적는다. */
export const REPORT_DAYS: { offset: number; label: string }[] = [
  { offset: 0, label: '오늘' },
  { offset: 1, label: '어제' },
  { offset: 2, label: '그저께' },
];
export const REPORT_BODY_MIN = 5;
export const REPORT_BODY_MAX = 1000;

const ASK = '문의하기로 알려 주세요.';
const MESSAGES: Record<string, string> = {
  not_authenticated: '로그인이 풀렸어요. 다시 로그인해 주세요.',
  invalid_category: '어떤 일인지 골라 주세요.',
  invalid_body: `내용을 ${REPORT_BODY_MIN}자 이상 ${REPORT_BODY_MAX}자 이하로 적어 주세요.`,
  invalid_occurred_at: '아직 오지 않은 시각이에요. 있었던 때를 다시 적어 주세요.',
  target_required: '신고할 사람을 골라 주세요.',
  not_a_member: `${REPORT_NO_STORE_TEXT} ${ASK}`,
  not_a_store: `매장에서만 신고할 수 있어요. ${ASK}`,
  self_report: '나를 신고할 수는 없어요.',
  target_not_member: `이미 매장을 나간 사람이에요. ${ASK}`,
  rate_limited: '신고는 하루에 5건까지 보낼 수 있어요. 더 알릴 일은 문의하기로 보내 주세요.',
  duplicate_recent: '같은 사람은 1시간 뒤에 다시 신고할 수 있어요. 더 알릴 일은 문의하기로 보내 주세요.',
};

/** 0241 RPC 오류 → 화면 문구. 모르는 코드는 fallback. 원문은 화면에 내지 않는다(AGENTS ⑨). */
export function reportErrorMessage(err: DbErr, fallback = '신고를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.'): string {
  const code = (err?.message ?? '').split(/[\s:]/)[0];
  return MESSAGES[code] ?? fallback;
}

export type ReportForm = {
  unitId: string;
  /** 고른 사람(report_targets 의 user_id). ai 가 true 면 보지 않는다. */
  targetId: string | null;
  /** "AI 답변 문제"를 골랐다. */
  ai: boolean;
  category: string | null;
  body: string;
  /** REPORT_DAYS 의 offset. null 이면 있었던 때를 안 적는다. */
  day: number | null;
  /** "HH:MM". day 가 null 이면 보지 않는다. */
  time: string;
};

export type ReportPayload = {
  unitId: string;
  target: string | null;
  category: ReportCategory;
  body: string;
  occurredAt: string | null;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const FUTURE_SLACK_MS = 10 * 60 * 1000;

/** now 기준 KST 로 offset 일 전 날짜의 HH:MM → ISO. */
function kstIso(now: Date, offset: number, hh: string, mm: string): string {
  const d = new Date(now.getTime() + KST_MS - offset * DAY_MS);
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return new Date(`${ymd}T${hh}:${mm}:00+09:00`).toISOString();
}

/** 보내기 전 검사. 통과하면 RPC 에 넘길 값, 아니면 화면 문구 한 줄. */
export function prepareReport(f: ReportForm, now: Date = new Date()): { error: string } | { error: null; payload: ReportPayload } {
  if (!f.unitId) return { error: '매장을 골라 주세요.' };

  let target: string | null = null;
  let category: ReportCategory;
  if (f.ai) {
    category = 'ai_answer';
  } else {
    if (!f.targetId) return { error: MESSAGES.target_required };
    const known = PERSON_CATEGORIES.find((c) => c.key === f.category);
    if (!known) return { error: MESSAGES.invalid_category };
    target = f.targetId;
    category = known.key;
  }

  const body = f.body.trim();
  const len = [...body].length;
  if (len < REPORT_BODY_MIN) return { error: `내용을 ${REPORT_BODY_MIN}자 이상 적어 주세요.` };
  if (len > REPORT_BODY_MAX) return { error: `내용은 ${REPORT_BODY_MAX}자까지 적을 수 있어요.` };

  let occurredAt: string | null = null;
  if (f.day !== null) {
    const m = HHMM.exec(f.time.trim());
    if (!m) return { error: '시각을 18:30처럼 적어 주세요.' };
    occurredAt = kstIso(now, f.day, m[1], m[2]);
    if (Date.parse(occurredAt) > now.getTime() + FUTURE_SLACK_MS) return { error: MESSAGES.invalid_occurred_at };
  }

  return { error: null, payload: { unitId: f.unitId, target, category, body, occurredAt } };
}
