/**
 * 교육 링크(/l/[token]) 주소와 남은 날. 주소 앞부분은 퀴즈 링크·초대 링크와 같은 SSOT(config/site)를 쓴다.
 * 복사는 utils/shareText 하나다(웹·네이티브 모두 클립보드 · quiz/link.ts 와 같은 동작).
 */
import { siteOrigin } from '@/lib/config/site';

export function eduLinkUrl(token: string): string {
  return `${siteOrigin()}/l/${token}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 링크 기간 상한(일) — 서버 edu_link_create·edu_link_update 와 같은 30. 만든 날부터 센다. */
export const EDU_LINK_MAX_DAYS = 30;
export const EDU_LINK_DEFAULT_DAYS = 7;

const KST_MS = 9 * 60 * 60 * 1000;
/** 한국 날짜 번호(1970-01-01 KST 부터 센 날). */
const kstDayNo = (t: number) => Math.floor((t + KST_MS) / DAY_MS);

/**
 * 남은 날 = 한국 날짜로 끝 날 - 오늘(초대코드 만료 표시 inviteExpiry 와 같은 규칙). 0 = 오늘 끝난다("오늘까지").
 * 이미 끝났거나 읽지 못하면 null. 화면마다 따로 세지 않는다(2026-11-13 A-2: 올림·버림이 섞여 같은 링크가 7일·6일로 보였다).
 */
export function daysLeft(expiresAt: string, now = Date.now()): number | null {
  const t = new Date(expiresAt).getTime();
  if (!(t > now)) return null;
  return kstDayNo(t) - kstDayNo(now);
}

/** 만든 시각 + n일. S11 기간 늘리기가 고르는 끝 시각이다(서버 상한 = 만든 시각 + 30일). */
export function createdPlusDays(createdAt: string, days: number): string {
  return new Date(new Date(createdAt).getTime() + days * DAY_MS).toISOString();
}

/** 기간 고르기 칸(일). 기본 7, 상한 30. */
export const EDU_LINK_DAY_OPTIONS = [7, 14, 30] as const;
