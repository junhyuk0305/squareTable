// lib/ai/types.ts
// AI 레이어 입출력 계약. DB 스키마와 독립 — 여기서 쓰는 건 얇은 SopSlice 뿐.
// 스키마가 바뀌어도 adapter.ts 한 겹만 고치면 됨.

import type { Category, ResponseBlock, SquareBlock } from '@/types';

// AI가 답변 생성에 필요로 하는 "최소 SOP 조각". PlaybookEntry 전체가 아님.
export type SopSlice = {
  id: string;
  title: string;
  category: string;
  situation: string;   // square.situation
  steps: string[];     // square.action.steps
  donts: string[];     // square.extract.dont → 배열화
  scripts?: string[];  // square.action.scripts
  creatorName: string;
  version: number;
  updatedAt: string;
};

// ── 주니어 답변 생성 (하이브리드 중간 밴드) ──────────────────
export type GenerateAnswerInput = {
  storeId: string;       // 격리 단위 — 이 매장 SOP만 들어와야 함
  query: string;
  sops: SopSlice[];      // 검색된 top-K 후보 (이 안에서만 답을 만든다 = 그라운딩)
};

export type GenerateAnswerOutput = {
  block: ResponseBlock | null;   // 근거 부족 시 null → 호출부가 사장님 라우팅
  grounded: boolean;             // 제공된 SOP에만 근거했는가
  usedSopIds: string[];          // 실제 인용한 SOP id (출처 바인딩)
};

// ── 사장님 SQUARE 정리 (원문 → 6칸 구조화) ───────────────────
export type StructureSquareInput = {
  storeId: string;
  rawText: string;               // 사장 음성 전사 또는 직접 입력 원문
  category?: Category;
};

export type StructureSquareOutput = {
  square: SquareBlock;
  title: string;
  keywords: string[];
};

export type { ResponseBlock, SquareBlock };
