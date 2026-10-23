// local-target-guard.mjs — 스크립트가 라이브 Supabase 를 치기 전에 멈춘다(2026-10-23 D4).
//
// 왜 있나: 2026-10-23 Q-0 에서 하니스가 라이브에 QA 계정을 만들었다. 키 파일(.env·.env.seed)이 있는
//   체크아웃에서 `node scripts/<x>.mjs` 한 줄이면 라이브로 간다. 그래서 기본을 로컬로 바꾼다.
//
// 규칙(qa-local-accounts 가드와 같다):
//   이 스크립트가 쓸 URL(EXPO_PUBLIC_SUPABASE_URL · SUPABASE_URL)의 호스트가 127.0.0.1/localhost 가 아니고
//   argv 에 --allow-remote 가 없으면 exit 2. 스크립트 본문(네트워크 호출)보다 먼저 돈다.
//   두 이름을 다 본다. 스크립트마다 고르는 순서가 달라서(EXPO 먼저 · SUPABASE_URL 먼저) 하나라도 원격이면 멈춘다.
//   URL 이 아예 없으면 통과한다. 접속할 곳이 없으니 스크립트가 스스로 멈춘다.
//
// URL 을 찾는 순서는 스크립트가 실제로 읽는 순서를 따른다.
//   require-local-target.mjs       셸 env 먼저, 없으면 .env·.env.seed ({ ...process.env } 후 빈 키만 채우는 스크립트)
//   require-local-target-files.mjs .env·.env.seed 먼저, 없으면 셸 env (파일만 읽거나 파일이 이기는 스크립트)
//   파일은 저장소 루트와 현재 폴더 둘 다 본다(cwd 기준으로 읽는 스크립트가 있다).
//
// --local 을 붙였고 그 스크립트가 qa-local-target.mjs 를 쓰면 그쪽 가드에 맡긴다
//   (키를 `npx supabase status` 에서 받고 127.0.0.1 인지 확인한다).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 없는 파일은 건너뛴다 */ }
  return out;
}

function isLocal(url) {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

function deferToLocalFlag() {
  if (!process.argv.includes('--local')) return false;
  try { return readFileSync(process.argv[1], 'utf8').includes('qa-local-target'); } catch { return false; }
}

/** @param {{ filesFirst: boolean }} opts */
export function guardLocalTarget({ filesFirst }) {
  if (deferToLocalFlag()) return;
  const dirs = [...new Set([ROOT, process.cwd()].map((d) => resolve(d)))];
  const files = dirs.flatMap((d) => [readEnvFile(resolve(d, '.env')), readEnvFile(resolve(d, '.env.seed'))]);
  const urls = new Set();
  for (const name of NAMES) {
    const shell = process.env[name];
    const fromFiles = files.map((f) => f[name]).filter(Boolean);
    const picked = filesFirst
      ? (fromFiles.length ? fromFiles : [shell])
      : (shell ? [shell] : fromFiles);
    for (const u of picked) if (u) urls.add(u);
  }
  const remote = [...urls].filter((u) => !isLocal(u));
  if (remote.length === 0) return;
  if (process.argv.includes('--allow-remote')) {
    console.error(`[대상] 원격 허용(--allow-remote): ${remote.join(' · ')}`);
    return;
  }
  console.error(
    `중단: 접속 대상이 로컬이 아니다 — ${remote.join(' · ')}\n` +
    `라이브를 치려면 --allow-remote 를 명시한다.` +
    (filesFirst
      ? ' 이 스크립트는 .env 파일 값을 먼저 쓴다. 로컬은 --local(지원 스크립트) 또는 키 파일 없는 worktree 에서 돌린다.'
      : ' 로컬은 셸에 EXPO_PUBLIC_SUPABASE_URL·SUPABASE_URL=http://127.0.0.1:54321 을 준다.'),
  );
  process.exit(2);
}
