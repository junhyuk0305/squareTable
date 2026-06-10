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

export type UsersData = {
  owner: Owner;
  staff: Junior[];
};

// ── ContextPack ───────────────────────────────────────
export type ContextPack = {
  id: string;
  unit_id: string;
  store_name: string;
  industry: string;
  subcategory: string;
  owner_id: string;
  address: string;
  opened_at: string;
  hours: {
    weekday: string;
    weekend: string;
    last_order: string;
    break_time: string;
  };
  brand_rules: string[];
  menu_quick: Array<{ name: string; price: number; category: string }>;
  equipment: Array<{ name: string; model: string; note: string }>;
  emergency_contacts: Array<{ label: string; phone_last4: string }>;
  stakeholders_today: Array<{ label: string; name: string; available: boolean; note?: string }>;
  settings: {
    auto_unknown_alert: boolean;
    alert_max_per_day: number;
    default_tone: string;
    language: string;
  };
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
};

// ── ChatQuery (주니어 측) ──────────────────────────────
export type ResponseBlock = {
  summary: string;
  actions: string[];
  donts: string[];
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
  status: 'pending_owner_answer' | 'resolved_with_entry' | 'dismissed';
  fallback_action: string;
  owner_notified_at: string;
  owner_will_answer: boolean;
  similar_queries_count: number;
  ai_general_answer: string;
  resolved_with_entry_id?: string;
};

// ── RAG 결과 (lib/rag.ts 출력과 호환) ───────────────
export type SearchResult = {
  matched: PlaybookEntry | null;
  confidence: number;
  candidates: { entry: PlaybookEntry; score: number }[];
  fallbackToUnknown: boolean;
};

// 위저드 분기용 — 매칭 실패 시 top1 candidate 또는 키워드로 카테고리 추정
export type CategoryInference = {
  presumedCategory: Category;
  presumedSubcategory: string;
  bestGuessEntryId: string | null;
};

// ── Demo (발표 시연용) ────────────────────────────────
export type SeedQuery = {
  id: string;
  label: string;
  text: string;
  expectedEntry: string | null;
};
