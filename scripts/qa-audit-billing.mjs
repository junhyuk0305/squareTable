#!/usr/bin/env node
// qa-audit-billing.mjs — 2026-10-05 논리 점검(QA_논리점검_2026-10-05.md) 결제·환불 묶음 재현 검사.
//   [B1] 스토어 환불은 그 거래가 지금 살아 있는 구독일 때만 매장을 회수한다. 다른 채널이 이어 가면 회수하지 않는다.
//        운영자 카드 환불도 앱 구독이 살아 있으면 매장을 회수하지 않는다.
//   [B2] 구독 흔적 매장에 붙은 1매장 계좌이체 기간은 선불로 보고, 앱 환불이 지우지 않는다.
//   [B3] 선불과 겹쳐 시작한 구독(carry)도 "늘었어요/끝나요" 알림이 나가고, 날짜는 매장의 실제 만료일이다.
//   [B4] 앱 "매장 수 줄이기"는 구독으로 연 열린 매장만 닫을 후보로 센다(카드 쪽 card_release_candidates 와 같은 규칙).
//   [B7] 늦게 재전송된 옛 웹훅(event_timestamp_ms 가 더 이른 것)은 같은 거래의 최신 상태를 덮지 않는다.
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

console.log('\n[B2] 구독 흔적 매장에 붙은 1매장 계좌이체 기간은 앱 환불에도 남는다');
{
  const h = lastDef('unit_claim_until');
  check('★승인된 1매장 신고가 만든 끝(이어 붙인 계산)을 구하는 판정이 있다',
    /payment_claims/.test(h.body) && /status = 'approved'/.test(h.body) && /plan = 'single'/.test(h.body) && /make_interval\(days => r\.months \* 30\)/.test(h.body), h.file || '없음');
  check('unit_claim_until 은 내부 판정이다(클라 실행 불가)', !!h.file && read(`supabase/migrations/${h.file}`).includes('revoke all on function public.unit_claim_until(text) from public, anon, authenticated;'));
  const p = lastDef('unit_prepaid');
  check('★unit_prepaid 가 그 기간이 남은 흔적 매장을 선불로 본다', /public\.unit_claim_until\(p_unit\) > now\(\)/.test(p.body), p.file);
  const r = lastDef('revoke_iap_access');
  check('★revoke_iap_access 가 그 기간을 남의 돈(v_pre)으로 본다', /public\.unit_claim_until\(u\)/.test(r.body), r.file);
  check('revoke_iap_access 권한 유지(service_role 만)', grants(r.file, 'revoke_iap_access(uuid, text)', 'service_role'));
}

console.log('\n[B3] 선불과 겹쳐 시작한 구독(carry)도 "늘었어요/끝나요" 알림이 나간다');
{
  const u = lastDef('sub_alert_unit');
  check('★늘었어요·끝나요 매장 판정이 기간 끝 + 그 매장 흔적의 carry 와 비교한다',
    /max\(s\.carry\)/.test(u.body) && /us\.paid_until between p_end \+ /.test(u.body) && !/us\.paid_until between p_end - interval '1 hour'/.test(u.body), u.file);
  check('sub_alert_unit 권한 유지(내부 판정)', read(`supabase/migrations/${u.file}`).includes('revoke all on function public.sub_alert_unit(uuid, text, timestamptz) from public, anon, authenticated;'));
  const p = lastDef('sub_alert_put');
  check('★알림 날짜 = 고른 매장의 실제 만료일(기간 끝 + carry)', /card_alert_day\(v_day\)/.test(p.body) && /carry/.test(p.body), p.file);
  check('같은 일은 한 번만 보낸다(period 는 기간 끝 그대로)', /v_period text := p_owner::text \|\| ':' \|\| to_char\(p_end at time zone 'UTC'/.test(p.body));
  check('sub_alert_put 권한 유지(내부)', read(`supabase/migrations/${p.file}`).includes('revoke all on function public.sub_alert_put(uuid, text, timestamptz) from public, anon, authenticated;'));
}

console.log('\n[B4] 앱 "매장 수 줄이기"는 구독으로 연 매장만 닫을 후보로 센다');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const panel = strip(read('src/components/IapPurchasePanel.tsx'));
  check('★패널이 닫을 매장 후보를 서버 목록(구독 흔적이 있는 열린 매장)으로 읽는다', /fetchMyCardReleaseCandidates\(\)/.test(panel));
  check('★닫을 수 = 그 후보 수 − 새 매장 수', /openStores: releaseCands\.length/.test(panel) && !/openStores: ownedStores\.length/.test(panel));
  check('★고르는 목록도 그 후보다', /needRelease > 0 && releaseCands\.map\(/.test(panel) && !/needRelease > 0 && ownedStores\.map\(/.test(panel));
  check('서버에 새 매장 수를 같이 보낸다', /rpcChooseIapRelease\(release, selected\?\.storeCount\)|rpcChooseIapRelease\(release, offer\.storeCount\)/.test(panel));
  const db = read('src/lib/db.ts');
  check('rpcChooseIapRelease 가 p_count 를 보낸다', /rpc\('choose_iap_release', \{ p_units: unitIds, p_count: count \}\)/.test(db));
  const c = lastDef('choose_iap_release');
  check('★서버가 후보 포함·개수를 검증해 release_mismatch 로 거부한다',
    /p_count\s+int default null/.test(c.body) && /card_release_candidates\(v_uid\)/.test(c.body) && /release_mismatch/.test(c.body) && /greatest\(0, cardinality\(v_open\) - p_count\)/.test(c.body), c.file);
  check('choose_iap_release 권한 유지(authenticated)', grants(c.file, 'choose_iap_release(text[], int)', 'authenticated'));
  check('옛 1인자 판은 지운다(이름 인자 호출이 모호해지지 않게)', /drop function if exists public\.choose_iap_release\(text\[\]\);/.test(read(`supabase/migrations/${c.file}`)));
}

console.log('\n[B7] 늦게 도착한 옛 웹훅은 최신 구독 상태를 덮지 않는다');
{
  const a = lastDef('apply_iap_event');
  const all = (() => {
    const dir = new URL('../supabase/migrations/', import.meta.url);
    return readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  })();
  check('iap_subscriptions 에 마지막 이벤트 시각 열이 있다', /alter table public\.iap_subscriptions add column if not exists last_event_at timestamptz/.test(all));
  check('★이벤트 시각(event_timestamp_ms)을 읽는다', /p_raw -> 'event' ->> 'event_timestamp_ms'/.test(a.body), a.file);
  const stale = a.body.match(/v_evt_at < v_cur\.last_event_at[\s\S]*?end if;/)?.[0] ?? '';
  check('★그 거래의 마지막 이벤트보다 오래된 이벤트는 아무것도 바꾸지 않고 끝낸다', /'stale', true/.test(stale));
  check('★옛 이벤트 판정이 줄이기 예고·상태 대입보다 먼저다',
    a.body.indexOf('v_evt_at < v_cur.last_event_at') > 0 && a.body.indexOf('v_evt_at < v_cur.last_event_at') < a.body.indexOf("if p_type = 'PRODUCT_CHANGE' and v_cur.id is not null"));
  check('★상태를 쓸 때 마지막 이벤트 시각을 남긴다(늦은 것으로 줄이지 않음)', /last_event_at = greatest\(iap_subscriptions\.last_event_at, excluded\.last_event_at\)/.test(a.body));
  check('줄이기 예고 분기도 이벤트 시각을 남긴다', /pending_at = v_cur\.current_period_end,[\s\S]*?last_event_at = greatest\(last_event_at, v_evt_at\)/.test(a.body));
}

console.log(`\n${fail === 0 ? 'OK' : 'FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
