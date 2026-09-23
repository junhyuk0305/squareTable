// copy.ts — "이 노하우가 본사 사본인가"를 묻는 술어 **한 곳**(0216 컬럼 5개의 해석 SSOT).
//
// 왜 여기 모으나(AGENTS ②): 사본 배지·'원본에서 수정됨'·'새 버전 있음'·숨김 제외는 노하우가 그려지는
// 곳마다 필요하다(노하우 목록·매뉴얼 뷰·업무 첨부·퀴즈 출제·AI 서빙 후보). 화면마다 `!!e.brand_entry_id`
// 를 직접 쓰면 한 곳만 빠져도 숨긴 노하우가 퀴즈에 나가거나 사본이 매장 것으로 보인다.
//
// ★서버 쪽 SSOT 는 `match_playbook`(0217)의 `brand_hidden_at is null` 이다 — 의미검색·AI 답변은 거기서 빠진다.
//   여기 술어는 **클라가 고르는 목록**(퀴즈 후보·첨부 후보)에서 같은 것을 빼는 짝이다. 둘이 같은 뜻이어야 한다.
import type { PlaybookEntry } from '@/types';

/** 0216 컬럼만 보는 최소 모양 — 전체 PlaybookEntry 가 아니어도 판정된다(표 행·요약 행). */
export type BrandCopyFields = Pick<
  PlaybookEntry,
  'brand_entry_id' | 'brand_version' | 'brand_pending_version' | 'local_modified_at' | 'brand_hidden_at'
>;

/** 본사가 내려준 사본인가. false = 매장이 직접 쓴 노하우(미연결 매장의 **모든** 행). */
export const isBrandCopy = (e: BrandCopyFields): boolean => !!e.brand_entry_id;

/** 점주가 이 매장에서 숨겼나. 검색·AI·퀴즈에서 빠진다(내용 갱신은 계속 받는다 — 정본 §4-B). */
export const isBrandHidden = (e: BrandCopyFields): boolean => !!e.brand_hidden_at;

/** 점주가 본문을 고쳤나 → 카드에 "원본에서 수정됨". 재배포 때 자동 갱신되지 않는다. */
export const isBrandModified = (e: BrandCopyFields): boolean => isBrandCopy(e) && !!e.local_modified_at;

/** 고친 사본에 새 버전이 왔나 → 카드에 "새 버전 있음" + 교체/유지 시트. */
export const hasBrandPending = (e: BrandCopyFields): boolean => isBrandCopy(e) && e.brand_pending_version != null;

/**
 * 검색·AI·퀴즈·첨부 **후보**에서 숨긴 사본을 뺀다. 목록 화면은 이걸 쓰지 않는다 —
 * 점주가 숨긴 것을 되살리려면 목록에서는 보여야 한다(숨김 배지와 함께).
 */
export const servable = <T extends BrandCopyFields>(entries: T[]): T[] => entries.filter((e) => !isBrandHidden(e));

/** 카드 배지 문구 — 세 곳(노하우 목록·매뉴얼·퀴즈)이 같은 말을 쓴다. */
export const BRAND_BADGE = '본사';
export const BRAND_MODIFIED_BADGE = '원본에서 수정됨';
export const BRAND_PENDING_BADGE = '새 버전 있음';
export const BRAND_HIDDEN_BADGE = '숨김';
