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
  degraded?: boolean;            // AI 서버 실패로 기본(mock) 답으로 폴백했는가 → 사용자에 고지
};

// ── 사장님 SQUARE 정리 (원문 → 6칸 구조화) ───────────────────
export type StructureSquareInput = {
  storeId: string;
  rawText: string;               // 사장 음성 전사 또는 직접 입력 원문
  category?: Category;
  categoryGuide?: string;  // 카테고리별 추출 지침(프롬프트 주입용). 클라가 src/data/category-guides.ts의 extractionGuide를 실어 보냄.
  skipFollowups?: boolean; // 재정리(2차) 패스 — followups 재생성 안 함(무한 되묻기 방지).
};

// ── 노하우 수정(대화형 patch) ────────────────────────────────
// 현재 SQUARE를 사장 수정요청대로 부분 패치. 출력은 StructureSquareOutput과 동형(단일).
export type PatchSquareInput = {
  storeId: string;
  instruction: string;           // 사장의 자연어 수정 요청 ("청소 단계에 행주 삶기 추가")
  current: {                     // 현재 노하우 스냅샷(보존 기준)
    title: string;
    category: Category;
    situation: string;
    steps: string[];
    scripts: string[];
    dont: string;
  };
  categoryGuide?: string;
};

// ── 의도추출(답변 경로 재검색용) ─────────────────────────────
export type IntentInput = { query: string };
export type IntentOutput = { rewritten: string; keywords: string[] };

// 주관적 기준 입력 요청. AI가 노하우에서 감지 시 채우고, 클라가 종류(kind)에 맞는 컨트롤을 띄운다.
//  - spectrum: 양끝(ends) 사이 위치(굽기·농도·간·온도·완성도 등 1차원 정도)
//  - count:    개수 + 단위(unit) (펌프·샷·번·장 등 셀 수 있는 양)
// 양끝 라벨·단위·질문 문구는 AI가 그 노하우에 맞게 생성한다(품목 일반화).
export type ScalePrompt = {
  label: string;                 // 기준 이름 ("닭 익힘 기준", "시럽 양")
  ask: string;                   // 질문 문구
  kind?: 'spectrum' | 'count';   // 없으면 클라가 spectrum으로 간주
  ends?: [string, string];       // spectrum 양끝 (예: ["덜 익음","바싹"])
  unit?: string;                 // count 단위 (예: "펌프")
  min?: number;                  // (구버전 호환, 미사용)
  max?: number;
};

// AI가 생성한 맞춤 꼬리질문(단답·모호 보강용). cell은 답이 들어갈 칸 힌트(클라 표시·placeholder용).
export type AiFollowup = {
  ask: string;
  cell?: 'situation' | 'steps' | 'scripts' | 'dont';
};

// 분리된 노하우 1조각. 한 발화에 성격 다른 노하우가 여럿이면 AI가 여러 segment로 나눈다.
export type StructuredSegment = {
  category: Category;
  title: string;
  keywords: string[];
  square: SquareBlock;
  scalePrompt?: ScalePrompt;
  followups?: AiFollowup[];
};

export type StructureSquareOutput = {
  square: SquareBlock;
  title: string;
  keywords: string[];
  usable?: boolean;           // false면 원문이 노하우가 아님(잡음·잡담·테스트) → 클라가 카드 대신 되묻기
  scalePrompt?: ScalePrompt;  // 있으면 클라가 슬라이더로 필수 되물어 square.standard에 저장
  followups?: AiFollowup[];   // AI 맞춤 꼬리질문(단답·모호 보강). 클라가 순서대로 되물음.
  // 다중 노하우 감지 결과. 단일이면 length 1(또는 생략). length≥2면 클라가 분리 제안.
  // 호환: square/title/keywords/scalePrompt 는 항상 segments[0] 와 동일(단일 흐름 무변경).
  segments?: StructuredSegment[];
  degraded?: boolean;            // AI 서버 실패로 기본(mock) 정리로 폴백했는가 → 사용자에 고지
};

export type { ResponseBlock, SquareBlock };
