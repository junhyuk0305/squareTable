// qa-pack-draft.mjs — 사장 답하기 팩 초안(src/lib/knowhow/packDraft.ts) 정확도 게이트. 백엔드·AI 를 안 쓴다(AI 0회).
//
// 재는 것(고정 질문 표본 scripts/fixtures/pack-draft-samples.json):
//   틀린 초안 비율 = 보인 초안 중 맞지 않는 것 / 보인 초안 수   ← 5% 이하여야 한다(넘으면 실패 · 임계값을 올려 "안 보임" 쪽으로)
//   맞힌 비율     = 답이 있는 문항 중 맞는 초안이 보인 것 / 답이 있는 문항 수
//   놓친 것       = 답이 있는데 초안이 안 보인 문항
// 임계값 훑기도 같이 찍는다: 틀린 비율 5% 이하에서 맞힌 비율이 가장 큰 (점수 하한 · 차이 하한). 코드 상수가 그보다 낮으면 경고.
//
// ★로직을 여기 복제하지 않는다. packDraft.ts 를 노드가 바로 읽는다(노드 24 타입 지우기 · 그 파일은 런타임 import 가 없다).
// 사용: node scripts/qa-pack-draft.mjs   (npm run qa:pack-draft)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { packDraftFrom, rankPackItems, PACK_DRAFT } = await import(
  pathToFileURL(join(root, 'src', 'lib', 'knowhow', 'packDraft.ts')).href
);
const packs = JSON.parse(readFileSync(join(root, 'src', 'data', 'knowhow-packs.json'), 'utf8'));
const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'pack-draft-samples.json'), 'utf8'));
const verbose = process.argv.includes('--verbose');

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  ✓', n, extra)) : (fail++, console.log('  ✗', n, extra)); };

// ── 0. 표본 모양 ──
const ids = new Set(packs.map((p) => p.id));
const all = fx.groups.flatMap((g) => g.samples.map((s) => ({ ...s, group: g })));
const positives = all.filter((s) => s.ok.length > 0);
const negatives = all.filter((s) => s.ok.length === 0);
console.log('\n[0] 표본');
check(`문항 60개 이상 (${all.length})`, all.length >= 60);
check(`답 있는 문항 30개 이상 (${positives.length})`, positives.length >= 30);
check(`답 없는 문항 30개 이상 (${negatives.length})`, negatives.length >= 30);
const unknownIds = positives.flatMap((s) => s.ok).filter((id) => !ids.has(id));
check('정답 id 가 팩에 다 있다', unknownIds.length === 0, unknownIds.join(','));
const titles = new Set(packs.map((p) => p.title.replace(/\s+/g, '')));
const copied = all.filter((s) => titles.has(s.q.replace(/\s+/g, '')));
check('팩 제목을 그대로 베낀 문항이 없다', copied.length === 0, copied.map((s) => s.q).join(' | '));
const wrongPack = positives.filter((s) => s.ok.some((id) => !s.group.packs.includes(packs.find((p) => p.id === id)?.pack_id)));
check('정답 항목이 그 업종 팩 안에 있다', wrongPack.length === 0, wrongPack.map((s) => s.q).join(' | '));

// 업종 → 팩 매핑이 앱(INDUSTRY_PACKS)과 같은지 글자로 대조한다(그 파일은 별칭 import 가 있어 노드로 못 읽는다).
const kp = readFileSync(join(root, 'src', 'data', 'knowhowPacks.ts'), 'utf8');
const ind = readFileSync(join(root, 'src', 'lib', 'config', 'industry.ts'), 'utf8');
const restaurantList = (ind.match(/RESTAURANT_INDUSTRIES: string\[\] = \[([\s\S]*?)\]/)?.[1] ?? '');
const mapOk = fx.groups.every((g) => {
  if (g.packs.join() === 'common,cafe') return kp.includes(`'${g.industry}': ['common', 'cafe']`);
  if (g.packs.join() === 'common,restaurant') return restaurantList.includes(`'${g.industry}'`) && kp.includes("RESTAURANT_INDUSTRIES.map((i) => [i, ['common', 'restaurant']])");
  if (g.packs.join() === 'common') return !kp.includes(`'${g.industry}': ['common', `) && !restaurantList.includes(`'${g.industry}'`);
  return false;
});
check('표본의 업종별 팩 = 앱 INDUSTRY_PACKS', mapOk);

// ── 1. 재기 ──
const itemsOf = (g) => packs.filter((p) => g.packs.includes(p.pack_id ?? 'common'));
function measure(minScore, minMargin, log = false) {
  let shown = 0, wrong = 0, right = 0;
  const missed = [], wrongs = [];
  for (const s of all) {
    const hit = packDraftFrom(s.q, itemsOf(s.group), minScore, minMargin);
    if (!hit) { if (s.ok.length) missed.push(s); continue; }
    shown++;
    if (s.ok.includes(hit.item.id)) right++;
    else { wrong++; wrongs.push({ s, hit }); }
  }
  const wrongRate = shown ? wrong / shown : 0;
  const hitRate = right / positives.length;
  if (log) {
    for (const { s, hit } of wrongs) console.log(`     틀림: "${s.q}" → ${hit.item.id} ${hit.item.title} (${hit.score.toFixed(2)} · ${hit.matched.join(',')})`);
    for (const s of missed) {
      const top = rankPackItems(s.q, itemsOf(s.group)).slice(0, 2).map((h) => `${h.item.id}:${h.score.toFixed(2)}`).join(' ');
      console.log(`     놓침: "${s.q}" (정답 ${s.ok.join('/')} · 상위 ${top || '없음'})`);
    }
  }
  return { shown, wrong, right, missed: missed.length, wrongRate, hitRate };
}

console.log(`\n[1] 지금 임계값 (점수 ${PACK_DRAFT.minScore} · 차이 ${PACK_DRAFT.minMargin})`);
const cur = measure(PACK_DRAFT.minScore, PACK_DRAFT.minMargin, true);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`     보인 초안 ${cur.shown} · 틀린 초안 ${cur.wrong} · 맞힌 ${cur.right}/${positives.length} · 놓친 ${cur.missed}`);
check(`틀린 초안 비율 ≤ 5% (${pct(cur.wrongRate)})`, cur.wrongRate <= 0.05);
check(`맞힌 비율 기록 (${pct(cur.hitRate)})`, cur.right > 0);

// ── 2. 임계값 훑기 ──
console.log('\n[2] 임계값 훑기 (틀린 ≤ 5% 안에서 맞힌 비율 최대)');
let best = null;
for (let s10 = 0; s10 <= 60; s10++) {
  for (const m of [0.2, 0.4, 0.6, 0.8, 1.0, 1.5]) { // 차이 0 = 동점에서 아무거나 고른다 → 빼고 훑는다
    const r = measure(s10 / 10, m);
    if (r.wrongRate > 0.05) continue;
    if (!best || r.hitRate > best.r.hitRate || (r.hitRate === best.r.hitRate && s10 / 10 > best.s)) best = { s: s10 / 10, m, r };
  }
}
if (best) console.log(`     최적 = 점수 ${best.s} · 차이 ${best.m} → 맞힌 ${pct(best.r.hitRate)} · 틀린 ${pct(best.r.wrongRate)}`);
if (verbose) {
  for (const s of [1, 1.5, 2, 2.2, 2.5, 3, 3.5, 4]) {
    const r = measure(s, PACK_DRAFT.minMargin);
    console.log(`     점수 ${s}: 보임 ${r.shown} · 틀림 ${r.wrong} (${pct(r.wrongRate)}) · 맞힘 ${pct(r.hitRate)}`);
  }
}
check('지금 임계값이 최적과 맞힌 비율이 같다', !!best && cur.hitRate >= best.r.hitRate, best ? `(지금 ${pct(cur.hitRate)} · 최적 ${pct(best.r.hitRate)})` : '');

// ── 3. 경계 ──
console.log('\n[3] 경계');
const cafeItems = itemsOf(fx.groups[0]);
check('빈 질문 = 초안 없음', packDraftFrom('', cafeItems) === null);
check('한 글자 = 초안 없음', packDraftFrom('네', cafeItems) === null);
check('후보 없음 = 초안 없음', packDraftFrom('머리카락 나왔어요', []) === null);
check('띄어쓰기를 달리 써도 같은 답', packDraftFrom('제 빙기 스 쿱', cafeItems)?.item.id === packDraftFrom('제빙기스쿱', cafeItems)?.item.id);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — pass ${pass} · fail ${fail} · skip 0 · AI 호출 0회 · 틀린 초안 ${pct(cur.wrongRate)} · 맞힌 ${pct(cur.hitRate)}`);
process.exit(fail === 0 ? 0 : 1);
