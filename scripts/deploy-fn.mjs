#!/usr/bin/env node
// deploy-fn.mjs — 엣지 함수 하나를 배포하고 어느 커밋을 올렸는지 _로컬전용/배포기록.md 에 한 줄 남긴다(2026-11-12).
//
//   npm run deploy:fn <이름>             배포 + 기록
//   npm run deploy:fn <이름> -- --dry-run  할 일만 찍는다(배포·기록 없음)
//
// 왜: 엣지 함수는 손으로 배포해서 지금 라이브에 어느 커밋이 올라가 있는지 남지 않았다.
// 멈추는 경우(배포 전에):
//   - supabase/functions/<이름> 이 없다
//   - 라이브 연결 정보(supabase/.temp/project-ref)가 없다 = main 체크아웃이 아니다(키는 main 에만 둔다)
//   - 그 함수 폴더에 커밋 안 된 변경이 있다(기록한 커밋과 올라간 코드가 달라진다)
// CLI 는 2.x 로 고정한다(맨 npx supabase 는 3.0 이 받아져 config.toml 에서 죽는다 · AGENTS.md).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, '..', '_로컬전용', '배포기록.md');
const CLI = 'supabase@2.122.1';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const name = args.find((a) => !a.startsWith('--'));
const stop = (msg) => { console.error(`중단: ${msg}`); process.exit(2); };
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

if (!name) stop('함수 이름이 없다. 예: npm run deploy:fn push');
if (!existsSync(join(ROOT, 'supabase', 'functions', name))) stop(`supabase/functions/${name} 이 없다`);
const refFile = join(ROOT, 'supabase', '.temp', 'project-ref');
if (!existsSync(refFile)) stop('라이브 연결 정보(supabase/.temp/project-ref)가 없다. main 체크아웃(SquareTable)에서 돌린다');
const ref = readFileSync(refFile, 'utf8').trim();
const dirty = git('status', '--porcelain', '--', `supabase/functions/${name}`);
if (dirty) stop(`supabase/functions/${name} 에 커밋 안 된 변경이 있다. 커밋한 뒤 배포한다\n${dirty}`);

const commit = git('rev-parse', '--short', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const fnCommit = git('log', '-1', '--format=%h', '--', `supabase/functions/${name}`);
const line = `- ${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })} KST · ${name} · HEAD ${commit} (${branch}) · 함수 폴더 마지막 커밋 ${fnCommit} · 프로젝트 ${ref}\n`;

const cmd = ['-y', CLI, 'functions', 'deploy', name, '--project-ref', ref];
console.log(`배포: npx ${cmd.join(' ')}`);
console.log(`기록: ${line.trim()}`);
if (DRY) { console.log('--dry-run: 배포·기록 안 함'); process.exit(0); }

const r = spawnSync('npx', cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
if (r.status !== 0) { console.error(`배포 실패(종료 코드 ${r.status}). 기록 안 함`); process.exit(r.status ?? 1); }
if (!existsSync(LOG)) appendFileSync(LOG, '# 엣지 함수 배포 기록\n\n`npm run deploy:fn <이름>` 이 배포에 성공하면 한 줄씩 붙인다.\n\n');
appendFileSync(LOG, line);
console.log(`기록함: ${LOG}`);
