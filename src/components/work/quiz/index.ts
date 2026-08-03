import type { ComponentType } from 'react';

import type { QuizFormat } from '@/lib/quiz/types';
import { Mc4, OrderPick, ValuePick, TrapPick, PairPick, CasePick, NamePick, Chosung } from './PickFormats';
import { WrongSpot } from './WrongSpot';
import { FillCount } from './FillCount';
import { MineTap } from './MineTap';
import { MatchLine } from './MatchLine';
import { QuickJudge } from './QuickJudge';
import type { QuizRendererProps } from './types';

/**
 * 응시 화면 형태 레지스트리 — format 키 하나에 렌더러 하나.
 * 형태 목록의 SSOT는 src/lib/quiz/formats/index.ts(FORMATS). 여기는 **그리는 쪽만** 담당한다.
 * 새 형태가 늘면 여기 키가 비어 TypeScript가 잡는다(Record<QuizFormat, …>).
 */
export const QUIZ_RENDERERS: Record<QuizFormat, ComponentType<QuizRendererProps>> = {
  mc4: Mc4,
  order_pick: OrderPick,
  wrong_spot: WrongSpot,
  value_pick: ValuePick,
  fill_count: FillCount,
  trap_pick: TrapPick,
  mine_tap: MineTap,
  pair_pick: PairPick,
  match_line: MatchLine,
  case_pick: CasePick,
  quick_judge: QuickJudge,
  name_pick: NamePick,
  chosung: Chosung,
};

export type { QuizRendererProps, QuizGradeView } from './types';
