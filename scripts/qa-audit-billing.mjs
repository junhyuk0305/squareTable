#!/usr/bin/env node
// qa-audit-billing.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 결제·환불 묶음 재현 검사.
//   [B1] 스토어 환불은 그 거래가 지금 살아 있는 구독일 때만 매장을 회수한다. 다른 채널이 이어 가면 회수하지 않는다.
//        운영자 카드 환불도 앱 구독이 살아 있으면 매장을 회수하지 않는다.
// 서버 함수는 마지막 정의(가장 큰 번호 마이그레이션) 본문을 읽어 본다. 로컬 도커가 꺼진 날에도 돈다.
// 실행: node --no-warnings scripts/qa-audit-billing.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, extra)); };
const read = (p) => (existsSync(new URL(`../${p}`, import.meta.url)) ? readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') : '');
const sqlStrip = (s) => s.replace(/--.*$/gm, '');

// 함수의 마지막 정의 본문(가장 큰 번호 마이그레이션). create [or replace] function public.<name>( … $$; 까지.
const lastDef = (name) => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let body = '', file = '';
  for (const f of files) {
    const s = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n');
    const re = new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const m of s.matchAll(re)) { body = m[0]; file = f; }
  }
  return { body: sqlStrip(body), file };
};
// 권한 줄이 그 정의 파일에 그대로 있는가.
const grants = (file, sig, role) => {
  const s = read(`supabase/migrations/${file}`);
  return s.includes(`revoke all on function public.${sig}`) && (!role || new RegExp(`grant execute on function public\\.${sig.replace(/[()[\]]/g, '\\$&')}\\s*to ${role};`).test(s));
};

console.log('[B1] 환불은 그 거래로 연 몫만 회수한다');
{
  const a = lastDef('apply_iap_event');
  const refund = a.body.match(/if v_refund then[\s\S]*?\n  end if;/)?.[0] ?? '';
  check('★환불 분기가 그 거래가 살아 있는지(v_cur 상태·기간) 본다',
    /v_cur\.id is not null/.test(refund) && /v_cur\.status in \('active', 'grace', 'canceled'\)/.test(refund) && /v_cur\.current_period_end > v_now/.test(refund), a.file);
  check('★다른 앱 구독이 살아 있으면 회수하지 않는다', /not public\.iap_subscription_live\(p_owner\)/.test(refund));
  check('★카드 구독이 이어 가면 회수하지 않는다', /card_subscriptions/.test(refund) && /'active', 'past_due'/.test(refund));
  check('회수 안 한 환불도 행은 refunded 로 적고 revoked=false 를 돌려준다', /'revoked', false/.test(refund) && /when v_refund then 'refunded'/.test(a.body));
  check('apply_iap_event 권한 유지(service_role 만)', grants(a.file, 'apply_iap_event(uuid, text, text, text, text, text, int, timestamptz, text, timestamptz, jsonb)'));
  const c = lastDef('card_record_refund');
  check('★운영자 카드 환불도 앱 구독이 살아 있으면 매장을 회수하지 않는다',
    /not public\.iap_subscription_live\(v_pay\.owner_id\)/.test(c.body) && /revoke_iap_access/.test(c.body), c.file);
  check('card_record_refund 권한 유지(service_role 만)', grants(c.file, 'card_record_refund(text, int, boolean, jsonb)', 'service_role'));
}

console.log(`\n${fail === 0 ? 'OK' : 'FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
