#!/usr/bin/env node
// qa-space-home-stage.mjs — 공간 홈 단계 판정(spaceHomeStage) 진리표(2026-11-17 · 실측 R-17).
// 화면조립표 5절: 위에서부터 먼저 맞는 줄 = 운영(답할 질문 1+) → 첫날(노하우 0) → 준비(노하우 1+ · 링크 0) → 운영·처리할 것 0.
// 교육 링크 스위치가 꺼지면 준비 단계가 없다. 백엔드·AI 호출 0회.
// 실행: npm run qa:space-home-stage   (Node 24 type-strip 로 .ts 직접 import)
import { spaceHomeStage } from '../src/lib/place/homeStage.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${got}${ok ? '' : ` (기대 ${want})`}`);
};
const S = (pending, knowhow, links, linksOn = true) => spaceHomeStage({ pending, knowhow, links, linksOn });

check('첫날: 노하우 0 · 링크 0 · 질문 0', S(0, 0, 0), 'first');
check('첫날: 노하우 0 · 링크 있음(노하우를 다 지움)', S(0, 0, 2), 'first');
check('준비: 노하우 1 · 링크 0', S(0, 1, 0), 'ready');
check('운영·처리할 것 0: 노하우 3 · 링크 1 · 질문 0', S(0, 3, 1), 'run');
check('운영: 질문 1 이 가장 먼저(노하우 0이어도)', S(1, 0, 0), 'answer');
check('운영: 질문 4 · 노하우 5 · 링크 2', S(4, 5, 2), 'answer');
check('스위치 꺼짐: 노하우 1 · 링크 0 → 준비 없음', S(0, 1, 0, false), 'run');
check('스위치 꺼짐: 노하우 0 → 첫날', S(0, 0, 0, false), 'first');
check('스위치 꺼짐: 질문 2 → 운영', S(2, 1, 0, false), 'answer');

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
