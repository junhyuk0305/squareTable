/** 출퇴근/급여 공용 포맷·계산 헬퍼 */

export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function minutesBetween(aISO: string, bISO: string): number {
  return Math.max(0, Math.round((new Date(bISO).getTime() - new Date(aISO).getTime()) / 60000));
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
