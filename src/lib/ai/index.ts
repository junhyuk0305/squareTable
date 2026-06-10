// lib/ai/index.ts — AI 레이어 공개 진입점
export { generateAnswer, structureSquare } from './client';
export { toSopSlice, toSopSlices } from './adapter';
export { SERVE_THRESHOLD, GENERATE_THRESHOLD, USE_MOCK } from './config';
export type {
  SopSlice,
  GenerateAnswerInput,
  GenerateAnswerOutput,
  StructureSquareInput,
  StructureSquareOutput,
} from './types';
