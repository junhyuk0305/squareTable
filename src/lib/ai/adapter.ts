// lib/ai/adapter.ts
// PlaybookEntry(현재 mock 타입) → SopSlice 변환.
// ⚠️ 스키마가 바뀌면 "이 파일만" 고치면 됨. AI 레이어는 SopSlice만 알 뿐.

import type { SopSlice } from './types';

// PlaybookEntry 전체 타입에 의존하지 않도록 필요한 필드만 느슨하게 받음.
type EntryLike = {
  id: string;
  title: string;
  category: string;
  creator_name: string;
  version: number;
  updated_at: string;
  square: {
    situation: string;
    action: { steps: string[]; scripts?: string[] };
    extract: { dont?: string };
  };
};

export function toSopSlice(entry: EntryLike): SopSlice {
  const dont = entry.square?.extract?.dont?.trim();
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    situation: entry.square?.situation ?? '',
    steps: entry.square?.action?.steps ?? [],
    donts: dont ? [dont] : [],
    scripts: entry.square?.action?.scripts ?? [],
    creatorName: entry.creator_name,
    version: entry.version,
    updatedAt: entry.updated_at,
  };
}

export function toSopSlices(entries: EntryLike[]): SopSlice[] {
  return entries.map(toSopSlice);
}
