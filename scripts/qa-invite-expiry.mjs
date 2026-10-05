#!/usr/bin/env node
// qa-invite-expiry.mjs — 초대코드 만료 표시(Q21 · P5-8). 백엔드 없음 · 계정을 만들지 않는다.
//
// 무엇을 보나
//   [1] 순수 함수(src/lib/invite/inviteExpiry.ts 를 그대로 import · 로직 복제 없음)
//       · inviteExpiryLabel(expiresAt, now) — 남았으면 "10월 11일까지 쓸 수 있어요", 한국 시간으로 같은 날이면
//         "오늘까지예요", 지났으면 "만료됐어요". 만료일이 없거나(옛 매장 · 서버도 안 막는다) 읽지 못하면 null.
//   [2] 데이터 — fetchUnitInfo 가 invite_expires_at 을 읽고 세션이 inviteExpiresAt 으로 들고 있다.
//       코드를 바꾸면(직원 관리 [코드 변경]) 만료일도 같이 바꾼다. 서버는 만료 코드 합류를 거부한다(0067 · 회귀 가드).
//   [3] InviteBlock — 만료되면 복사 · 링크 버튼을 끄고, 사장에게 [새 코드 받기](rotate_invite_code),
//       그 밖의 역할에게 "사장님께 새 코드를 요청해 주세요" 를 보인다. 열 때마다 자동 재발급하지 않는다.
// 수정 전에는 inviteExpiry.ts 가 없으므로 **지금 앱의 판정**으로 같은 표를 돌린다
//   (지금 앱은 만료일을 읽지 않는다 → 어떤 코드든 표시 없음 · 공유 가능). 모듈이 없어서가 아니라 판정이 틀려서 RED 다.
// 실행: node scripts/qa-invite-expiry.mjs   (Node 22.18+ — .ts 를 타입만 벗겨 읽는다)
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

register('./qa-alias-loader.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const show = (v) => JSON.stringify(v);
const read = (p) => {
  const u = new URL(`../${p}`, import.meta.url);
  return existsSync(u) ? readFileSync(u, 'utf8').replace(/\r\n/g, '\n') : '';
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const load = async (p) => {
  try { return await import(p); } catch (e) { console.log('  (모듈 없음)', p, String(e && e.code ? e.code : e)); return null; }
};

// 화면 문구 공통 금지: 대시 · 문장 잇는 중간점 · 결제 채널 말(3.1.1) · 개발 말(snake_case)
const STYLE = /—| · /;
const CHANNEL = /카드|웹에서|토스/;
const DEV = /[a-z]+_[a-z]+/;
const copyOk = (m) => typeof m === 'string' && m.length > 0 && !STYLE.test(m) && !CHANNEL.test(m) && !DEV.test(m);

const M = await load('../src/lib/invite/inviteExpiry.ts');

// ── 지금 앱의 판정(수정 전 폴백) ─────────────────────────────────────────
// 지금 fetchUnitInfo 는 store_name · invite_code · industry 만 읽는다 → 만료일을 모른다 → 언제나 표시 없음(공유 가능).
const db0 = strip(read('src/lib/db.ts'));
const legacyLabel = /\.select\('store_name, invite_code, industry'\)/.test(db0) ? () => null : null;
const inviteExpiryLabel = M && typeof M.inviteExpiryLabel === 'function'
  ? M.inviteExpiryLabel
  : (console.log('  (inviteExpiryLabel 없음 → 지금 앱 판정으로 실행)'), legacyLabel);

// ── [1] 순수 함수 ─────────────────────────────────────────────────────
console.log('\n[1] inviteExpiryLabel');
const NOW = new Date('2026-10-05T03:00:00Z'); // 한국 시간 10월 5일 낮 12시
const L = (iso, now = NOW) => (inviteExpiryLabel ? inviteExpiryLabel(iso, now) : undefined);
const is = (v, state, text) => v != null && v.state === state && v.text === text;

check('★1-1 7일 남은 코드 = "10월 11일까지 쓸 수 있어요"', is(L('2026-10-11T03:00:00Z'), 'ok', '10월 11일까지 쓸 수 있어요'), show(L('2026-10-11T03:00:00Z')));
check('★1-2 한국 시간 오늘 밤 11시에 끝나면 "오늘까지예요"', is(L('2026-10-05T14:00:00Z'), 'today', '오늘까지예요'), show(L('2026-10-05T14:00:00Z')));
check('1-3 12시간 남았어도 날짜가 내일이면 그 날짜를 말한다(10월 6일 0시 30분)', is(L('2026-10-05T15:30:00Z'), 'ok', '10월 6일까지 쓸 수 있어요'), show(L('2026-10-05T15:30:00Z')));
check('1-4 한국 시간 자정 직후(UTC 로는 전날)에도 오늘을 한국 날짜로 센다', is(L('2026-10-05T14:59:00Z', new Date('2026-10-04T15:00:00Z')), 'today', '오늘까지예요'), show(L('2026-10-05T14:59:00Z', new Date('2026-10-04T15:00:00Z'))));
check('★1-5 만료 시각이 지금이면 "만료됐어요"(서버는 > now() 만 받는다)', is(L(NOW.toISOString()), 'expired', '만료됐어요'), show(L(NOW.toISOString())));
check('★1-6 지난주에 끝난 코드 = "만료됐어요"', is(L('2026-09-28T03:00:00Z'), 'expired', '만료됐어요'), show(L('2026-09-28T03:00:00Z')));
check('1-7 만료일 없음(null · 빈 값) = 표시 없음(서버도 안 막는다)', inviteExpiryLabel != null && L(null) === null && L('') === null && L(undefined) === null, show([L(null), L('')]));
check('1-8 읽지 못하는 값 = 표시 없음(만료로 잘못 막지 않는다)', inviteExpiryLabel != null && L('not-a-date') === null, show(L('not-a-date')));
check('1-9 문구 금지어 없음', [L('2026-10-11T03:00:00Z'), L('2026-10-05T14:00:00Z'), L('2026-09-28T03:00:00Z')].every((v) => v && copyOk(v.text)));
check('1-10 [새 코드 받기] · 요청 안내 문구는 계획 그대로', M?.INVITE_ROTATE_LABEL === '새 코드 받기' && M?.INVITE_ASK_OWNER_TEXT === '사장님께 새 코드를 요청해 주세요' && copyOk(M?.INVITE_ASK_OWNER_TEXT), show([M?.INVITE_ROTATE_LABEL, M?.INVITE_ASK_OWNER_TEXT]));

// ── [2] 데이터 ────────────────────────────────────────────────────────
console.log('\n[2] 데이터');
const db = strip(read('src/lib/db.ts'));
const fui = (db.match(/export async function fetchUnitInfo[\s\S]*?\n\}/) || [''])[0];
check('★2-1 fetchUnitInfo 가 invite_expires_at 을 읽는다', /invite_expires_at/.test(fui) && /UnitInfoRow = \{[^}]*invite_expires_at: string \| null/.test(db), show(fui.slice(0, 160)));
const ss = strip(read('src/lib/store/useSessionStore.ts'));
check('★2-2 세션이 inviteExpiresAt 을 들고, 매장 정보에서 채운다', /inviteExpiresAt: string;/.test(ss) && /inviteExpiresAt = unit\?\.invite_expires_at \?\? '';/.test(ss) && /\n\s+inviteExpiresAt,\n/.test(ss));
check('2-3 비운 상태(로그아웃 · 매장 전환)에 inviteExpiresAt 이 함께 비워진다', /inviteCode: '', inviteExpiresAt: '',/.test(ss));
// G3(QA 2026-10-05): 30초 새로고침에서 매장 정보 읽기가 한 번 실패하면 이름·초대코드가 빈칸이 됐다.
const unitRead = (ss.match(/const \{[^}]*\} = await fetchUnitInfo\(unitId\);[\s\S]*?industry = unit\?\.industry \?\? '';[\s\S]*?\n\s+\}/) || [''])[0];
check('★G3 매장 정보 읽기 실패면 같은 사용자·같은 매장의 이전 이름·초대코드·만료일·업종을 지킨다',
  /error: unitErr/.test(unitRead) && /unitErr && \w+\.userId === userId && \w+\.unitId === unitId/.test(unitRead)
  && ['storeName', 'inviteCode', 'inviteExpiresAt', 'industry'].every((k) => new RegExp(`${k} = \\w+\\.${k};`).test(unitRead)),
  show(unitRead.slice(0, 200)));
const staff = strip(read('src/app/owner/staff.tsx'));
check('★2-4 [코드 변경] 뒤 만료일도 새 값으로 바꾼다', /useSessionStore\.setState\(\{ inviteCode: res\.inviteCode, inviteExpiresAt: res\.expiresAt \}\)/.test(staff));
const join = read('supabase/migrations/0067_junior_multistore_membership.sql');
check('2-5 서버는 만료 코드 합류를 거부한다(0067 join_by_invite · 회귀 가드)', /u\.invite_expires_at is null or u\.invite_expires_at > now\(\)/.test(join));

// ── [3] InviteBlock ───────────────────────────────────────────────────
console.log('\n[3] InviteBlock');
const ib = strip(read('src/components/owner/InviteBlock.tsx'));
check('★3-1 inviteExpiryLabel 로 만료를 판정하고 문구를 보인다', /inviteExpiryLabel\(/.test(ib) && /expiry\.text/.test(ib));
check('3-2 세션 코드와 화면 코드가 같을 때만 만료일을 쓴다(온보딩 params 코드 보호)', /code === sessionCode/.test(ib));
check('★3-3 만료되면 코드 복사 · 링크 복사 버튼을 끈다', (ib.match(/disabled=\{expired( \|\| !code)?\}/g) || []).length >= 2);
check('★G3 코드가 비면 코드 복사 · 링크 복사 버튼을 끈다(깨진 초대 문구 방지)', (ib.match(/disabled=\{expired \|\| !code\}/g) || []).length >= 2);
check('★3-4 사장에게는 [새 코드 받기] → rotateInviteCode', /INVITE_ROTATE_LABEL/.test(ib) && /rotateInviteCode\(\)/.test(ib) && /isOwner/.test(ib));
check('★3-5 사장이 아니면 "사장님께 새 코드를 요청해 주세요"', /INVITE_ASK_OWNER_TEXT/.test(ib));
check('3-6 새 코드를 받으면 세션 코드와 만료일을 바꾼다', /useSessionStore\.setState\(\{ inviteCode: res\.inviteCode, inviteExpiresAt: res\.expiresAt \}\)/.test(ib));
check('3-7 열 때마다 자동으로 재발급하지 않는다(useEffect 안 rotate 없음)', !/useEffect\([\s\S]*?rotateInviteCode[\s\S]*?\}, \[/.test(ib) && /rotateInviteCode/.test(ib));
check('3-8 화면 문구에 결제 채널 말이 없다(주석 제외)', ib.length > 0 && !CHANNEL.test(ib));

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — PASS ${pass} · FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
