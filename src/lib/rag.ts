// lib/rag.ts
// 스퀘어테이블 데모용 한국어 RAG 모킹 (벡터DB·형태소분석기 無, 순수 TS)
// 알고리즘: search_keywords(1.0) + title n-gram(0.6) + tags(0.4) 가중 합산 → 시그모이드 정규화

import type { PlaybookEntry, SearchResult } from '@/types';

// ── 0. 전처리 ────────────────────────────────────────────────────────────────
// 한국어 어미·조사를 어림으로 제거. 형태소 분석기 안 쓰고 어림 stem.
// 가장 긴 패턴이 먼저 매칭되도록 모듈 로드 시 1회만 정렬(핫패스에서 재정렬 금지).
const TAIL_PATTERNS = [
  "달래요", "해달래요", "라는데요", "라던데요",
  "었어요", "았어요", "였어요", "이에요", "예요",
  "거든요", "잖아요", "는데요", "는데", "는거", "는 거",
  "어요", "아요", "해요", "이요", "에요",
  "어서", "아서", "해서",
  "라고", "다고", "이라고",
  "이/가", "을/를", "은/는",
  "요", "다", "임",
].sort((a, b) => b.length - a.length);

function stem(s: string): string {
  let cur = s.trim().toLowerCase();
  // 끝부분 어미 한 번만 절단(가장 긴 패턴 우선)
  for (const t of TAIL_PATTERNS) {
    if (cur.endsWith(t) && cur.length - t.length >= 2) {
      cur = cur.slice(0, cur.length - t.length);
      break;
    }
  }
  return cur;
}

// 토큰화·타이틀 정규화 공용 구두점 패턴. (.replace는 매 호출 lastIndex를 리셋하므로 /g 공유 안전)
const PUNCT = /[?!.,~\-—_/()\[\]{}'"·…:;]/g;

// 공백·구두점 기준 토큰화 (한국어 어절 단위)
function tokenize(s: string): string[] {
  return s
    .replace(PUNCT, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

// 문자 단위 n-gram (한글은 음절 한 글자가 의미 단위라 2-gram이 효과적)
function ngrams(s: string, n: number): Set<string> {
  const clean = s.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + n <= clean.length; i++) out.add(clean.slice(i, i + n));
  return out;
}

// ── 1. 키워드 매칭 (가중치 1.0) ─────────────────────────────────────────────
// 양방향 substring + stemmed 토큰 비교. keyword 1개당 최대 1점.
function scoreKeywords(query: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const qStem = stem(query);
  const qTokens = tokenize(query).map(stem);
  let hits = 0;

  for (const kwRaw of keywords) {
    const kw = stem(kwRaw);
    if (kw.length === 0) continue;
    // (a) keyword 전체가 query에 substring (가장 강한 신호)
    if (qStem.includes(kw) || query.includes(kwRaw)) {
      hits += 1;
      continue;
    }
    // (b) query 토큰 중 하나가 keyword에 substring (또는 역방향) — 부분점수 0.7
    let partial = 0;
    for (const qt of qTokens) {
      if (qt.length < 2) continue;
      if (kw.includes(qt) || qt.includes(kw)) {
        partial = Math.max(partial, 0.7);
      }
    }
    hits += partial;
  }
  // 단일 entry 안에서 누적 hit 수를 점수화. log 압축으로 keyword 많은 entry 패널티 회피.
  return Math.log2(1 + hits);
}

// ── 2. 타이틀 n-gram 매칭 (가중치 0.6) ───────────────────────────────────────
function scoreTitle(query: string, title: string): number {
  const cleanTitle = title.replace(PUNCT, " ");
  const q2 = ngrams(query, 2);
  const q3 = ngrams(query, 3);
  const t2 = ngrams(cleanTitle, 2);
  const t3 = ngrams(cleanTitle, 3);
  if (t2.size === 0) return 0;
  let inter2 = 0;
  for (const g of q2) if (t2.has(g)) inter2++;
  let inter3 = 0;
  for (const g of q3) if (t3.has(g)) inter3++;
  // 2-gram은 title 크기로 정규화, 3-gram은 보너스
  const ratio = inter2 / t2.size + (inter3 > 0 ? 0.3 * (inter3 / Math.max(t3.size, 1)) : 0);
  return ratio;
}

// ── 3. 태그 매칭 (가중치 0.4) ────────────────────────────────────────────────
function scoreTags(query: string, tags: string[]): number {
  if (tags.length === 0) return 0;
  const qStem = stem(query);
  let hits = 0;
  for (const tRaw of tags) {
    const t = tRaw.replace(/^#/, "").trim();
    if (t.length === 0) continue;
    if (qStem.includes(t) || query.includes(t)) hits++;
  }
  return Math.log2(1 + hits);
}

// ── 4. 최종 결합 + 시그모이드 정규화 ────────────────────────────────────────
const W_KW = 1.0;
const W_TITLE = 0.6;
const W_TAGS = 0.4;

function combinedScore(query: string, e: PlaybookEntry): number {
  const sKw = scoreKeywords(query, e.search_keywords || []);
  const sTitle = scoreTitle(query, e.title || "");
  const sTags = scoreTags(query, e.tags || []);
  return W_KW * sKw + W_TITLE * sTitle + W_TAGS * sTags;
}

// raw 합산값을 0~1로 짓누름. k=1.0에서 raw≈1.6 → confidence 0.6 근처.
// (k는 데모 시나리오 8건에 대해 매칭/실패 분리가 깨끗하게 떨어지도록 튜닝됨)
function normalize(raw: number, k = 1.0): number {
  if (raw <= 0) return 0;
  return raw / (raw + k);
}

// ── 5. Public API ────────────────────────────────────────────────────────────
export function searchPlaybook(
  query: string,
  entries: PlaybookEntry[],
  options?: { threshold?: number; topK?: number }
): SearchResult {
  const threshold = options?.threshold ?? 0.6;
  const topK = options?.topK ?? 3;

  if (!query || query.trim().length === 0 || entries.length === 0) {
    return { matched: null, confidence: 0, candidates: [], fallbackToUnknown: true };
  }

  const scored = entries.map(entry => ({
    entry,
    rawScore: combinedScore(query, entry),
  }));
  scored.sort((a, b) => b.rawScore - a.rawScore);

  const top = scored.slice(0, topK).map(s => ({
    entry: s.entry,
    score: Number(normalize(s.rawScore).toFixed(3)),
  }));
  const bestRaw = scored[0]?.rawScore ?? 0;
  const confidence = Number(normalize(bestRaw).toFixed(3));
  const fallback = confidence < threshold;

  return {
    matched: fallback ? null : scored[0].entry,
    confidence,
    candidates: top,
    fallbackToUnknown: fallback,
  };
}
