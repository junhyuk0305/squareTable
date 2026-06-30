// 모든 타입 단일 진입점

export type Category = 'Routine' | 'Event' | 'Context' | 'Know-how';

// ── User ───────────────────────────────────────────────
export type Role = 'owner' | 'junior';

export type User = {
  id: string;
  name: string;
  role: Role;
  age: number;
  phone_last4: string;
  unit_id: string;
  avatar?: string;
  bio?: string;
  joined_at: string;
};

export type Owner = User & {
  role: 'owner';
  career_years: number;
  voice_recordings_count?: number;
};

export type Junior = User & {
  role: 'junior';
  career_days: number;
  shift?: string;
};

// ── PlaybookEntry ─────────────────────────────────────
export type SquareBlock = {
  situation: string;
  quagmire: string;
  uncover: string;
  action: {
    steps: string[];
    scripts: string[];
  };
  result: {
    before: string;
    after: string;
    metric: string;
  };
  extract: {
    do: string;
    dont: string;
    template?: string;
  };
  // 주관적 기준(굽기·농도·간·양 등). AI가 정도성/개수성을 감지하면 사장이 전용 컨트롤로 답함.
  // kind=spectrum: 양끝 라벨(ends) 사이 위치(value 0~max) / kind=count: 개수(value) + 단위(unit).
  // 구버전 호환: kind 없으면 0~100 게이지로 표시.
  standard?: {
    kind?: 'spectrum' | 'count';
    label: string;            // "닭 익힘 기준", "시럽 양" 등
    value: number;            // spectrum: 0~max 위치 / count: 개수
    max?: number;             // spectrum 분모(기본 100)
    ends?: [string, string];  // spectrum 양끝 라벨 (AI 생성) 예: ["덜 익음","바싹"]
    unit?: string;            // count 단위 (AI 생성) 예: "펌프","샷","번"
  };
};

export type PlaybookEntry = {
  id: string;
  unit_id: string;
  creator_id: string;
  creator_name: string;
  category: Category;
  subcategory: string;
  title: string;
  tags: string[];
  square: SquareBlock;
  execution: {
    timing: string;
    channel: string;
    tone: string;
    stakeholders?: string[];
  };
  stats: {
    query_hits_30d: number;
    resolution_rate: number;
    thumbs_up: number;
    thumbs_down: number;
    last_used_at: string;
  };
  search_keywords: string[];
  photos?: string[];
  version: number;
  status: 'draft' | 'review' | 'published' | 'deprecated' | 'archived';
  quality_score: number;
  created_at: string;
  updated_at: string;
  // 노하우 카드 메타(노하우 세그먼트 카드 노출용) — 선택 필드
  verification?: {
    // 사장 검증/현장 검증 배지. 없으면 미검증으로 표시.
    state: 'owner_verified' | 'field_tested' | 'unverified';
    verified_by?: string;
    verified_at?: string;
  };
  source?: {
    // 출처: 사장님 직접 입력 / 받은질문 답변 / 매뉴얼 등
    kind: 'owner' | 'inbox_answer' | 'manual' | 'import';
    label?: string;
    ref_id?: string;
  };
  // ── 업종 표준 노하우 팩(온보딩 자동등록) 메타 — 0024 마이그레이션 컬럼 ──
  // is_template: 아직 매장에 바인딩 안 된 순수 템플릿(번들 JSON에서만 true). fork되면 false.
  // needs_review: 사장이 교정 안 한 '매장 기본값(미확인)'. 알바/관리화면에 배지로 표시.
  // pack_id: 출처 팩(common|cafe…). correction_points: 사장이 바꿀 확률 높은 변수(추후 pull 루프).
  is_template?: boolean;
  pack_id?: string;
  needs_review?: boolean;
  correction_points?: string[];
};

// ── PlaybookSuggestion (알바 → 사장 노하우 제안/신청) ──
// 알바가 ① 기존 노하우 개선 제안 또는 ② 새 노하우 등록 신청을 올리면,
// 사장이 인박스에서 확인하고 반영(승인) / 반려를 결정한다.
export type PlaybookSuggestion = {
  id: string;
  unit_id: string;
  kind: 'improve' | 'new';
  /** improve: 대상 노하우 id. */
  target_entry_id?: string;
  /** improve: 표시용 대상 제목 스냅샷(노하우가 바뀌어도 맥락 보존). */
  target_title?: string;
  proposer_id: string;
  proposer_name: string;
  /** 알바가 쓴 제안/노하우 본문. */
  text: string;
  photos?: string[];
  status: 'pending' | 'approved' | 'rejected';
  /** 반려 사유 등 사장 메모. */
  owner_note?: string;
  /** 승인 후 만들어지거나 갱신된 노하우 id. */
  resulting_entry_id?: string;
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
};

// ── ChatQuery (주니어 측) ──────────────────────────────
export type ResponseBlock = {
  summary: string;
  actions: string[];
  donts: string[];
  degraded?: boolean;   // AI 서버 실패로 기본 답으로 폴백했는가 → 답변 위에 고지 표시
  source: {
    entry_id: string;
    creator_name: string;
    title: string;
    version: number;
    updated_at: string;
  };
};

export type ChatQuery = {
  id: string;
  junior_id: string;
  junior_name: string;
  query_text: string;
  asked_at: string;
  matched_entry_ids: string[];
  match_confidence: number;
  was_deflected: boolean;
  response_block: ResponseBlock | null;
  satisfaction: 'up' | 'down' | null;
  resolved_at: string | null;
  anonymous?: boolean;
  // 매칭 애매 시 제시할 후보 노하우 id들(클라 UI 전용·비영속). 사장 라우팅 전에 "혹시 이거?"로 보여준다.
  candidate_entry_ids?: string[];
};

// ── UnknownQuery (사장님 인박스) ──────────────────────
export type UnknownQuery = {
  id: string;
  junior_id: string;
  junior_name: string;
  query_text: string;
  asked_at: string;
  presumed_category: Category;
  presumed_subcategory: string;
  match_attempted: boolean;
  best_match_confidence: number;
  best_match_entry_id: string | null;
  status: 'pending_owner_answer' | 'resolved_with_entry' | 'dismissed' | 'auto_answered' | 'archived';
  fallback_action: string;
  owner_notified_at: string;
  owner_will_answer: boolean;
  similar_queries_count: number;
  ai_general_answer: string;
  resolved_with_entry_id?: string;
  // 알바가 익명으로 물은 질문 — 사장 인박스에서 이름·입사일차를 가린다(심리적 진입장벽 ↓).
  anonymous?: boolean;
};

// ── RAG 결과 (lib/rag.ts 출력과 호환) ───────────────
export type SearchResult = {
  matched: PlaybookEntry | null;
  confidence: number;
  candidates: { entry: PlaybookEntry; score: number }[];
  fallbackToUnknown: boolean;
};

// ── Demo (발표 시연용) ────────────────────────────────
export type SeedQuery = {
  id: string;
  label: string;
  text: string;
  expectedEntry: string | null;
};
