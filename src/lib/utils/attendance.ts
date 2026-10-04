/** 출퇴근/급여 공용 포맷·계산 헬퍼 */

/**
 * 해마다의 법정 최저시급(원). 시급 미설정 직원의 대체값으로 쓰지 않는다(Q12) — 시급이 없으면 금액을 숨긴다.
 * 2027년 10,700원은 최저임금위원회 의결 보도 기준이다. 고용노동부 고시 원문은 아직 확인하지 못했다.
 */
export const MIN_WAGE: Record<number, number> = { 2025: 10030, 2026: 10320, 2027: 10700 };

/** 표에서 쓸 해. 표에 없는 해는 가장 가까운 해로 맞춘다(최저시급은 내려간 적이 없어 뒤의 해에는 하한이다). */
function minWageYear(date: string): number {
  const years = Object.keys(MIN_WAGE).map(Number).sort((a, b) => a - b);
  return Math.min(Math.max(Number(date.slice(0, 4)), years[0]), years[years.length - 1]);
}

/** 'YYYY-MM-DD' 가 속한 해의 최저시급. */
export function minimumWageFor(date: string): number {
  return MIN_WAGE[minWageYear(date)];
}

/**
 * 시급이 그해 최저시급보다 낮으면 경고 문구, 아니면 null.
 * 막지 않고 경고만 한다 — 수습 감액 같은 예외가 있다(최저임금법 제5조 2항).
 */
export function minWageWarning(wage: number, date: string): string | null {
  const min = minimumWageFor(date);
  if (wage >= min) return null;
  return `시급이 ${minWageYear(date)}년 최저시급 ${won(min)}보다 낮아요. 수습 기간이 아니라면 다시 확인해 주세요.`;
}

/** 급여 산정 단위(분). 근무시간은 이 단위로 절삭해 정산한다(실무 관행). */
export const PAY_UNIT_MIN = 30;

/**
 * 한 번의 근무로 인정하는 최대 분(=24시간). 퇴근을 안 찍어 타이머가 방치되면
 * 경과시간/급여추정이 무한히 불어나 말도 안 되는 금액이 잡힌다(남용 #12) → 24h에서 절상.
 * 24h를 넘긴 미퇴근 기록은 사실상 '퇴근 깜빡'이므로, 사장이 수기 보정하기 전까지 24h로 고정한다.
 */
export const MAX_SHIFT_MIN = 24 * 60;

/** 급여 산정 분 — 30분 단위로 내림(미만은 버림). "1분마다 오르는" 체감 대신 30분 단위로 정산. */
export function payableMinutes(min: number): number {
  return Math.floor(min / PAY_UNIT_MIN) * PAY_UNIT_MIN;
}

/** 근무 분 × 시급 → 급여(원). 30분 단위로 절삭 후 계산. */
export function payFor(min: number, wage: number): number {
  return Math.round((payableMinutes(min) * wage) / 60);
}

/**
 * 근무 분 — 퇴근했으면 확정 work_minutes, 근무 중이면 출근시각부터 지금까지의 실시간 경과분.
 * AttendanceRecord(구조적 타입)를 받아 store 순환 의존 없이 화면 어디서나 재사용.
 */
export function liveMinutes(r: {
  check_in: string | null;
  check_out: string | null;
  work_minutes: number;
}): number {
  if (r.check_out) return Math.min(MAX_SHIFT_MIN, r.work_minutes);
  if (r.check_in) return Math.min(MAX_SHIFT_MIN, minutesBetween(r.check_in, new Date().toISOString()));
  return 0;
}

/**
 * 기기 타임존과 무관하게 KST(UTC+9) 벽시계를 얻는다. 반환 Date는 **getUTC*** 로 읽어야 KST 값이 나온다.
 * nowISO 가 저장을 "+09:00" 로 고정하는 것과 짝 — 날짜분류(todayStr)·시각표시(hhmm)도 KST 로 고정해
 * 기기 시계/타임존 오설정(해외·VPN·잘못된 TZ)에 근무일이 전날로 밀리거나 시각이 어긋나는 걸 막는다.
 */
function kstShift(d: Date): Date {
  return new Date(d.getTime() + 9 * 3600 * 1000);
}

export function todayStr(d: Date = new Date()): string {
  const k = kstShift(d);
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, '0');
  const day = String(k.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function minutesBetween(aISO: string, bISO: string): number {
  return Math.max(0, Math.round((new Date(bISO).getTime() - new Date(aISO).getTime()) / 60000));
}

/**
 * 앱에서 저장하는 모든 타임스탬프의 **단일 생성 지점**.
 * 손으로 "+09:00"을 붙이거나 직접 ISO를 조립하지 말 것 — 표기가 섞이면(KST 오프셋 vs UTC 'Z')
 * 정렬·비교가 깨진다(예: 데모가 최신 메시지 아래로 밀림). 시드/고정시각은 반드시 이걸로 만든다.
 *  - 인자 없음 → 지금(현재 시각). `new Date().toISOString()`과 동일.
 *  - (dateStr, time) → KST 벽시계("YYYY-MM-DD", "HH:MM" 또는 "HH:MM:SS")를 표준 UTC ISO로 변환.
 * 반환은 항상 UTC ISO("…Z") 한 가지 표기뿐이라, 어디서 만들든 타임존이 달라질 수 없다.
 */
export function nowISO(): string;
export function nowISO(dateStr: string, time: string): string;
export function nowISO(dateStr?: string, time?: string): string {
  if (dateStr === undefined || time === undefined) return new Date().toISOString();
  const t = time.length === 5 ? `${time}:00` : time; // "HH:MM" → "HH:MM:SS"
  return new Date(`${dateStr}T${t}+09:00`).toISOString();
}

/**
 * ISO 타임스탬프 → epoch ms. 정렬/비교는 반드시 이걸로 한다(문자열 localeCompare 금지).
 * 생성은 nowISO()로 단일화돼 표기가 섞이지 않지만, 외부/레거시 데이터가 섞여 들어와도
 * 안전하도록 비교는 항상 epoch로 정규화한다(방어선). 파싱 실패 시 0(맨 앞).
 */
export function tsMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

export function hhmm(iso: string): string {
  const k = kstShift(new Date(iso)); // KST 벽시계로 표시(기기 타임존 무관)
  return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

/** "6/30 14:00" — 짧은 날짜+시각. 공지·로그 카드 타임스탬프(시간만으론 언제 건지 모호한 곳)에. */
export function mdHHmm(iso: string): string {
  const k = kstShift(new Date(iso)); // KST 벽시계
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hhmm(iso)}`;
}

/** 이만큼 넘게 열려 있는 기록은 퇴근을 깜빡한 것으로 본다(Q4). 퇴근 버튼 대신 실제 퇴근 시각을 받는다. */
export const FORGOT_CHECKOUT_MIN = 16 * 60;

/**
 * 그 직원의 열린(미퇴근) 기록 하나 — **날짜와 상관없이** 가장 최근 출근 1건.
 * ★Q4: 화면은 오늘 날짜 기록만 보고 스토어는 날짜 무관으로 봐서, 자정을 넘긴 야간 근무자에게
 *   퇴근 버튼이 사라졌다. 스토어 checkIn·checkOut, 홈, 출퇴근 화면, 사장 직원 목록이 모두 이것을 쓴다.
 */
export function findOpenRecord<T extends { staff_id: string; check_in: string | null; check_out: string | null }>(
  records: readonly T[],
  staffId: string,
): T | undefined {
  let best: T | undefined;
  for (const r of records) {
    if (r.staff_id !== staffId || !r.check_in || r.check_out) continue;
    if (!best || tsMs(r.check_in) > tsMs(best.check_in!)) best = r;
  }
  return best;
}

/** 열린 기록의 출근 표시 — 오늘이면 "22:00 출근", 어제면 "어제 22:00 출근", 그 전이면 "10/3 22:00 출근"(KST). */
export function openSinceText(checkIn: string, now: Date = new Date()): string {
  const day = todayStr(new Date(checkIn));
  if (day === todayStr(now)) return `${hhmm(checkIn)} 출근`;
  if (day === todayStr(new Date(now.getTime() - 24 * 3600 * 1000))) return `어제 ${hhmm(checkIn)} 출근`;
  return `${mdHHmm(checkIn)} 출근`;
}

/** 16시간이 넘게 열려 있는가 — 퇴근 깜빡 판정(Q4). 닫힌 기록은 false. */
export function isForgotCheckout(r: { check_in: string | null; check_out: string | null }, now: Date = new Date()): boolean {
  if (!r.check_in || r.check_out) return false;
  return minutesBetween(r.check_in, now.toISOString()) > FORGOT_CHECKOUT_MIN;
}

/**
 * 입력 마스크 — 숫자만 받아 "1230"→"12:30"으로 자동 정리(4자리까지).
 * 시(0~23)·분(0~59)은 두 자리가 다 찼을 때만 클램프한다.
 * ⚠️ 편집 중에는 입력한 자릿수를 그대로 보존한다(한 자리 분을 "00"으로 패딩하지 않음).
 *    과거엔 "09:0"을 "09:00"으로 되패딩해 백스페이스가 즉시 되돌려져 시간 수정이 불가능했다(회귀 방지).
 */
export function maskHHMM(text: string): string {
  const d = text.replace(/[^0-9]/g, '').slice(0, 4);
  if (d.length <= 2) {
    // 시만 입력 중 — 두 자리가 차면 클램프, 아니면 자릿수 그대로(삭제 가능).
    return d.length === 2 ? String(Math.min(23, Number(d))).padStart(2, '0') : d;
  }
  const h = String(Math.min(23, Number(d.slice(0, 2)))).padStart(2, '0');
  const mm = d.slice(2); // 1~2자리
  const m = mm.length === 2 ? String(Math.min(59, Number(mm))).padStart(2, '0') : mm;
  return `${h}:${m}`;
}

/** "1200" / "12:5" / "12:00" → "HH:MM" (24시 클램프). 비면 null. 출퇴근 수기 보정 입력 정규화. */
export function normalizeTime(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 4);
  if (!digits) return null;
  let h: number, m: number;
  if (digits.length <= 2) {
    h = Number(digits);
    m = 0;
  } else {
    h = Number(digits.slice(0, digits.length - 2));
    m = Number(digits.slice(digits.length - 2));
  }
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 다 친 "HH:MM"(다섯 글자)만 정규화해 돌려준다. 덜 쳤으면 null.
 * ★퇴근 깜빡 카드용: 덜 친 "18:3" 을 normalizeTime 에 넣으면 183 을 1시 83분으로 읽어 "01:59" 가 된다.
 */
export function completeHHMM(raw: string): string | null {
  return /^\d{2}:\d{2}$/.test(raw) ? normalizeTime(raw) : null;
}

/** "YYYY-MM" 기준 delta개월 이동 */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 해당 월의 실제 일수(2월 28/29 등) */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
