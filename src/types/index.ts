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
  description?: string;
  situation: string;
  quagmire: string;
  uncover: string;
  action: {
    steps: string[];
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
  /** 작성 시점 역할 스냅샷(0101) — 저자 표기("○○ 사장님"/"○○ 매니저")용. 레거시(미저장)=null. */
  creator_role?: 'owner' | 'manager' | null;
  category: string; // 기본 4종(Category) 키 또는 매장 커스텀 카테고리 id(0096, 수동 지정 전용)
  subcategory: string;
  title: string;
  /** 노하우 설명 전문 — 제목 외 추가 상세. 비워두면 표시하지 않는다. */
  description?: string | null;
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
  // ── 섹션·순서·출처(인수인계서 대량등록) 메타 — 0063 마이그레이션 컬럼 ──
  // 매뉴얼은 저장물이 아니라 파생 뷰: 원자 노하우마다 [섹션+순서]만 붙여 섹션별로 렌더한다.
  // section: 주제 섹션(오픈·마감·레시피…). import 소제목으로 자동 시드. null/undefined=미분류(기타).
  // order_index: 섹션 내 순서(문서 순서 보존). source_id: import 배치 꼬리표(관리용, 묶음 기준 아님).
  section?: string | null;
  order_index?: number;
  source_id?: string | null;
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
  /** S1 ② 완료 캡처 출처 업무(work_templates.id, 0070). 승인 시 이 업무에 결과 노하우를 자동 첨부(0069). */
  source_template_id?: string;
  /** S1 ③(D4) 직원의 새-답 제안이 답하는 미답질문(unknown_queries.id, 0071). 승인·발행 시 그 질문 자동 resolve. */
  source_uq_id?: string;
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
  // 신뢰 신호: 'served'=저장된 매장 노하우를 그대로 서빙(검증 배지 신뢰) /
  //           'generated'=여러 노하우를 AI가 모아 정리(검증 배지 비노출 + "AI 정리" 고지) /
  //           'smalltalk'=의도 게이트(chat·vague) 응대 — 노하우 카드 없이 말풍선 텍스트만.
  //           미설정(기존 행)은 served 취급(하위호환).
  mode?: 'served' | 'generated' | 'smalltalk';
  // 조건 커버리지 partial 고지 — 질문의 조건·예외를 등록 노하우가 안 다룰 때 미커버 조건 한 문장.
  // 있으면 답 아래에 경고 노트 + "사장님께 물어보기" 1탭 에스컬레이션을 노출한다.
  caveat?: string;
  // smalltalk(잡담 응대·되묻기)은 출처 노하우가 없다 — 그 경우에만 미설정.
  source?: SourceRef;
  /**
   * generated 모드에서 답을 만드는 데 실제 참고한 노하우 출처들(복수). 2개 이상일 때만 채운다.
   * served(저장된 답 그대로)는 미설정 — 단일 source만. UI는 이게 있으면 "참고한 노하우 N개" 칩으로 노출.
   */
  sources?: SourceRef[];
};

export type SourceRef = {
  entry_id: string;
  creator_name: string;
  title: string;
  version: number;
  updated_at: string;
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
  presumed_category: string; // AI 추정은 기본 4종(Category), 답변 발행 시 사장이 커스텀으로 재지정 가능
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
  /** S1 ③(D4) 이 질문을 해결한 사람(직원이 기존 노하우로 즉시 해결 시 기록, 0071). */
  answered_by?: string;
};

// ── RAG 결과 (lib/rag.ts 출력과 호환) ───────────────
export type SearchResult = {
  matched: PlaybookEntry | null;
  confidence: number;
  candidates: { entry: PlaybookEntry; score: number }[];
  fallbackToUnknown: boolean;
};

// ── 입금 신고(계좌이체 수동과금, 0083) ────────────────
// 사장이 "입금 완료했어요"를 누르면 남는 1급 행. 예전엔 mailto 메일 초안뿐이라 DB에 흔적이 없었고,
// 메일이 묻히면 "돈은 냈는데 앱이 안 열리는" 무음 구간이 생겼다.
// 검토(승인·반려)는 service_role 전용 RPC(review_payment_claim)만 — 클라는 읽기+생성만 가능(RLS).
export type PaymentClaim = {
  id: string;
  unit_id: string;
  claimed_by: string;
  plan: 'single' | 'multi';
  /** 서버(payment_claim_amount)가 계산한 청구액. 클라가 보낸 금액은 저장되지 않는다. */
  amount_krw: number;
  /** 계좌이체 대사의 유일한 키 — 은행 거래내역과 맞추는 값. */
  depositor_name: string;
  months: number;
  memo?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  /** 운영자 식별자(관리자 콘솔 STAFF 이메일). */
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reject_reason?: string | null;
  created_at: string;
};

// ── Demo (발표 시연용) ────────────────────────────────
export type SeedQuery = {
  id: string;
  label: string;
  text: string;
  expectedEntry: string | null;
};
