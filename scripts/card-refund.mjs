#!/usr/bin/env node
// card-refund.mjs — 카드 정기결제 환불(운영자 전용). 약관 제13조 처리 도구.
//
//   기본은 계획만 출력한다(dry run). --execute 일 때만 토스 취소 API → DB 반영(card_record_refund) 순서로 실행한다.
//   ★순서가 중요하다: 토스 취소가 성공한 뒤에만 DB 를 바꾼다. 반대로 하면 돈은 안 돌려줬는데 매장만 닫힌다.
//
// 사용:
//   TOSS_SECRET_KEY=live_sk_... node scripts/card-refund.mjs --order FP20261001_xxxx                 # 잔액 전부(7일 내 청약철회)
//   TOSS_SECRET_KEY=... node scripts/card-refund.mjs --order RN20261101_xxxx --prorate --execute    # 남은 기간 일할 환불(제13조 3항)
//   TOSS_SECRET_KEY=... node scripts/card-refund.mjs --order UP..._xxxx --amount 12000 --no-revoke --execute  # 과오금 일부만
// 옵션:
//   --amount N   취소할 금액(원). 없으면 잔액 전부. --prorate 와 같이 쓰지 않는다.
//   --prorate    구독의 현재 이용 기간 중 남은 비율만큼(10원 단위 내림) — 그 기간을 결제한 주문에만 쓴다.
//   --no-revoke  매장을 닫지 않는다(과오금 일부 환불). 기본은 환불과 함께 구독 종료 + 매장 회수.
//   --reason "…" 토스에 남길 취소 사유(기본: 고객 요청 환불)
// 키: TOSS_SECRET_KEY 는 실행할 때만 환경변수로 넣는다(.env 파일에 두지 않는다).
// 검증: 2026-09-15 로컬 Supabase + 토스 테스트 키로 갱신 주문 전액 취소 → 토스 CANCELED · 구독 refunded · 매장 회수 확인.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of ['.env', '.env.seed']) {
    try {
      for (const line of readFileSync(join(root, f), 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].trim();
      }
    } catch { /* */ }
  }
  return env;
}

// ★process.exit() 를 쓰지 않는다 — Windows 에서 fetch 소켓이 닫히는 중에 끊으면 libuv assertion 이 찍힌다. exitCode + return.
async function main() {
  const env = loadEnv();
  const URL = env.EXPO_PUBLIC_SUPABASE_URL;
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
  const TOSS = env.TOSS_SECRET_KEY;

  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const flag = (name) => args.includes(name);
  const orderId = opt('--order');
  const execute = flag('--execute');
  const revoke = !flag('--no-revoke');
  const reason = opt('--reason') ?? '고객 요청 환불';
  const fail = (msg, code = 1) => { console.error('FAIL:', msg); process.exitCode = code; };

  if (!URL || !SERVICE) return fail('EXPO_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 필요', 2);
  if (!orderId) return fail('--order <주문번호> 가 필요해요', 2);

  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  const sel = async (path) => (await fetch(`${URL}/rest/v1/${path}`, { headers: H })).json();

  const [pay] = await sel(`card_payments?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
  if (!pay) return fail('주문을 찾을 수 없어요');
  if (!['done', 'partial_canceled'].includes(pay.status)) return fail(`환불할 수 없는 상태 — ${pay.status}`);
  const balance = pay.amount_krw - pay.canceled_amount_krw;

  let amount = balance;
  if (opt('--amount')) amount = Number(opt('--amount'));
  if (flag('--prorate')) {
    const [sub] = await sel(`card_subscriptions?owner_id=eq.${pay.owner_id}&select=current_period_start,current_period_end`);
    if (!sub) return fail('구독이 없어 일할 계산을 할 수 없어요');
    const start = new Date(sub.current_period_start).getTime();
    const end = new Date(sub.current_period_end).getTime();
    // 기간이 아직 시작 전이면(기간 끝 하루 전 갱신 직후) 남은 비율은 100% 로 본다.
    const left = Math.min(1, Math.max(0, end - Date.now()) / (end - start));
    amount = Math.min(balance, Math.floor((pay.amount_krw * left) / 10) * 10);
    console.log(`일할: 남은 비율 ${(left * 100).toFixed(1)}% → ${amount}원`);
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > balance) return fail(`금액이 잘못됐어요(1~${balance})`);

  console.log({
    주문: pay.order_id, 종류: pay.kind, 결제금액: pay.amount_krw, 이미취소: pay.canceled_amount_krw,
    이번취소: amount, 매장회수: revoke, livemode: pay.livemode, 사유: reason,
  });
  if (!execute) {
    console.log('\n(dry run) 실제로 하려면 --execute 를 붙이세요.');
    return;
  }
  if (!TOSS) return fail('TOSS_SECRET_KEY 가 필요해요', 2);
  if (TOSS.startsWith('live_') !== pay.livemode) return fail('키 모드(테스트/라이브)와 주문 모드가 달라요');

  const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(pay.payment_key)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(TOSS + ':').toString('base64'),
      'Content-Type': 'application/json',
      'Idempotency-Key': `refund_${pay.order_id}_${pay.canceled_amount_krw}_${amount}`,
    },
    body: JSON.stringify({ cancelReason: reason, ...(amount < balance ? { cancelAmount: amount } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return fail(`토스 취소 실패 — ${body.code} ${body.message}`);
  console.log('토스 취소 완료:', body.status, body.balanceAmount);

  const r = await fetch(`${URL}/rest/v1/rpc/card_record_refund`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ p_order_id: pay.order_id, p_cancel_amount: amount, p_revoke: revoke, p_raw: body }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok) {
    // 돈은 이미 돌려줬다 — DB 만 어긋난 상태. 같은 명령을 다시 돌리지 말고(토스는 멱등키로 막지만) 아래 값으로 수동 반영한다.
    console.error(`  수동: select card_record_refund('${pay.order_id}', ${amount}, ${revoke}, null);`);
    return fail(`토스 취소는 됐지만 DB 반영 실패 — ${JSON.stringify(out)}`);
  }
  console.log('DB 반영 완료:', out);
}

await main();
