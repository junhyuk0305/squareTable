#!/usr/bin/env node
// qa-tab-pick.mjs — 하단 탭바에서 켤 칸 판정(pickActiveTab)의 케이스 표(2026-11-17 · 화면조립표 11절 5번 "들어온 탭의 칸을 켠다").
// 백엔드·AI 호출 0회. 실행: npm run qa:tab-pick   (Node 24 type-strip 로 .ts 직접 import)
import { pickActiveTab } from '../src/lib/utils/tabPick.ts';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} → ${got}${ok ? '' : ` (기대 ${want})`}`);
};

const OWNER = [
  { path: '/owner/dashboard' },
  { path: '/owner/categories', also: ['/owner/inbox', '/owner/knowledge'] },
  { path: '/owner/training' },
  { path: '/owner/work' },
  { path: '/owner/settings' },
];
const JUNIOR = [
  { path: '/junior/home' },
  { path: '/junior/chat' },
  { path: '/junior/work' },
  { path: '/junior/attendance', also: ['/junior/schedule', '/junior/timesheet'] },
  { path: '/junior/settings' },
];

check('① 탭 화면 = 자기 칸', pickActiveTab(OWNER, '/owner/training', '/owner/dashboard'), 2);
check('② 계열 서브화면 = 그 칸(들어온 탭보다 먼저)', pickActiveTab(OWNER, '/owner/knowledge', '/owner/dashboard'), 1);
check('③ 탭 하위 경로 = 그 칸', pickActiveTab(OWNER, '/owner/settings/x', null), 4);
check('④ 하위 화면 · 홈에서 들어옴 = 홈', pickActiveTab(OWNER, '/owner/staff', '/owner/dashboard'), 0);
check('⑤ 하위 화면 · 설정에서 들어옴 = 설정', pickActiveTab(OWNER, '/owner/staff', '/owner/settings'), 4);
check('⑥ 하위 화면 · 노하우에서 들어옴(교육 링크 목록) = 노하우', pickActiveTab(OWNER, '/owner/edu-link', '/owner/categories'), 1);
check('⑦ 들어온 탭 모름(주소로 바로) = 아무 칸도 안 켬', pickActiveTab(OWNER, '/owner/schedule', null), -1);
check('⑧ 다른 역할 탭 경로가 남아 있으면 안 켬', pickActiveTab(OWNER, '/owner/schedule', '/junior/home'), -1);
check('⑨ 직원 근무표 = 출퇴근(계열)', pickActiveTab(JUNIOR, '/junior/schedule', '/junior/home'), 3);
check('⑩ 경로 앞부분만 같은 다른 화면은 계열 아님', pickActiveTab(OWNER, '/owner/training-x', '/owner/settings'), 4);

console.log(`\n${fail ? 'RED' : 'GREEN'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
