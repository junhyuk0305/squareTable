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
