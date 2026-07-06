#!/usr/bin/env node
/**
 * QA — 다중 노하우 분리(N개 동시 입력) 회귀 가드.
 *
 * 배경: 사장이 노하우 여러 개를 한 번에 입력해도 각각 나뉘어 등록되지 않던 버그.
 * 근본 원인 3가지를 정적/행위 불변식으로 고정해 재발을 막는다:
 *   (1) EXTRACTION_MASTER(마스터 지침)가 edge MAX_GUIDE_LEN 로 잘려 분리 few-shot이 LLM에 안 닿음.
 *   (2) entries 상한이 3으로 하드코딩돼 4개+ 동시입력이 조용히 잘림(스키마 maxItems / slice 드리프트).
 *   (3) mock 폴백 splitChunks 상한이 3 고정.
 *
 * 이 스크립트는 LLM/네트워크 없이 소스만 읽어 검증한다(결정적). `node scripts/qa-knowhow-split.mjs`.
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => { failed++; console.log(`  ✗ ${name}\n      → ${detail}`); };
const assert = (cond, name, detail) => (cond ? ok(name) : bad(name, detail));

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── 소스 로드 ──────────────────────────────────────────────
const edge = read('supabase/functions/ai/index.ts');
const master = read('src/data/extraction-master.ts');
const mock = read('src/lib/ai/mock.ts');

// ── 파싱 헬퍼 ──────────────────────────────────────────────
const numConst = (src, name) => {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\d_]+)`));
  return m ? Number(m[1].replace(/_/g, '')) : NaN;
};

console.log('\n[1] 마스터 지침이 edge 가이드 상한에 안 잘리는가 (근본원인 #1)');
const MAX_GUIDE_LEN = numConst(edge, 'MAX_GUIDE_LEN');
const guideBody = master.match(/EXTRACTION_MASTER\s*=\s*`([\s\S]*?)`;/)?.[1] ?? '';
assert(Number.isFinite(MAX_GUIDE_LEN), 'MAX_GUIDE_LEN 파싱', `못 찾음`);
assert(guideBody.length > 0, 'EXTRACTION_MASTER 파싱', '템플릿 리터럴 못 찾음');
assert(
  guideBody.length <= MAX_GUIDE_LEN,
  `가이드(${guideBody.length}자) ≤ MAX_GUIDE_LEN(${MAX_GUIDE_LEN})`,
  `가이드가 ${guideBody.length - MAX_GUIDE_LEN}자 초과 → edge .slice(0, MAX_GUIDE_LEN)로 뒷부분(분리 예시)이 잘린다`,
);
assert(/분리 규칙/.test(guideBody), '가이드에 [분리 규칙] 존재', '분리 규칙 섹션 없음');
assert(/최대 6/.test(guideBody), '가이드 분리 상한 = 6', '"최대 6" 문구 없음(3에서 안 올림?)');
assert(/순서대로|앞에 나온|앞 순서/.test(guideBody), '가이드가 문서 순서 우선을 지시', '순서 지시 없음(초과 시 "앞 5개"가 비결정적)');
assert(/줄바꿈|번호/.test(guideBody), '가이드가 나열(줄바꿈/번호) 분리를 지시', '나열 분리 지시 없음');
assert(/화장실 청소/.test(guideBody), '같은 category 나열 분리 few-shot 존재', '동일 category 분리 예시 없음(잘렸거나 미추가)');

console.log('\n[2] entries 상한 일관성 — 스키마 maxItems == slice == 상수 (근본원인 #2)');
const MAX_ENTRIES = numConst(edge, 'MAX_ENTRIES');
assert(MAX_ENTRIES >= 4, `MAX_ENTRIES(${MAX_ENTRIES}) ≥ 4`, '4 미만이면 4개+ 동시입력이 잘린다');
assert(/maxItems:\s*MAX_ENTRIES/.test(edge), '스키마 entries.maxItems = MAX_ENTRIES', 'maxItems가 상수 대신 하드코딩');
assert(/slice\(0,\s*MAX_ENTRIES\)/.test(edge), 'handleSquare slice(0, MAX_ENTRIES)', 'slice가 상수 대신 하드코딩');
assert(!/entries,?\s*maxItems:\s*3\b/.test(edge) && !/\.slice\(0,\s*3\)/.test(edge.match(/const rawEntries[^\n]*/)?.[0] ?? ''),
  'entries 경로에 slice(0, 3)/maxItems:3 잔재 없음', '3 하드코딩 잔재 발견');

console.log('\n[3] 다중 출력이 토큰에 안 잘리게 — maxOutputTokens 상향 (근본원인 #2)');
const squareCall = edge.match(/callGemini\(prompt,\s*SQUARE_SCHEMA,\s*(\d+)/);
const squareTokens = squareCall ? Number(squareCall[1]) : NaN;
assert(squareTokens >= 2048, `SQUARE 호출 maxOutputTokens(${squareTokens}) ≥ 2048`, `${squareTokens} → ${MAX_ENTRIES}개 JSON이 잘릴 수 있음`);

console.log('\n[4] mock 폴백 splitChunks — 상한 6 + 나열 분리 (근본원인 #3, 행위검증)');
// splitChunks 를 소스에서 뽑아 타입주석만 벗겨 실제 실행한다(드리프트 없이 행위 검증).
const block = mock.match(/const MOCK_MAX_CHUNKS[\s\S]*?\nfunction splitChunks[\s\S]*?\n}/)?.[0] ?? '';
assert(block.length > 0, 'splitChunks 블록 추출', 'mock.ts에서 splitChunks 못 찾음');
assert(!/slice\(0,\s*3\)/.test(block), 'splitChunks에 slice(0, 3) 잔재 없음', '3 하드코딩 잔재');
let splitChunks = () => [];
try {
  const js = block.replace('function splitChunks(raw: string): string[]', 'function splitChunks(raw)');
  splitChunks = new Function(`${js}; return splitChunks;`)();
} catch (e) {
  bad('splitChunks eval', String(e));
}
const cases = [
  { in: '오픈 청소\n마감 정산\n재고 확인', want: 3, label: '줄바꿈 3개 → 3' },
  { in: '1. 오픈 청소\n2. 마감 정산\n3. 재고 확인\n4. 발주 넣기\n5. 매장 소독\n6. 간판 끄기', want: 6, label: '번호 6개 → 6' },
  { in: Array.from({ length: 9 }, (_, i) => `${i + 1}. 오늘의 할일 ${i + 1}`).join('\n'), want: 6, label: '9개 → 상한 6' },
  { in: '커피를 적당히 넣어라', want: 1, label: '단일 → 1' },
  { in: '그라인더 청소하고 그리고 원두를 채워라', want: 2, label: '"그리고" → 2' },
];
for (const c of cases) {
  const got = splitChunks(c.in).length;
  assert(got === c.want, `${c.label} (got ${got})`, `기대 ${c.want}, 실제 ${got}`);
}
// 번호/불릿 접두 제거 확인
const stripped = splitChunks('1. 화장실 청소\n2. 정산 하기');
assert(stripped[0] === '화장실 청소', '번호 접두 "1. " 제거', `실제 "${stripped[0]}"`);

console.log('\n[5] 발행 상한 5개 + 초과 경고 + 긴 텍스트 (클라 정책 · 2026-07-06)');
const coach = read('src/components/OwnerCoachChat.tsx');
const MAX_SPLIT_PUBLISH = numConst(coach, 'MAX_SPLIT_PUBLISH');
assert(MAX_SPLIT_PUBLISH === 5, `MAX_SPLIT_PUBLISH(${MAX_SPLIT_PUBLISH}) == 5`, '한 번에 등록 상한이 5가 아님');
assert(
  Number.isFinite(MAX_ENTRIES) && MAX_ENTRIES > MAX_SPLIT_PUBLISH,
  `edge MAX_ENTRIES(${MAX_ENTRIES}) > MAX_SPLIT_PUBLISH(${MAX_SPLIT_PUBLISH})`,
  '감지 상한(edge)이 발행 상한(클라)보다 크지 않으면 "5개 초과"를 감지·경고할 수 없다',
);
assert(/slice\(0,\s*MAX_SPLIT_PUBLISH\)/.test(coach), '표시·발행에 slice(0, MAX_SPLIT_PUBLISH) cap', 'cap slice 없음');
assert(/pubSegs\.length\s*>\s*MAX_SPLIT_PUBLISH/.test(coach), '초과 감지(overflow) 분기 존재', 'overflow 분기 없음(조용히 잘림 위험)');
assert(/보다 많이 보여요|최대 .{0,6}개까지 등록/.test(coach), '초과 시 경고 문구 존재', '경고 문구 없음');
// 긴 텍스트: 등록 입력창 maxLength가 1000 제한을 벗어났는가(Q2).
const mlMatches = coach.match(/maxLength=\{(\d+)\}/g) || [];
const inputMaxLen = mlMatches.length ? Math.max(...mlMatches.map((x) => Number(x.match(/\d+/)[0]))) : NaN;
assert(inputMaxLen > 1000, `등록 입력창 maxLength(${inputMaxLen}) > 1000 (긴 텍스트 허용)`, 'maxLength가 여전히 1000 이하');

console.log(`\n${failed === 0 ? '✅ PASS' : `❌ FAIL (${failed})`} — 다중 노하우 분리·상한 회귀 가드\n`);
process.exit(failed === 0 ? 0 : 1);
