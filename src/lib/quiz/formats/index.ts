// 훈련 퀴즈 v2 — 출제 형태 레지스트리 (클라 SSOT)
//
// 설계 근거: 산출물/퀴즈시스템_설계_2026-07-29.html §03 출제 형태
// 계약: .../training-v2-contract.md §2(형태 목록) · §4(FormatSpec · stripKeys 표)
//
// ★ 형태를 하나 더 붙이는 일 = "formats/새파일.ts 추가 + 아래 import 한 줄 + FORMATS 한 줄".
//   그 외 어디에도 형태 목록을 복제하지 않는다. 화면·생성기는 전부 여기만 본다.
//   (DB format 컬럼에 check 제약을 걸지 않은 것도 같은 이유다 — 형태 추가에 마이그레이션이 필요 없게.)
//
// ★ 짝: 엣지 supabase/functions/ai/quizFormats.ts.
//   엣지는 클라 코드를 import 못 해서 생성 스키마·힌트가 복제돼 있다.
//   여기(클라) = UI·채점·검증 SSOT / 엣지 = 생성 스키마 전용 복제본.
//
// ★ 짝: 서버 마이그레이션 0107 quiz_items_for.
//   각 형태의 stripKeys(+ 형태 파일 주석의 "특수 처리")와 글자 그대로 같아야 한다.

import type { QuizFormat, QuizKind } from '../types';
import type { FormatSpec } from './spec';

import { mc4 } from './mc4';
import { orderPick } from './orderPick';
import { wrongSpot } from './wrongSpot';
import { valuePick } from './valuePick';
import { fillCount } from './fillCount';
import { trapPick } from './trapPick';
import { mineTap } from './mineTap';
import { casePick } from './casePick';
import { quickJudge } from './quickJudge';
import { namePick } from './namePick';
import { chosung } from './chosung';

export type { FormatSpec } from './spec';

/**
 * 형태 11종. ★ 나열 순서에 의미가 있다 — 유형(kind)마다 일반형이 먼저, 게임형이 다음이다.
 * formatsForKind() 가 이 순서를 그대로 돌려주므로 생성기가 "게임이 안 되면 일반형으로"를
 * 별도 표 없이 판단할 수 있다(07-29 §03 "왜 두 갈래인가" — 일반형은 안전판).
 */
export const FORMATS: Record<QuizFormat, FormatSpec> = {
  mc4,                      // t0 안전망
  order_pick: orderPick,    // t1 일반
  wrong_spot: wrongSpot,    // t1 게임
  value_pick: valuePick,    // t2 일반
  fill_count: fillCount,    // t2 게임
  trap_pick: trapPick,      // t3 일반
  mine_tap: mineTap,        // t3 게임
  case_pick: casePick,      // t5 일반
  quick_judge: quickJudge,  // t5 게임
  name_pick: namePick,      // t6 일반
  chosung,                  // t6 게임
};

/** 레지스트리 나열 순서 그대로의 형태 키 목록. */
export const FORMAT_KEYS = Object.keys(FORMATS) as QuizFormat[];

/** 이 유형으로 낼 수 있는 형태들. 앞이 일반형(안전판), 뒤가 게임형. */
export function formatsForKind(kind: QuizKind): FormatSpec[] {
  return FORMAT_KEYS.map((k) => FORMATS[k]).filter((f) => f.kind === kind);
}
