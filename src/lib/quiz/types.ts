// 훈련 퀴즈 v2 — 공용 타입 (SSOT)
//
// 설계 근거: 산출물/퀴즈시스템_설계_2026-07-29.html
//   축 = "정답이 어떤 모양인가" — 나열(t1) / 값(t2) / 배제(t3) / 갈래(t5) / 이름(t6), t0=안전망
//   ※ 대응(t4)은 2026-08-08 멘트(action.scripts) 삭제로 재료가 사라져 함께 폐기했다.
//
// 이 파일은 순수 타입만 둔다. db.ts / 레지스트리 / 화면이 전부 여기를 import 하므로
// 런타임 의존(supabase, store 등)을 절대 넣지 않는다(순환 참조 방지).

/** 지식 유형 6종. 노하우 본문 구조로 코드가 판정한다(AI 아님). */
export type QuizKind = 't0' | 't1' | 't2' | 't3' | 't5' | 't6';

/**
 * 출제 형태. DB는 자유 text로 받는다(형태 추가에 마이그레이션이 필요 없게).
 * 실질 SSOT는 src/lib/quiz/formats/index.ts 의 FORMATS 레지스트리.
 */
export type QuizFormat =
  | 'mc4'          // t0 4지선다 (안전망 · 기존 generateQuiz 호환)
  | 'order_pick'   // t1 순서 고르기
  | 'wrong_spot'   // t1 틀린 자리 찾기
  | 'value_pick'   // t2 값 고르기
  | 'fill_count'   // t2 채워 넣기(탭할 때마다 +1)
  | 'trap_pick'    // t3 함정 찾기
  | 'mine_tap'     // t3 지뢰 밟기(금지 행동만 탭)
  | 'case_pick'    // t5 상황 고르기
  | 'quick_judge'  // t5 빠른 판별(둘 중 하나, 연속)
  | 'name_pick'    // t6 이름 고르기
  | 'chosung';     // t6 초성

/**
 * 응시자의 답. 형태마다 모양이 다르다.
 *   number                  — 선택지 하나 고르는 형태 / fill_count의 누른 횟수
 *   number[]                — mine_tap(탭한 index들) / quick_judge(카드별 선택)
 */
export type QuizResponse = number | number[];

/**
 * 저장되는 문항 하나.
 *
 * ★ payload 는 두 얼굴을 가진다.
 *   - 사장 화면(fetchQuizItems): 정답 포함 원본
 *   - 응시 화면(fetchQuizItemsForAttempt): 서버 RPC quiz_items_for 가 정답 키를 제거한 것
 *   채점은 서버(grade_quiz RPC)가 한다. 클라 채점은 정답 유출이라 쓰지 않는다.
 */
export type QuizItem = {
  id: string;
  unit_id: string;
  /** 근거 노하우 id 1건 이상. 오답은 여기 전부에 귀속된다(0103 record_quiz_stats). */
  entry_ids: string[];
  kind: QuizKind;
  format: QuizFormat;
  payload: Record<string, any>;
  /** 누가 만들었나. 'ai' = 우리가 만들어 준 것, 'owner' = 사장이 직접 쓴 것 */
  source: 'ai' | 'owner';
  status: 'active' | 'archived';
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  /**
   * 만들 때 본 근거 노하우들의 updated_at 최댓값(0114). DB 트리거가 찍는다 — 클라는 읽기만 한다.
   * 이 값이 지금의 노하우 updated_at 보다 뒤처져 있으면 낡은 문항이다(옛 정답이 계속 나간다).
   * null = 스냅샷 이전 행 → 낡음 판정 안 함(모르는 것을 "바뀌었다"고 말하지 않는다).
   */
  source_updated_at?: string | null;
};

/** 채점 결과(서버 판정). answer 는 오답일 때만 정답을 알려주는 용도. */
export type QuizGrade = {
  correct: boolean;
  explain: string;
  answer: any;
};

/**
 * 훈련 코스. 기존 'first_day' | 'regular' 하드코딩을 대체한다.
 * key 는 매장 안에서 유일. 기본 제공 프리셋에서 만들면 preset 이 채워진다.
 */
export type TrainingCourse = {
  id: string;
  unit_id: string;
  key: string;
  name: string;
  description?: string | null;
  /** 기본 제공 프리셋 키(src/lib/quiz/presets.ts). null = 사장이 직접 만든 코스 */
  preset?: string | null;
  min_items: number;
  max_items: number;
  /** null = 1회성(한 번 통과하면 끝). N = N일마다 다시 확인 */
  due_days?: number | null;
  /**
   * 예약 발송일 "YYYY-MM-DD"(KST, 0139). null = 아직 안 보낼 것(초안).
   * 시각은 담지 않는다 — 실제 도착 시각은 근무표가 정한다.
   */
  start_at?: string | null;
  /** 마감(며칠 안에, 0139). null = 마감 없음. 기준일은 만든 날이 아니라 받은 날. */
  answer_days?: number | null;
  position: number;
  active: boolean;
  created_at?: string;
};

/**
 * 발송 1건 = 수신자 1명(0139). 사장이 발행할 때 만들어지고, 크론이 근무일·빈도 상한을
 * 통과시킬 때 `sentAt` 을 채운다. 수신자 명단과 발송 원장이 같은 행이다.
 */
export type QuizAssignment = {
  id: string;
  courseId: string;
  userId: string;
  /** 이 날짜부터 발송 후보(코스 start_at 의 스냅샷). */
  scheduledOn: string;
  /** null = 아직 안 나감. 크론만 채운다. */
  sentAt: string | null;
  /** 받은 날 + answer_days. null = 마감 없음. */
  dueOn: string | null;
  openedAt: string | null;
  completedAt: string | null;
};
