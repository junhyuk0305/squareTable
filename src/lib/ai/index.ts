// lib/ai/index.ts — AI 레이어 공개 진입점
export { generateAnswer, structureSquare, patchSquare, extractIntent } from './client';
export { hybridSearch, embedEntry, buildEmbedText } from './searchClient';
export { toSopSlice, toSopSlices } from './adapter';
export { SERVE_THRESHOLD, GENERATE_THRESHOLD, USE_MOCK } from './config';
export type {
  SopSlice,
  GenerateAnswerInput,
  GenerateAnswerOutput,
  StructureSquareInput,
  StructureSquareOutput,
  PatchSquareInput,
  IntentInput,
  IntentOutput,
  ScalePrompt,
  StructuredSegment,
  AiFollowup,
} from './types';
