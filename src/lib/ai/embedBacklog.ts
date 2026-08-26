// lib/ai/embedBacklog.ts — 색인 대기분 재시도 러너(0181).
//
// 왜 있나:
//   색인(임베딩)은 지금까지 **한 번 실패하면 영영 끝**이었다. embedEntry() 가 3회 시도 후 포기하면
//   그 노하우는 의미검색에서 영구히 빠지는데 사장은 검색되는 줄 안다(감사 #15). 허브에서 다른 매장에
//   쓰는 서버 경로(owner_insert_knowhow)는 색인을 아예 만들지 않았다(#16).
//   0181 이 두 경로를 모두 "색인 대기"(playbook_embeddings.next_attempt_at)로 남기게 했고,
//   이 파일이 그 대기를 **소진하는 쪽**이다. 등록만 하고 소진하는 쪽이 없으면 프로세스가 안 닫힌다.
//
// 누가 언제 부르나:
//   매장 앱 진입 시 1회(owner/_layout.tsx). 사람이 앱을 열어야 소진된다는 한계가 있지만,
//   매장 노하우는 그 매장 사람만 검색하므로 "그 매장 사람이 앱을 열 때 채워진다"로 충분하다.
//
// 안전:
//   - 조회·쓰기 모두 RLS(playbook_embeddings_rw: unit_id = auth_unit_id())를 탄다 → 내 매장 대기만 보인다.
//   - 배치 상한(BATCH)·건당 간격(PACE_MS)으로 앱 진입 직후 임베딩 폭주를 막는다.
//   - 전 구간 실패 관대: 재시도가 실패해도 앱 동작에 영향이 없어야 한다(부수 작업).

import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/analytics/track';
import { embedEntry } from './searchClient';
import { USE_MOCK } from './config';
import type { PlaybookEntry } from '@/types';

// 한 번 진입에 최대 몇 건까지 밀어낼지. 대기가 많이 쌓여도 앱 진입이 무거워지면 안 된다 —
// 남은 건 다음 진입 때 이어서 소진한다(대기 표시는 성공할 때까지 남으므로 유실되지 않는다).
const BATCH = 5;
const PACE_MS = 300; // 건당 간격(엣지·Gemini 레이트리밋 보호)

// 실패 백오프 — 5분에서 시작해 시도할 때마다 2배, 24시간에서 멈춘다.
// ★상한을 두되 "포기"는 없다. 영영 포기하는 것이 원래의 결함이었다.
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 24 * 60 * 60_000;
const backoffMs = (attempts: number) => Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);

/** 색인 대기분을 최대 BATCH 건 재시도한다. 반환값은 {시도, 성공} — QA·계측용.
 *  @param entries 현재 매장의 노하우(스토어 보유분). 본문을 다시 받아오지 않으려고 넘겨받는다.
 *         대기 행에 대응하는 본문이 여기 없으면(초안 전환·삭제 등) 그 건은 건너뛴다. */
export async function retryPendingEmbeddings(entries: PlaybookEntry[]): Promise<{ tried: number; ok: number }> {
  if (USE_MOCK) return { tried: 0, ok: 0 };

  const { data, error } = await supabase
    .from('playbook_embeddings')
    .select('entry_id, attempts')
    .not('next_attempt_at', 'is', null)
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH);
  if (error) {
    reportError('search.embed.backlogReadFailed', error);
    return { tried: 0, ok: 0 };
  }
  if (!data?.length) return { tried: 0, ok: 0 };

  const byId = new Map(entries.map((e) => [e.id, e]));
  let tried = 0;
  let ok = 0;

  for (const row of data) {
    const entry = byId.get(row.entry_id);
    // 본문이 스토어에 없다 = 이 매장 발행분이 아니다(초안으로 되돌렸거나 삭제됐다).
    // 대기 표시를 지운다 — 안 지우면 매 진입마다 같은 행을 붙잡고 배치를 다 써버린다.
    if (!entry || entry.status !== 'published') {
      await clearPending(row.entry_id);
      continue;
    }
    tried++;
    // markPending=false — 이미 대기 행이 있고, 다시 찍으면 백오프 누적이 초기화된다.
    const done = await embedEntry(entry, false);
    if (done) ok++;
    else await pushBackoff(row.entry_id, (row.attempts ?? 0) + 1);
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
  return { tried, ok };
}

/** 색인 대상이 아니게 된 대기 행 정리(벡터는 그대로 둔다 — 다시 발행되면 유효하다). */
async function clearPending(entryId: string): Promise<void> {
  const { error } = await supabase
    .from('playbook_embeddings')
    .update({ next_attempt_at: null })
    .eq('entry_id', entryId);
  if (error) reportError('search.embed.backlogClearFailed', error, { entryId });
}

/** 실패한 건의 다음 시도 시각을 뒤로 민다. 실패 사유를 남겨 무엇이 막고 있는지 보이게 한다. */
async function pushBackoff(entryId: string, attempts: number): Promise<void> {
  const { error } = await supabase
    .from('playbook_embeddings')
    .update({
      attempts,
      last_error: `재시도 ${attempts}회 실패`,
      next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
    })
    .eq('entry_id', entryId);
  if (error) reportError('search.embed.backoffFailed', error, { entryId });
}
