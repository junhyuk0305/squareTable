// seed-target.mjs — 시드 스크립트가 "어느 DB 를 치는지" 실행 전에 못 박는다.
//
// 왜 있나(2026-09-23 사고): 로컬 리허설을 하려고 `process.env` 로 로컬 URL 을 덮고
// `seed-demo.mjs` 를 돌렸는데, 그 스크립트만 `.env.seed` **파일이 먼저**라(다른 6개는 process.env 먼저)
// 덮어쓰기가 무시되고 **라이브**를 쳤다. 그 안에 매장 필터 없는 삭제가 한 줄 있어서
// 전 매장의 `work_room_members` 가 지워졌다(실계정 0인 시점이라 실피해는 없었다).
//
// 두 가지가 겹쳐야 사고가 난다 — ①기본 대상이 라이브다 ②어디를 치는지 안 보인다.
// 그래서 이 파일은 그 둘만 막는다:
//   ① 라이브면 **명시적 opt-in**(SEED_ALLOW_LIVE=1) 없이는 실행을 거부한다.
//   ② 어느 경우든 대상을 한 줄 찍는다 — 눈으로 보고 Ctrl-C 할 수 있어야 한다.
//
// ⛔QA 하니스(`qa-*.mjs`)에는 달지 않는다. 그쪽은 고정 계정으로 라이브를 치는 것이 정상 절차다
//   (메모리 feedback_qa_use_fixed_accounts). 가드는 **purge 가 있는 시드**만 대상이다.

/** 로컬 스택인가(supabase start 기본 바인딩). */
function isLocal(url) {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}

/**
 * 시드 대상을 확정하고 찍는다. 라이브면 SEED_ALLOW_LIVE=1 이 없는 한 종료한다.
 * @param {string} url  해석이 끝난 SUPABASE_URL
 * @param {string} name 스크립트 이름(메시지용)
 */
export function assertSeedTarget(url, name) {
  const local = isLocal(url);
  const where = local ? '로컬' : '★라이브';
  console.log(`[${name}] 대상 DB = ${where} ${url}`);

  if (local || process.env.SEED_ALLOW_LIVE === '1') return url;

  console.error(
    `\n✗ 거부 — ${name} 은 라이브(${url})를 칩니다.\n` +
    `  시드는 purge 를 포함합니다. 정말 라이브에 심으려면 명시적으로 켜십시오:\n` +
    `    SEED_ALLOW_LIVE=1 node scripts/${name}\n` +
    `  로컬에 심으려면 로컬 스택 주소를 주십시오(supabase start 기본 54321):\n` +
    `    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local> node scripts/${name}\n`
  );
  process.exit(1);
}
