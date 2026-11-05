// 라이브 브라우저 검사의 화면 서버 가드 — 오류 탐지 11-03 검사 결함 1(2026-11-05).
//
// 왜 있나: --allow-remote 는 DB 주소만 본다. 11-02 라이브 크롤이 QA_ORIGIN=localhost:8090(st-feat2 미머지 서버)에
//   붙었고 같은 시각 라이브 client_errors 가 66건 늘었다. 포트 번호로도 못 가린다. 11-05 에는 8081 을 st-feat 가 듣고 있었다.
//
// 규칙: argv 에 --allow-remote 가 있으면 ORIGIN 포트를 듣는 프로세스의 명령줄이 main 체크아웃 아래여야 하고
//   그 체크아웃이 main 브랜치여야 한다. 확인하지 못하면 멈춘다(exit 2).
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

function stop(why) {
  console.error(`중단: 라이브 검사는 main 체크아웃의 개발 서버로만 돈다 — ${why}`);
  process.exit(2);
}

export function guardMainOrigin(origin) {
  if (!process.argv.includes('--allow-remote')) return;
  const url = new URL(origin);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') stop(`QA_ORIGIN 이 로컬 개발 서버가 아니다: ${origin}`);
  if (process.platform !== 'win32') stop('이 가드는 Windows 에서만 서버 프로세스를 확인한다');
  const port = Number(url.port || 80);

  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const mainDir = dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const branch = git(['-C', mainDir, 'branch', '--show-current']);
  if (branch !== 'main') stop(`main 체크아웃(${mainDir})이 main 브랜치가 아니다: ${branch}`);

  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$_").CommandLine }`;
  let lines = [];
  try {
    lines = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch { /* 아래에서 0줄로 멈춘다 */ }
  if (lines.length === 0) stop(`포트 ${port} 를 듣는 프로세스를 찾지 못했다`);
  const want = `${norm(mainDir)}\\node_modules\\`;
  const other = lines.filter((l) => !norm(l).includes(want));
  if (other.length) stop(`포트 ${port} 서버가 main 체크아웃이 아니다: ${other.join(' | ')}`);
  console.error(`[화면] main 개발 서버 확인: ${origin} · ${mainDir}`);
}
