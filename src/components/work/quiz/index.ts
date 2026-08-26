import type { ComponentType } from 'react';

import type { QuizFormat } from '@/lib/quiz/types';
import { Mc4, OrderPick, ValuePick, TrapPick, CasePick, NamePick, Chosung } from './PickFormats';
import { WrongSpot } from './WrongSpot';
import { OrderBuild } from './OrderBuild';
import { FillCount } from './FillCount';
import { ScalePick } from './ScalePick';
import { NumericKeypad } from './NumericKeypad';
import { MineTap } from './MineTap';
import { FlipMatch } from './FlipMatch';
import { LinkMatch } from './LinkMatch';
import { QuickJudge } from './QuickJudge';
import { BranchPath } from './BranchPath';
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
  order_build: OrderBuild,
  value_pick: ValuePick,
  fill_count: FillCount,
  scale_pick: ScalePick,
  numeric_entry: NumericKeypad,
  trap_pick: TrapPick,
  mine_tap: MineTap,
  flip_match: FlipMatch,
  link_match: LinkMatch,
  case_pick: CasePick,
  quick_judge: QuickJudge,
  branch_path: BranchPath,
  name_pick: NamePick,
  chosung: Chosung,
};

export type { QuizRendererProps, QuizGradeView } from './types';
