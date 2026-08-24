// 훈련 퀴즈 v2 — 출제 형태 레지스트리 (클라 SSOT)
//
// 설계 근거: 산출물/퀴즈시스템_설계_2026-07-29.html §03 출제 형태
// 계약: .../training-v2-contract.md §2(형태 목록) · §4(FormatSpec · stripKeys 표)
//
// ════════════════════════════════════════════════════════════════════════════
// ★★ 형태 하나 추가 = 아래 **12곳**. 이 목록이 정본이다.
//
//   옛 주석은 "파일 추가 + import 한 줄 + FORMATS 한 줄"이라고 적혀 있었고, 0158 은 7곳,
//   0161·0168 은 9곳이라고 적었다. **셋 다 틀렸다.** 2026-08-25 전면 QA 에서 빠진 자리가
//   실제로 세 군데 더 드러났다(⑩⑪⑫). 숫자를 늘려 적는 대신, 빠뜨렸을 때 **무슨 일이 나는지**를
//   같이 적는다 — 대부분 에러 없이 조용히 깨지기 때문이다.
//
//   클라
//   ① formats/<이름>.ts                     FormatSpec(stripKeys·grade·validate·aiSchema·aiHint)
//   ② lib/quiz/types.ts  QuizFormat          없으면 tsc 가 ③⑨⑩ 을 대신 잡아 준다(유일한 안전망)
//   ③ formats/index.ts   import + FORMATS    ★나열 순서 규약: 유형마다 [0]=일반형, 그 뒤가 게임형
//   ④ components/work/quiz/<이름>.tsx + QUIZ_RENDERERS   없으면 응시 화면이 **빈 채로** 나간다
//   ⑤ components/owner/quiz/PayloadForm.tsx  shapeOf + 렌더 블록 + emptyPayload
//        ⛔shapeOf 의 default 가 'choices' 라 **에러 없이** 4지선다 폼이 뜨고, 사장이 채운 payload 가
//          validate 에 걸려 저장이 막히는 막다른 길이 된다. shape 만 넣고 렌더 블록을 빠뜨리면 빈 폼이다.
//   ⑥ lib/quiz/delta.ts  ANSWER_TEXTS        Record<QuizFormat,…> 라 빠뜨리면 tsc 가 막는다
//   ⑦ lib/quiz/preview.ts  previewAnswer     answer_index 가 **아닌** 형태만. 빠뜨리면 사장 "풀어보기"에서
//                                            틀렸을 때 정답이 undefined 로 나가 강조가 안 뜬다(0168 실측)
//   ⑧ app/owner/quiz/guest/[sub].tsx  readItem  빠뜨리면 사장 문항별 상세가 맞힌 문항인데도
//                                            "고른 답 · 안 골랐어요 / 정답 · 표시할 수 없어요"로 그린다(0168 실측)
//        ★응답 좌표계를 먼저 본다 — 서버가 섞는 형태(flip_match·link_match)는 이름으로 못 되돌린다.
//
//   서버(최고 번호 마이그레이션이 정본 — AGENTS.md ⑧)
//   ⑨ quiz_known_formats    빠뜨리면 응시에서 **조용히 빠진다**(fail-closed)
//   ⑩ quiz_strip_payload    빠뜨리면 **정답이 통째로 샌다.** 형태 파일의 stripKeys 와 글자 그대로 같아야 한다
//   ⑪ quiz_grade_item       빠뜨리면 화이트리스트엔 있는데 채점만 죽어, 응시자가 "다시 보내기"에 갇힌다
//                           (0161 이 quick_judge 를 여기서 잃었고 0170 이 되살렸다 — 실제로 난 사고다)
//   ⑫ 그 마이그레이션의 자가점검  ★개수만 세지 말 것. 0158·0161·0168 의 "N종" 검사는 ⑪ 의 누락을
//                           **전부 통과시켰다**(목록에 이름이 남아 있으면 초록이라서). 0170 처럼 동작을 잰다.
//
//   ⑬ 코드가 아니다 — **엣지를 재배포한다**: `npx supabase functions deploy ai`
//        supabase/functions/ai/quizFormats.ts 는 클라를 import 못 해 생성 스키마·힌트가 복제돼 있고,
//        **배포해야 반영된다.** 0158~0168 이 7종을 넣고 배포를 안 해서, 배포본이 그 형태를 모른 채
//        `rejected:no_generation`(모델 호출조차 안 함)을 돌려줬다 → t3·t5 자동 출제가 항상 0문항이었다.
//        pickFormats 회전에는 들어가 있어 **뽑히는 순간 그 노하우는 문항 0개**가 된다(2026-08-25 실측).
//
//   그 밖에 형태 목록을 복제하지 않는다. 화면·생성기는 전부 여기만 본다.
//   (DB format 컬럼에 check 제약을 걸지 않은 것도 같은 이유다 — 형태 추가에 마이그레이션이 필요 없게.)
// ════════════════════════════════════════════════════════════════════════════

import type { QuizFormat, QuizKind } from '../types';
import type { FormatSpec } from './spec';

import { mc4 } from './mc4';
import { orderPick } from './orderPick';
import { wrongSpot } from './wrongSpot';
import { orderBuild } from './orderBuild';
import { valuePick } from './valuePick';
import { fillCount } from './fillCount';
import { scalePick } from './scalePick';
import { numericEntry } from './numericEntry';
import { trapPick } from './trapPick';
import { mineTap } from './mineTap';
import { markParagraph } from './markParagraph';
import { flipMatch } from './flipMatch';
import { linkMatch } from './linkMatch';
import { casePick } from './casePick';
import { quickJudge } from './quickJudge';
import { branchPath } from './branchPath';
import { namePick } from './namePick';
import { chosung } from './chosung';

export type { FormatSpec } from './spec';

/**
 * 형태 18종. ★ 나열 순서에 의미가 있다 — 유형(kind)마다 일반형이 먼저, 게임형이 다음이다.
 * formatsForKind() 가 이 순서를 그대로 돌려주므로 생성기가 "게임이 안 되면 일반형으로"를
 * 별도 표 없이 판단할 수 있다(07-29 §03 "왜 두 갈래인가" — 일반형은 안전판).
 *
 * ★ t4 는 게임형 둘뿐이다(일반형 안전판이 없다) — 폐기된 pair_pick(t4 일반형)을 되살리지 않았다.
 *   그래서 t4 는 **재료가 맞을 때만** 출제된다: detectKinds(노하우 한 건)가 아니라 generate.ts 가
 *   pool 단위로 pairing.findPairSet 을 돌려 짝이 서 있을 때만 kinds 에 t4 를 얹는다. 못 만들면
 *   t4 자체가 후보에서 빠지므로 "게임이 안 되면 갈 곳이 없다"가 생기지 않는다.
 */
export const FORMATS: Record<QuizFormat, FormatSpec> = {
  mc4,                      // t0 안전망
  order_pick: orderPick,    // t1 일반
  wrong_spot: wrongSpot,    // t1 게임
  order_build: orderBuild,  // t1 게임
  value_pick: valuePick,    // t2 일반
  fill_count: fillCount,    // t2 게임
  scale_pick: scalePick,    // t2 게임 ★수동 전용(혼동쌍 재료가 필요 — 아래 주석)
  numeric_entry: numericEntry, // t2 게임(0168) — 텐키 직접 입력, 온도·시간처럼 큰 값
  trap_pick: trapPick,      // t3 일반
  mine_tap: mineTap,        // t3 게임
  mark_paragraph: markParagraph, // t3 게임(0168) — 이어진 인수인계 메시지 안에서 여러 곳 탭
  flip_match: flipMatch,    // t4 게임 ★유일하게 짝 정보가 응시 payload 에 남는다(flipMatch.ts 주석)
  link_match: linkMatch,    // t4 게임
  case_pick: casePick,      // t5 일반
  quick_judge: quickJudge,  // t5 게임
  branch_path: branchPath,  // t5 게임
  name_pick: namePick,      // t6 일반
  chosung,                  // t6 게임
};

/** 레지스트리 나열 순서 그대로의 형태 키 목록. */
export const FORMAT_KEYS = Object.keys(FORMATS) as QuizFormat[];

/** 이 유형으로 낼 수 있는 형태들. 앞이 일반형(안전판), 뒤가 게임형. */
export function formatsForKind(kind: QuizKind): FormatSpec[] {
  return FORMAT_KEYS.map((k) => FORMATS[k]).filter((f) => f.kind === kind);
}

/**
 * 이 유형의 **안전판(일반형)**. 없으면 null.
 *
 * 위 나열 순서 규약(유형마다 specs[0] 이 일반형)을 읽는 유일한 창구다 — `specs[0]` 을 여기저기서
 * 직접 집으면 t4 처럼 일반형이 없는 유형에서 게임형을 안전판으로 착각한다.
 *
 * ★t4 는 게임형 둘뿐이라 안전판이 없다(폐기된 pair_pick 을 되살리지 않았다 — 위 FORMATS 주석).
 *   대신 t4 는 재료가 맞을 때만 kinds 에 얹히므로 "게임이 안 되면 갈 곳이 없다"가 생기지 않는다.
 */
export function safetyNetFor(kind: QuizKind): FormatSpec | null {
  if (kind === 't4') return null;
  return formatsForKind(kind)[0] ?? null;
}
