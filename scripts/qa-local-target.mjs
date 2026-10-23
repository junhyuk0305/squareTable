// --local 대상 가드 (qa-quiz-contract.mjs --local 과 같은 방식).
// 키는 `npx supabase status` 에서만 읽는다. .env/.env.seed 값은 덮어쓴다.
// 주소가 http://127.0.0.1: 이 아니면 즉시 멈춘다(exit 2).
import { execFileSync } from 'node:child_process';

export const IS_LOCAL = process.argv.includes('--local');

export function assertLocalUrl(url) {
  if (!url || !/^http:\/\/127\.0\.0\.1:/.test(url)) {
    console.error('중단: --local 인데 대상 주소가 127.0.0.1 이 아니다 —', url);
    process.exit(2);
  }
}

export function localEnv() {
  let out = '';
  try {
    out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { console.error('중단: npx supabase status 실패(로컬 도커 꺼짐?)'); process.exit(2); }
  const st = Object.fromEntries(out.split('\n').map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  assertLocalUrl(st.API_URL);
  console.log('TARGET local', st.API_URL);
  return {
    EXPO_PUBLIC_SUPABASE_URL: st.API_URL,
    SUPABASE_URL: st.API_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: st.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY,
  };
}

// 브라우저 하니스: 화면(QA_ORIGIN)이 실제로 로컬 DB 를 보는지 번들에서 확인한다.
// 웹 앱은 자기 .env 를 읽으므로 하니스만 로컬로 바꾸면 화면은 원격을 친다.
export async function assertAppTargetsLocal(origin, url) {
  const html = await fetch(origin).then((r) => r.text()).catch(() => '');
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], origin).href);
  for (const s of srcs) {
    const js = await fetch(s).then((r) => r.text()).catch(() => '');
    if (js.includes(url)) return;
  }
  console.error(`중단: ${origin} 번들에 ${url} 이 없다. 웹 앱이 로컬 DB 를 보지 않는다(환경 실패).`);
  process.exit(2);
}
