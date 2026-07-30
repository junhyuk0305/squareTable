// qa-otp-seed.mjs — QA 하니스용 phone_otps 인증 시드 (공유 헬퍼)
//
// 왜 있나: 서버 게이트(_hold/0088)가 라이브면 미인증 전화번호로는 create_store(units INSERT)와
// join_by_invite(pending_unit_id 세팅)가 PHONE_NOT_VERIFIED 로 막힌다. QA는 실 SMS를 못 받으므로
// service_role 로 phone_otps 에 '인증됨' 행을 선등록해 통과시킨다.
// service_role 키가 없거나(anon 전용 환경) 테이블이 아직 없으면(0087 미적용 = 게이트도 없음)
// 조용히 스킵한다 — 게이트 전/후 어느 환경에서 돌려도 안전.
//
// 사용: import { seedVerifiedPhones, cleanupSeededPhones } from './qa-otp-seed.mjs';
//   시작 시 seedVerifiedPhones(URL, SERVICE, phones) → finally 에서 cleanupSeededPhones(...).

const headers = (serviceKey) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
});

export async function seedVerifiedPhones(url, serviceKey, phones) {
  if (!serviceKey) return { skipped: 'no-service-key' };
  const now = new Date().toISOString();
  const rows = phones.map((phone) => ({ phone, code_hash: 'qa-seed', expires_at: now, verified_at: now }));
  const res = await fetch(`${url}/rest/v1/phone_otps`, {
    method: 'POST',
    headers: { ...headers(serviceKey), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (res.status === 404) return { skipped: 'no-table' }; // 0087 미적용 환경 — 게이트도 없으니 불필요
  if (!res.ok) throw new Error(`phone_otps 시드 실패: ${res.status} ${await res.text()}`);
  return { seeded: rows.length };
}

// 자가정리 — 시드한 QA 번호 행 제거(실사용 번호 행은 건드리지 않는다: code_hash='qa-seed' 한정).
export async function cleanupSeededPhones(url, serviceKey, phones) {
  if (!serviceKey || !phones.length) return;
  const list = phones.map((p) => `"${p}"`).join(',');
  try {
    await fetch(`${url}/rest/v1/phone_otps?phone=in.(${list})&code_hash=eq.qa-seed`, {
      method: 'DELETE',
      headers: headers(serviceKey),
    });
  } catch { /* best-effort */ }
}
