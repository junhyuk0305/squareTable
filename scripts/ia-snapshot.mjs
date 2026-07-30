// IA 스냅샷 — 화면 전수·진입 경로·복잡도 예산을 코드에서 실측한다.
// 정본 문서: 레포 루트 `00_핵심/IA_현황_LIVE.md` (이 스크립트는 그 문서의 숫자를 다시 재는 용도)
//
//   node scripts/ia-snapshot.mjs
//
// ★ 이 숫자는 하한선이다:
//   · `.map()` 반복 렌더는 1로 센다(직원 8명 = 1).
//   · 공용 컴포넌트에 위임한 화면은 0으로 나온다(/owner/work → WorkBoard).
//   → 0은 "단순함"이 아니라 "여기서 안 셈". 초과로 뜬 것만 신뢰한다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');
const APP = join(SRC, 'app');

// 예산 — 화면복잡도 원칙 §4
const BUDGET = { owner: 7, junior: 5, common: 7 };

const INTERACTIVE = /<(Pressable|TouchableOpacity|TouchableHighlight|Button|TextInput|Switch|ChachakSwitch|PressableScale)\b/g;
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

const screens = walk(APP, (e) => e.endsWith('.tsx'))
  .filter(({ rel }) => !/\/(_layout|\+html)\.tsx$/.test(rel))
  .map(({ abs, rel }) => {
    const src = readFileSync(abs, 'utf8');
    const route = rel.replace(/\.tsx$/, '').replace(/\/index$/, '') || '/';
    const role = route.startsWith('/owner') ? 'owner' : route.startsWith('/junior') ? 'junior' : 'common';
    return {
      route, role, src,
      interactive: (src.match(INTERACTIVE) || []).length,
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

for (const s of screens) {
  s.isTab = tabRoutes.has(s.route);
  s.in = [...(inbound[s.route] ?? [])].filter((f) => !f.endsWith(`app${s.route}.tsx`)).length;
  s.budget = BUDGET[s.role];
  s.over = s.interactive > s.budget;
}

const by = (r) => screens.filter((s) => s.role === r).sort((a, b) => b.interactive - a.interactive);
console.log(`\n화면 ${screens.length}개 — 사장 ${by('owner').length} · 직원 ${by('junior').length} · 공용 ${by('common').length}\n`);

for (const role of ['common', 'owner', 'junior']) {
  console.log(`── ${role} ${'─'.repeat(52)}`);
  for (const s of by(role)) {
    const flags = [
      s.isTab ? 'TAB' : '   ',
      s.hasEmpty ? (s.emptyCta ? 'E+ ' : 'E- ') : (s.inlineEmpty ? 'e- ' : '   '),
      s.over ? '⚠OVER' : '     ',
    ].join(' ');
    console.log(`  ${s.route.padEnd(30)} ${String(s.interactive).padStart(2)}/${s.budget}  ${flags}  in:${s.in}`);
  }
  console.log('');
}

const over = screens.filter((s) => s.over);
const noCta = screens.filter((s) => (s.hasEmpty && !s.emptyCta) || (s.inlineEmpty && !s.emptyCta));
const orphan = screens.filter((s) => s.in === 0 && !s.isTab);

console.log(`예산 초과 ${over.length}개: ${over.map((s) => s.route).join(', ') || '없음'}`);
console.log(`\n빈 상태에 행동 버튼 없음 ${noCta.length}개: ${noCta.map((s) => s.route).join(', ') || '없음'}`);
console.log(`\n진입 경로 0 (고아 후보 — 동적 라우트는 오탐) ${orphan.length}개: ${orphan.map((s) => s.route).join(', ') || '없음'}`);
console.log(`\n→ 판정과 결정은 00_핵심/IA_현황_LIVE.md 에 기록한다.\n`);
