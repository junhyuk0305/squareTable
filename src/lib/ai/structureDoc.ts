// 인수인계서 대량 추출 오케스트레이터 — 청크별 structureSquare 순차 호출 + 증분 저장(체크포인트).
// 설계: 인수인계서_노하우_고도화_설계논의_2026-07-08.md §5d.
//  - 왜 클라 순차인가: Edge 한 콜 안 루프는 12초 타임아웃·전부아니면전무(AWS 서버리스 안티패턴).
//    클라 순차는 진행바·실패 청크만 재시도·레이트리밋 페이싱이 자연스럽다. async 잡큐는 V2.
//  - 왜 증분 저장인가: 청크 완료마다 draft 저장 → 앱을 닫아도 추출분 생존(형 결정: 체크포인트 채택).
//  - 왜 strict인가: mock 폴백 결과가 draft로 저장되면 가짜 노하우 무음 오염 → 실패는 실패로 처리.

import { structureSquareStrict } from './client';
import type { StructuredSegment } from './types';
import { isSquarePublishable } from '@/lib/utils/buildEntry';
import type { DocChunk } from '@/lib/import/chunk';

export type DocProgress = {
  /** 처리 끝난 청크 수(성공+무수확+실패 포함). */
  done: number;
  total: number;
  /** 지금까지 draft로 저장된 노하우 수. */
  saved: number;
  /** 레이트리밋(429) 대기 중 여부 — 진행바에 "잠시 대기 중" 표시용. */
  waiting: boolean;
};

const MAX_CHUNK_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_500;      // 일반 실패 백오프(×시도수)
const RATE_WAIT_MS = 32_000;      // 429 대기 — edge 분당 창(사용자 10콜/분)이 넘어가길 기다림
const MIN_CALL_SPACING_MS = 5_500; // 선제 페이싱 — 콜 시작 간격을 벌려 429 자체를 회피(10콜/분≈6초)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimited = (e: unknown) => e instanceof Error && /failed: 429/.test(e.message);

/**
 * 청크들을 순차로 구조화하고, 청크가 끝날 때마다 persistChunk로 즉시 저장한다.
 * persistChunk가 던지면(스키마 미적용·연결 단절 등 저장 계층 고장) 파이프 전체를 중단한다 —
 * 이미 저장된 draft는 그대로 남으므로(체크포인트) 재진입 시 이어서 검수할 수 있다.
 */
export async function structureDoc(opts: {
  storeId: string;
  chunks: DocChunk[];
  categoryGuide: string;
  /** 발행 가능 세그들을 저장하고 저장 "성공" 수를 반환. */
  persistChunk: (chunk: DocChunk, segs: StructuredSegment[]) => Promise<number>;
  onProgress?: (p: DocProgress) => void;
}): Promise<{ saved: number; failedChunks: number; emptyChunks: number }> {
  const { storeId, chunks, categoryGuide, persistChunk, onProgress } = opts;
  let saved = 0;
  let failedChunks = 0;
  let emptyChunks = 0;
  let lastCallAt = 0;
  const report = (done: number, waiting = false) =>
    onProgress?.({ done, total: chunks.length, saved, waiting });

  report(0);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // 선제 페이싱 — LLM 응답이 빨랐던 콜 뒤엔 간격을 채워 분당 한도 안에서 순항.
    const since = Date.now() - lastCallAt;
    if (lastCallAt && since < MIN_CALL_SPACING_MS) await sleep(MIN_CALL_SPACING_MS - since);

    // 청크 1개 구조화 — 실패는 이 청크만 재시도(성공분·다른 청크에 영향 없음).
    let segs: StructuredSegment[] | null = null;
    for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
      lastCallAt = Date.now();
      try {
        const out = await structureSquareStrict({ storeId, rawText: chunk.text, categoryGuide });
        if (out.usable === false) { segs = []; break; } // 운영 내용 아님 — 재시도 무의미
        let pub = (out.segments ?? []).filter((s) => isSquarePublishable(s.square));
        // 단일 노하우면 segments 없이 top-level square로 올 수 있다(coach·기존 handover와 동일 계약).
        if (pub.length === 0 && out.square && isSquarePublishable(out.square)) {
          pub = [{
            category: out.segments?.[0]?.category ?? 'Routine',
            title: out.title || chunk.text.slice(0, 30),
            keywords: out.keywords ?? [],
            square: out.square,
          }];
        }
        segs = pub;
        break;
      } catch (e) {
        if (attempt >= MAX_CHUNK_ATTEMPTS) break; // segs=null → 실패 청크
        if (isRateLimited(e)) { report(i, true); await sleep(RATE_WAIT_MS); }
        else await sleep(RETRY_BASE_MS * attempt);
      }
    }

    if (segs === null) failedChunks++;
    else if (segs.length === 0) emptyChunks++;
    else saved += await persistChunk(chunk, segs); // 저장 실패(throw)는 위로 전파 → 파이프 중단

    report(i + 1);
  }
  return { saved, failedChunks, emptyChunks };
}
