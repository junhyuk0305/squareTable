// lib/ai/searchClient.ts
// 하이브리드 검색: 렉시컬(로컬 rag.ts) + 벡터(서버 pgvector via Edge)를 RRF로 융합.
// 설계: 노하우검색_고도화_v1.md
//
//  - USE_MOCK(키 없음/오프라인) → 기존 렉시컬 searchPlaybook 그대로 (데모 보존).
//  - 실호출 → 렉시컬은 클라에서, 벡터는 Edge(task:'search')에서 받아 RRF 순위 융합.
//  - 서버 실패 시 렉시컬로 graceful 폴백(검색이 멈추지 않게).
//  - 신뢰도 = max(렉시컬 정규화, 벡터 cosine) — 둘 다 0~1. 강한 신호 채택.
//    (벡터 cosine 임계값은 파일럿 점수 분포로 재보정: 설계 D8)

import type { PlaybookEntry, SearchResult } from '@/types';
import { searchPlaybook } from '@/lib/rag';
import { getCategoryMeta } from '@/lib/utils/category';
import {
  SERVE_THRESHOLD, USE_MOCK, AI_ENDPOINT, ANON,
  SERVE_REQUIRE_LEXICAL_AGREEMENT, SERVE_LEX_MIN, SERVE_LEX_MARGIN, SERVE_VEC_OVERRIDE,
} from './config';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/analytics/track';

const RRF_K = 60; // RRF 상수(표준값). 순위만 쓰므로 점수 스케일 불일치에 견고.
const TOPK = 8;

// 무한 대기 방지 — Edge/Gemini가 응답 없이 멈춰도 이 시간을 넘기면 abort → 렉시컬 폴백/재시도로
// 넘어간다(client.ts callEdge와 동일 정책). 이게 없으면 검색 스피너가 영영 안 풀린다.
const EDGE_TIMEOUT_MS = 12_000;

type VecHit = { id: string; similarity: number };
type VecResponse = { candidates: VecHit[]; topSimilarity: number };

// Edge 호출 공통 헤더(실 로그인 세션 토큰 필요 — anon 단독 거부됨).
// 계약: 소프트 no-go(엔드포인트/토큰 없음·!res.ok)면 null, 네트워크/타임아웃(abort)이면 throw
// → 호출부(hybridSearch·embedEntry)가 각각 렉시컬 폴백/재시도로 처리한다.
// ★소프트 실패도 **왜** 실패했는지 남긴다(2026-08-25 감사 #15·#28).
//   예전엔 이 세 경로(엔드포인트 없음·토큰 없음·!res.ok)가 전부 말없이 null 이었고,
//   reportError 는 catch(네트워크) 안에만 있었다. 그래서 엣지의 forbidden·embed_read·embed_write 와
//   **모델 퇴역 404 가 통째로 이 구멍으로 빠져나갔다** — 의미검색이 꺼져도 신호가 0이었다.
//   실측(2026-08-25): 발행 노하우 321건 대비 색인 124건 = **197건(61%)이 미색인**이었는데
//   그 사실을 알려주는 신호가 어디에도 없었다. 반환 계약(null=소프트)은 그대로 두고 계측만 붙인다.
async function edgePost<T>(task: 'search' | 'embed', payload: unknown): Promise<T | null> {
  if (!AI_ENDPOINT) return null; // 설정상 비활성 — 장애가 아니므로 계측 대상 아님
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    reportError(`search.${task}.noToken`, { message: '세션 토큰 없음 — 엣지 호출 불가' });
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EDGE_TIMEOUT_MS);
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ task, payload }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 본문에 엣지의 사유(forbidden·embed_read·embed_write·모델 404)가 담겨 온다 — 그걸 남긴다.
      const body = await res.text().catch(() => '');
      reportError(`search.${task}.notOk`, { message: `HTTP ${res.status} ${body.slice(0, 200)}` });
      return null;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 하이브리드 검색. 반환 타입은 기존 SearchResult 와 동형 → useChatStore 밴드 로직 무변경.
 */
export async function hybridSearch(query: string, entries: PlaybookEntry[]): Promise<SearchResult> {
  // mock/오프라인 — 기존 렉시컬. 데모 '검색 중' 느낌만 약간(실호출 경로엔 인위 지연 없음).
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 550));
    return searchPlaybook(query, entries);
  }

  const lexical = searchPlaybook(query, entries, { topK: TOPK });

  let vec: VecResponse | null = null;
  try {
    vec = await edgePost<VecResponse>('search', { query });
  } catch (e) {
    // 의미검색(pgvector) 다운 → 렉시컬로 조용히 열화되던 걸 계측(팀이 의미검색 장애를 볼 수 있게).
    console.warn('[search] vector path failed, lexical fallback:', e);
    reportError('search.vector.degraded', e);
  }
  if (!vec || !Array.isArray(vec.candidates)) return lexical; // 서버 실패 → 렉시컬 폴백

  // ── RRF 융합 (순위 기반) ──
  const byId = new Map(entries.map((e) => [e.id, e]));
  const lexRank = new Map<string, number>();
  lexical.candidates.forEach((c, i) => lexRank.set(c.entry.id, i));
  const vecRank = new Map<string, number>();
  vec.candidates.forEach((c, i) => vecRank.set(c.id, i));

  const ids = new Set<string>([...lexRank.keys(), ...vecRank.keys()]);
  const fused = [...ids]
    .map((id) => {
      let s = 0;
      const lr = lexRank.get(id);
      const vr = vecRank.get(id);
      if (lr !== undefined) s += 1 / (RRF_K + lr);
      if (vr !== undefined) s += 1 / (RRF_K + vr);
      return { id, s };
    })
    .sort((a, b) => b.s - a.s);

  const candidates = fused
    .map((f) => {
      const e = byId.get(f.id);
      return e ? { entry: e, score: Number(f.s.toFixed(4)) } : null;
    })
    .filter((x): x is { entry: PlaybookEntry; score: number } => x !== null)
    .slice(0, TOPK);

  // 신뢰도 = 렉시컬 정규화 vs 벡터 cosine 중 강한 신호.
  const confidence = Number(Math.max(lexical.confidence, vec.topSimilarity ?? 0).toFixed(3));

  // ── SERVE 그라운딩 게이트 ──
  // 자동 확정 답(matched)은 융합 1등이 렉시컬 1등과 일치 + 근거·마진 충분할 때만.
  // 그렇지 않으면(근거0/동점 애매) matched=null → useChatStore가 confidence≥GENERATE면
  // tryGenerate로 넘겨 여러 노하우 종합("AI가 정리한 답")으로 응답한다. (config.ts 설계)
  const topId = candidates[0]?.entry.id;
  const lexTopEntryId = lexical.candidates[0]?.entry.id;
  const lexScoreOfTop = topId ? (lexical.candidates.find((c) => c.entry.id === topId)?.score ?? 0) : 0;
  const lexMargin = (lexical.candidates[0]?.score ?? 0) - (lexical.candidates[1]?.score ?? 0);
  const vecMargin = (vec.candidates[0]?.similarity ?? 0) - (vec.candidates[1]?.similarity ?? 0);
  const grounded =
    !SERVE_REQUIRE_LEXICAL_AGREEMENT ||
    (topId != null && topId === lexTopEntryId && lexScoreOfTop >= SERVE_LEX_MIN && lexMargin >= SERVE_LEX_MARGIN) ||
    vecMargin >= SERVE_VEC_OVERRIDE;

  const matched = confidence >= SERVE_THRESHOLD && grounded ? candidates[0]?.entry ?? null : null;
  return { matched, confidence, candidates, fallbackToUnknown: !matched };
}

// ── 색인(임베딩) ────────────────────────────────────────────
/** 임베딩 대상 텍스트 — 제목·카테고리·상황·단계·금지·키워드를 합친다(한국어 일관).
 *  섹션이 있으면 맨 앞에 "[오픈]"처럼 프리펜드(Contextual Retrieval, 설계 §5d) —
 *  원자 노하우의 유일한 약점(문서 맥락 상실)을 색인 텍스트에 되살려 검색 실패를 줄인다. */
export function buildEmbedText(e: PlaybookEntry): string {
  const sq = e.square;
  return [
    e.section ? `[${e.section}] ${e.title}` : e.title,
    getCategoryMeta(e.category).label,
    sq.situation,
    sq.action?.steps?.join(' '),
    sq.extract?.dont,
    (e.search_keywords ?? []).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

/** 노하우 발행/수정 후 임베딩 색인(파이어앤포겟). 실패해도 발행은 성공·렉시컬로 검색됨.
 *  색인은 의미검색 품질에 직결 → 일시적 실패(Edge 콜드스타트·네트워크 순단)면 짧게 백오프 후 재시도.
 *
 *  ★0181: 3회가 다 실패해도 **끝이 아니다.** 시도 전에 playbook_embeddings 에 "색인 대기"를 먼저
 *  남기고(next_attempt_at), 성공하면 엣지가 그 표시를 지운다. 실패해서 표시가 남으면 다음 앱 진입 때
 *  embedBacklog.retryPendingEmbeddings() 가 주워서 다시 시도한다 — 이게 없던 게 프로세스 결함이었다
 *  (감사 #15: 실패한 노하우는 의미검색에서 영영 빠지는데 사장은 검색되는 줄 알았다).
 *
 *  @param markPending 대기 표시를 새로 남길지. 재시도 러너는 이미 대기 행을 들고 있으므로 false —
 *         true 로 부르면 백오프 계산에 쓰는 next_attempt_at 을 매번 now() 로 되돌려 백오프가 안 늘어난다.
 *  @returns 색인 성공 여부(러너가 이걸로 실패 백오프를 갱신한다).
 */
export async function embedEntry(e: PlaybookEntry, markPending = true): Promise<boolean> {
  if (USE_MOCK) return true;
  // 발행 상태만 색인(초안은 검색에서 제외되므로 불필요).
  if (e.status !== 'published') return true;

  if (markPending) await markEmbedPending(e);

  const payload = { entryId: e.id, text: buildEmbedText(e) };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await edgePost('embed', payload);
      if (res !== null) return true; // 색인 성공 — 대기 표시는 엣지가 지웠다
      // ★가장 흔한 실패 경로가 여기였다(#15): 소프트 실패(null)는 throw 를 안 하므로 아래 catch 를
      //   타지 않고, 3회를 다 돌고 **아무 것도 안 한 채 반환**했다. 그래서 미색인 노하우가 쌓여도
      //   계측이 0건이었다. 마지막 시도까지 null 이면 실패로 보고한다(대기 표시는 남는다).
      if (attempt === 3) {
        reportError('search.embed.failed', { message: '3회 모두 소프트 실패(null)' }, { entryId: e.id });
        return false;
      }
    } catch (err) {
      if (attempt === 3) {
        console.warn('[search] embed failed after 3 tries (대기로 남김):', err);
        reportError('search.embed.failed', err, { entryId: e.id });
        return false;
      }
    }
    // 마지막 시도가 아니면 백오프(0.6s → 1.2s) 후 재시도.
    if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
  }
  return false;
}

/** 색인 대기 표시. 성공하면 엣지(handleEmbed)가 next_attempt_at 을 지운다.
 *  ★embedding 컬럼은 건드리지 않는다 — 수정 재색인 때 낡은 벡터라도 남아 있어야
 *  재색인이 끝날 때까지 그 노하우가 의미검색에서 사라지지 않는다(0181 헤더 참조).
 *  ★attempts 도 건드리지 않는다 — 러너의 백오프 누적이 초기화되면 안 된다.
 *  실패해도 조용히 넘어간다: 대기 등록에 실패했다고 발행이 막히면 안 된다. */
async function markEmbedPending(e: PlaybookEntry): Promise<void> {
  const { error } = await supabase
    .from('playbook_embeddings')
    .upsert({ entry_id: e.id, unit_id: e.unit_id, next_attempt_at: new Date().toISOString() }, { onConflict: 'entry_id' });
  if (error) reportError('search.embed.pendingMarkFailed', error, { entryId: e.id });
}
