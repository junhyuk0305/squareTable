// scripts/qa-knowhow-quality.mjs — 등록 품질 게이트(Defense 3) 20건 극단/부족 입력 검증.
// 등록 방어 전체를 순서대로 태운다:
//   ① isJunkInput(원문 잡음, AI 전 차단)  ② Edge 'square' usable=false(비노하우 안내)
//   ③ looksLikePromptLeak(누출 방어)      ④ followups(내용 부족→꼬리질문)
//   ⑤ assessKnowhowQuality(빈내용 재입력·일반명사제목 차단·과광범위 키워드 sanitize)
// 실제 모듈(knowhowInput.ts·knowhowQuality.ts)을 import해 SSOT로 검증.
//
// 실행: OPS_EMAIL=eval-owner@squaretable.test OPS_PW=evaltest1234 node scripts/qa-knowhow-quality.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const parseEnv = (f) => { const o = {}; try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim(); } } catch {} return o; };
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.OPS_EMAIL || process.env.QA_EMAIL || process.env.BENCH_EMAIL;
const PW = process.env.OPS_PW || process.env.QA_PASSWORD || process.env.BENCH_PW;
if (!URL_ || !ANON) { console.error('✗ .env SUPABASE URL/ANON 필요'); process.exit(2); }
if (!EMAIL || !PW) { console.error('✗ OPS_EMAIL/OPS_PW(또는 QA_/BENCH_) 필요'); process.exit(2); }

const { isJunkInput, knowhowGuidanceMessage, looksLikePromptLeak } = await import(pathToFileURL(here('../src/lib/utils/knowhowInput.ts')).href);
const { assessKnowhowQuality } = await import(pathToFileURL(here('../src/lib/utils/knowhowQuality.ts')).href);

const guide = (() => { const s = readFileSync(here('../src/data/extraction-master.ts'), 'utf8'); const m = s.match(/EXTRACTION_MASTER = `([\s\S]*?)`;/); return m ? m[1] : ''; })();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const signIn = async () => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email: EMAIL, password: PW }) }); const j = await r.json(); if (!j.access_token) throw new Error('login fail'); return j.access_token; };
let token;
const callAI = async (task, payload, tries = 4) => {
  for (let a = 1; a <= tries; a++) {
    const r = await fetch(`${URL_}/functions/v1/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: JSON.stringify({ task, payload }) });
    if (r.status === 429) { await wait(8000 * a); continue; }
    return r.json().catch(() => ({}));
  }
  return { error: 'ratelimit' };
};

// 각 케이스: raw 입력 + 기대 결과군(사람이 읽기용).
const CASES = [
  { raw: '', expect: 'JUNK' },
  { raw: '아', expect: 'JUNK' },
  { raw: 'ㅁㄴㅇㄹ', expect: 'JUNK' },
  { raw: '!!!!!', expect: 'JUNK' },
  { raw: '😀😀', expect: 'JUNK' },
  { raw: 'ㅅㅂ', expect: 'JUNK/GUIDE' },
  { raw: '안녕하세요', expect: 'GUIDE(인사)' },
  { raw: '감사합니다 사장님', expect: 'GUIDE(감사)' },
  { raw: '테스트입니다', expect: 'GUIDE(테스트)' },
  { raw: '오늘 날씨 진짜 좋다', expect: 'GUIDE(맥락X)' },
  { raw: '어제 손흥민 골 넣었더라', expect: 'GUIDE(맥락X)' },
  { raw: '매장 노하우', expect: 'BLOCK(빈/일반명사)' },
  { raw: '그냥 정리 좀 해줘', expect: 'GUIDE/BLOCK(모호)' },
  { raw: '마감', expect: 'FOLLOWUP(단어)' },
  { raw: '커피 적당히 넣어', expect: 'FOLLOWUP/척도' },
  { raw: '손님 응대 잘하기', expect: 'SANITIZE/BLOCK(광범위)' },
  { raw: '마감 때 그릴 끄고 기름통 비우고 바닥 물청소하기', expect: 'PUBLISH' },
  { raw: '우유 떨어지면 사장님께 문자하고 근처 마트에서 1L 사오기', expect: 'PUBLISH' },
  { raw: '진상 손님이 반말하며 화내도 정중히 사과하고 사장님께 바로 알리기', expect: 'PUBLISH' },
  { raw: '포스기 카드 안 긁히면 영수증 수기로 쓰고 마감 때 정산 확인', expect: 'PUBLISH' },
];

async function decide(raw) {
  if (isJunkInput(raw)) return { d: 'REJECT_JUNK', why: knowhowGuidanceMessage(raw).split('\n')[0].slice(0, 40) };
  const b = await callAI('square', { rawText: raw, category: 'Routine', categoryGuide: guide }) || {};
  if (b.error) return { d: 'ERR', why: b.error };
  if (b.usable === false) return { d: 'GUIDE_NONKNOWHOW', why: knowhowGuidanceMessage(raw).split('\n')[0].slice(0, 40), title: b.title };
  const steps = b.square?.action?.steps || [];
  if (looksLikePromptLeak(b.title || '', steps)) return { d: 'REJECT_LEAK', why: '누출방어', title: b.title };
  if ((b.followups || []).length) return { d: 'FOLLOWUP', why: (b.followups || []).join(' / ').slice(0, 50), title: b.title };
  const q = assessKnowhowQuality({ title: b.title, keywords: b.keywords, square: b.square });
  if (!q.publishable) return { d: 'BLOCK_QUALITY', why: q.issues.filter((i) => i.severity === 'block').map((i) => i.kind).join(','), title: b.title };
  const warn = q.issues.find((i) => i.severity === 'warn');
  return { d: warn ? 'PUBLISH_SANITIZED' : 'PUBLISH', why: warn ? `제외:${(warn.dropped || []).join('·')} → 키워드:${q.sanitizedKeywords.join(',')}` : `키워드:${q.sanitizedKeywords.slice(0, 5).join(',')}`, title: b.title };
}

const main = async () => {
  token = await signIn();
  console.log('✓ 로그인. 등록 품질 게이트 20건 검증\n');
  const tally = {};
  for (const c of CASES) {
    const r = await decide(c.raw);
    tally[r.d] = (tally[r.d] || 0) + 1;
    console.log(`[${(r.d).padEnd(16)}] "${(c.raw || '(빈값)').slice(0, 30)}"  기대=${c.expect}`);
    if (r.title) console.log(`   └ title="${r.title}"  ${r.why}`);
    else console.log(`   └ ${r.why}`);
    if (!isJunkInput(c.raw)) await wait(7000); // user 분당 캡(10) 밑 페이싱
  }
  console.log('\n── 분포 ──');
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`);
  console.log('\n핵심 체크: "매장 노하우"→BLOCK_QUALITY(빈/일반명사), "손님 응대"→SANITIZE(광범위 제외), 좋은 4건→PUBLISH, 잡음/비노하우→REJECT/GUIDE');
};
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
