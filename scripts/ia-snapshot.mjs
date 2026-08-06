// IA 스냅샷 — 화면 전수·진입 경로·블록 수 상한을 코드에서 실측한다.
// 정본 문서: 레포 루트 `00_핵심/IA_현황_LIVE.md` (이 스크립트는 그 문서의 숫자를 다시 재는 용도)
//
//   node scripts/ia-snapshot.mjs      (= npm run ia)
//
// ★ blocks 는 **상한 추정치**다:
//   · max 만 판정에 쓴다. min 은 참고값이다(로딩 게이트 아래 화면이 0으로 나온다).
//   · 조건부 가지를 전부 세고 상호배타만 접으므로 max 는 과대 추정 방향으로만 틀린다.
//   · 플래그가 붙은 숫자는 약한 숫자다 — `?` 안 셈 · `▽` 조건부 · `~` 카드 휴리스틱.
// ★ **화면 목록의 SSOT 는 `scripts/ia-screens.json`이다.** 여기서 발견한 라우트와 대조해
//   미등록·유령이 하나라도 있으면 실패한다(/hub 층이 문서에서 통째로 빠졌던 사고의 재발 방지).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { countBlocks } from './lib/block-count.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const APP = join(SRC, 'app');

// 이동 표기가 여러 형태다. 템플릿 리터럴(`/x/${id}`)은 정적으로 못 잡는다 → 동적 라우트는 in:0 으로 뜰 수 있다.
const NAV = /(?:router\.(?:push|replace)|goToTab|Redirect\s+href=|href=|path:)\s*\(?\s*[{'"`]?\s*(?:pathname:\s*)?['"`](\/[^'"`$]*)['"`]/g;

const walk = (dir, test, base = '') => {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') out.push(...walk(p, test, `${base}/${e}`)); continue; }
    if (test(e)) out.push({ abs: p, rel: `${base}/${e}` });
  }
  return out;
};

// ── 라우트 발견 — 진입경로·빈 상태·탭 루트 판정은 그대로 둔다(지금도 맞게 작동한다) ──
const routes = walk(APP, (e) => e.endsWith('.tsx'))
  .filter(({ rel }) => !/\/(_layout|\+html)\.tsx$/.test(rel))
  .map(({ rel, abs }) => {
    const src = readFileSync(abs, 'utf8');
    const route = rel.replace(/\.tsx$/, '').replace(/\/index$/, '') || '/';
    return {
      route,
      file: `src/app${rel}`,
      maps: (src.match(/\.map\(/g) || []).length,
      hasEmpty: /<EmptyState/.test(src),
      emptyCta: /<EmptyState[\s\S]{0,400}?cta=/.test(src),
      inlineEmpty: /emptyText|emptySub|emptyBody|styles\.empty\b|s\.empty\b/.test(src),
    };
  });

// 진입 경로 — 화면뿐 아니라 components/·lib/ 에서도 이동이 일어난다.
const inbound = {};
for (const { abs, rel } of walk(SRC, (e) => /\.tsx?$/.test(e))) {
  const from = rel.replace(/^\//, '');
  for (const m of readFileSync(abs, 'utf8').matchAll(NAV)) {
    const t = m[1].replace(/\?.*$/, '');
    if (t.startsWith('/') && !t.startsWith('//')) (inbound[t] ??= new Set()).add(from);
  }
}

// 탭 루트 — 탭바 배열이 곧 진입점
const tabSrc = ['components/RoleTabBar.tsx', 'components/HubTabBar.tsx']
  .map((p) => { try { return readFileSync(join(SRC, p), 'utf8'); } catch { return ''; } }).join('\n');
const tabRoutes = new Set([...tabSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));

for (const r of routes) {
  r.isTab = tabRoutes.has(r.route);
  r.in = [...(inbound[r.route] ?? [])].filter((f) => !f.endsWith(`app${r.route}.tsx`)).length;
}

// ── 등록표 ─────────────────────────────────────────────────────────────
const REG_PATH = join(__dirname, 'ia-screens.json');
const registry = JSON.parse(readFileSync(REG_PATH, 'utf8'));
const routeOf = (id) => id.split('#')[0];

const rows = registry.screens.map((e) => {
  const route = routeOf(e.id);
  const rt = routes.find((r) => r.route === route);
  const target = e.componentFile ?? e.file;
  const abs = target ? join(ROOT, target) : null;
  let blocks;
  if (!abs || !existsSync(abs)) blocks = { min: 0, max: 0, flags: '?', chain: [], missing: true };
  else {
    try { blocks = countBlocks(abs, e.component); }
    catch (err) { blocks = { min: 0, max: 0, flags: '?', chain: [], error: err.message }; }
  }
  const budget = e.type === 'A' ? 5 : e.type === 'C' ? 3 : null;
  return {
    ...e, route, blocks, target,
    role: route.startsWith('/owner') ? 'owner' : route.startsWith('/junior') ? 'junior' : 'common',
    isTab: rt?.isTab ?? false,
    in: rt?.in ?? 0,
    hasEmpty: rt?.hasEmpty ?? false,
    emptyCta: rt?.emptyCta ?? false,
    inlineEmpty: rt?.inlineEmpty ?? false,
    regressed: blocks.max > (e.maxAccepted ?? Infinity),
    overBudget: budget != null && blocks.max > budget,
  };
});

// 드리프트 — 발견됐는데 미등록 / 등록됐는데 파일 없음
const covered = (route) => registry.screens.some((e) => e.id === route || e.id.startsWith(`${route}#`));
const unregistered = routes.filter((r) => !covered(r.route)).map((r) => r.route);
const ghosts = rows
  .filter((r) => r.blocks.missing || (r.file && !existsSync(join(ROOT, r.file))))
  .map((r) => `${r.id}(${r.target ?? r.file})`);

// ── 출력 ───────────────────────────────────────────────────────────────
const by = (role) => rows.filter((r) => r.role === role).sort((a, b) => b.blocks.max - a.blocks.max);
const cnt = (t) => rows.filter((r) => r.type === t).length;
console.log(`\n화면 ${rows.length}개(라우트 ${routes.length}) — 사장 ${by('owner').length} · 직원 ${by('junior').length} · 공용 ${by('common').length}`);
console.log(`유형 A ${cnt('A')} · B ${cnt('B')} · C ${cnt('C')} · 미분류 ${rows.filter((r) => !r.type).length}   (유형은 사람이 등록표에 선언한다 — 코드에서 못 뽑는다)\n`);

for (const role of ['common', 'owner', 'junior']) {
  console.log(`── ${role} ${'─'.repeat(58)}`);
  for (const r of by(role)) {
    const span = `${r.blocks.min}–${r.blocks.max}/${r.type ?? '-'}`;
    const state = r.regressed ? '▲래칫' : r.verdict === 'adr' ? '·ADR ' : r.overBudget ? '△예산' : '     ';
    const flags = [
      (r.blocks.flags || '').padEnd(3),
      r.isTab ? 'TAB' : '   ',
      r.hasEmpty ? (r.emptyCta ? 'E+' : 'E-') : (r.inlineEmpty ? 'e-' : '  '),
      state,
    ].join(' ');
    console.log(`  ${r.id.padEnd(28)} ${span.padEnd(8)} ${flags}  in:${r.in}`);
  }
  console.log('');
}

// ── 판정 ───────────────────────────────────────────────────────────────
const regressed = rows.filter((r) => r.regressed);
const overNoAdr = rows.filter((r) => r.overBudget && !r.regressed && r.verdict !== 'adr');
const adrAllowed = rows.filter((r) => r.verdict === 'adr');
const noCta = routes.filter((r) => (r.hasEmpty && !r.emptyCta) || (r.inlineEmpty && !r.emptyCta));
const orphan = routes.filter((r) => r.in === 0 && !r.isTab);

// exit 1 조건은 아래 세 가지다(래칫 초과 · 미등록 · 유령). 문구가 래칫만 말하면
// 등록표 드리프트로 실패했을 때 "초과 0개인데 왜 실패하지"로 오독된다(2026-08-06 검증에서 잡힘).
console.log(`· 래칫 초과(=지난번보다 나빠짐) ${regressed.length}개  ← exit 1 조건 ①(②미등록 ③유령은 아래)`);
if (regressed.length) for (const r of regressed) console.log(`    ${r.id}  ${r.blocks.max} > maxAccepted ${r.maxAccepted}`);
console.log(`· 절대 예산 초과 ${overNoAdr.length}개 (ADR 없음) — 사람이 판정할 것: ${overNoAdr.map((r) => `${r.id}(${r.blocks.max}/${r.type})`).join(', ') || '없음'}`);
console.log(`· ADR 로 허용 중 ${adrAllowed.length}개: ${adrAllowed.map((r) => `${r.id}(${r.adr ?? 'ADR?'})`).join(', ') || '없음'}`);

console.log(`\n── 못 재는 것 ${'─'.repeat(48)}`);
console.log('· 형태가 같은 블록이 연속인지 (배치규칙① — 이번 개편의 진짜 증상)');
console.log('· 런타임에 실제로 그려졌는지 (AlertRow 는 0건이면 스스로 null)');
console.log('· 시각 순서·가려짐·본문 15sp·색 대비  → npm run qa:blocks (8화면)');
console.log('· B형 검사 3개(반복 1종·스크롤 축 1·고정 ≤2)는 정적으로 못 잰다');
console.log('· 조건부(▽) 화면의 상한은 과대 추정이다 — 실제로 다 뜨는지는 확인 안 됐다');
console.log(`· '?' 붙은 ${rows.filter((r) => (r.blocks.flags || '').includes('?')).length}개는 0/미해소 = "여기서 안 셈"이지 "단순함"이 아니다`);

console.log(`\n빈 상태에 행동 버튼 없음 ${noCta.length}개: ${noCta.map((r) => r.route).join(', ') || '없음'}`);
console.log(`\n진입 경로 0 (고아 후보 — 동적 라우트는 오탐) ${orphan.length}개: ${orphan.map((r) => r.route).join(', ') || '없음'}`);

if (unregistered.length || ghosts.length) {
  console.log(`\n── 등록표 드리프트 ${'─'.repeat(43)}`);
  if (unregistered.length) console.log(`· 발견됐는데 미등록 ${unregistered.length}개: ${unregistered.join(', ')}`);
  if (ghosts.length) console.log(`· 등록됐는데 파일 없음 ${ghosts.length}개: ${ghosts.join(', ')}`);
  console.log('  → scripts/ia-screens.json 을 고친다. IA_현황_LIVE.md §2 표는 여기서 파생된다.');
}

console.log(`\n→ 판정과 결정은 00_핵심/IA_현황_LIVE.md 에 기록한다.\n`);
process.exit(regressed.length || unregistered.length || ghosts.length ? 1 : 0);
