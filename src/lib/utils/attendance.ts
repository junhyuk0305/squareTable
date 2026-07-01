/** 출퇴근/급여 공용 포맷·계산 헬퍼 */

/** 최저시급 기본값 — 시급 미설정 직원의 폴백(법정 최저, 2025 기준). */
export const DEFAULT_HOURLY_WAGE = 10030;

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

export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "6/30 14:00" — 짧은 날짜+시각. 공지·로그 카드 타임스탬프(시간만으론 언제 건지 모호한 곳)에. */
export function mdHHmm(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(iso)}`;
}

/** 입력 마스크 — 숫자만 받아 "1230"→"12:30"으로 자동 정리(4자리까지). 유효성 검사는 별도. */
export function maskHHMM(text: string): string {
  const d = text.replace(/[^0-9]/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
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
