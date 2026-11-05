// qa-delete-confirm.mjs — 삭제 확인 단계(878657d) 회귀 검사 (2026-11-05 · 오류 탐지 11-03 검사 결함 4 · 백엔드 없음 · AI 호출 0회)
//
// 왜 있나: 878657d 를 되돌려도 백엔드 없는 검사 32개가 모두 통과했다. 확인 없이 지워져도 아무도 몰랐다.
// 방법: C1 = 문구 함수 deleteConfirmText 를 실제로 돌린다.
//   C2~C4 = 화면 세 곳에서 삭제 호출이 확인 단계 뒤에만 있는지 소스에서 센다(호출이 0개면 FAIL · 빈 통과 금지).
// 사용: node scripts/qa-delete-confirm.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ` · ${extra}` : ''}`); };
const indexesOf = (src, needle) => { const out = []; for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) out.push(i); return out; };

console.log('— 삭제 확인 단계(878657d) —');
// C1 공지 댓글은 댓글 문구 · 남의 글은 모두에게서 사라진다고 말한다
{
  const js = ts.transpileModule(read('src/lib/work/chatRules.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: () => ({}), Date });
  const f = module.exports.deleteConfirmText;
  const mine = f?.({ kind: 'comment', authorId: 'me' }, 'me');
  const other = f?.({ kind: 'comment', authorId: 'x' }, 'me');
  check('C1 공지 댓글 삭제 확인 문구가 댓글 문구다(내 것 · 남의 것)', mine?.title === '댓글 삭제' && other?.title === '댓글 삭제' && /모두에게서 사라져요/.test(other?.message ?? ''),
    `${mine?.title ?? '없음'} / ${other?.message ?? '없음'}`);
}
// C2·C3 삭제 호출을 감싼 onPress 안에서 confirmAction 이 먼저 나온다
for (const [name, file, call] of [
  ['C2 출퇴근 기록 삭제', 'src/components/TimesheetView.tsx', 'removeRecord('],
  ['C3 공지 댓글 삭제', 'src/components/work/NoticePanel.tsx', 'onDeleteComment('],
]) {
  const src = read(file);
  const calls = indexesOf(src, call).filter((i) => src.lastIndexOf('onPress=', i) >= 0);
  // 확인창을 띄우기만 하고 답을 안 보면 통과가 아니다. 답이 거짓이면 멈추는 모양(if (!ok) return · if (await confirmAction()까지 본다.
  const gated = (h) => /if \(!\w+\) return/.test(h) || h.includes('if (await confirmAction(');
  const bad = calls.filter((i) => { const h = src.slice(src.lastIndexOf('onPress=', i), i); return !h.includes('confirmAction(') || !gated(h); });
  check(`${name} 전에 확인창을 띄운다`, calls.length > 0 && bad.length === 0, `onPress 안 호출 ${calls.length} · 확인 없음 ${bad.length}`);
}
// C4 할일 삭제 버튼은 확인 단계만 연다. onDelete 호출은 확인 단계(delAsk) 가지 안에만 있다
{
  const src = read('src/components/work/TaskComposerModal.tsx');
  const start = src.indexOf('{delAsk && onDelete');
  const end = start >= 0 ? src.indexOf(') : (', start) : -1;
  const calls = indexesOf(src, 'onDelete(');
  const outside = calls.filter((i) => !(i > start && i < end));
  check('C4 할일 삭제는 확인 단계 안에서만 지운다', start >= 0 && calls.length > 0 && outside.length === 0 && src.includes('onPress={() => setDelAsk(true)}'),
    `onDelete 호출 ${calls.length} · 확인 단계 밖 ${outside.length}`);
}

console.log(`\n── PASS ${pass} · FAIL ${fail} · skip 0 · AI 호출 0회`);
process.exit(fail ? 1 : 0);
