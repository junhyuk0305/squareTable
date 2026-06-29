/** 상대 시간 표기 — "방금 전 / N분 전 / N시간 전 / N일 전". */
export function formatAsked(asked: string, justNow = '방금 전'): string {
  const t = new Date(asked).getTime();
  if (Number.isNaN(t)) return justNow;
  const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (diffMin < 1) return justNow;
  if (diffMin < 60) return `${diffMin}분 전`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}
