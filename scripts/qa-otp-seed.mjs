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
//
// ★ 잔존 방어(2026-08-11 P1-#2): cleanup 은 finally 의 best-effort라 스크립트가 예외·강제종료로 죽으면
//   '인증됨' 행이 그대로 남는다. 게이트(0088 phone_verified_ok)는 **번호만** 보고 QA행/실사용행을
//   구분하지 않으므로, 남은 행은 그 번호 소유자가 SMS 없이 가입 게이트를 통과하는 구멍이 된다
//   (실측: 최고 11일 경과분 포함 18건 잔존). 그래서 시드할 때마다 **오래된 qa-seed 행을 먼저 청소**한다
//   — 다음 QA 실행이 이전 실행의 잔해를 반드시 걷어가므로 구멍이 누적되지 않는다.
//   게이트 함수에서 'qa-seed' 를 통째로 제외하는 안은 **기각**: 이 헬퍼에 의존하는 하니스 35개가 전부 죽는다.
const STALE_MS = 60 * 60 * 1000; // 1시간 — QA 실행은 분 단위라 진행 중인 시드를 건드리지 않는다

const headers = (serviceKey) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
});

// 이전 실행이 남긴 qa-seed 행 청소. 실패해도 시드는 진행한다(청소는 부수 작업).
async function pruneStaleSeeds(url, serviceKey) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  try {
    await fetch(`${url}/rest/v1/phone_otps?code_hash=eq.qa-seed&verified_at=lt.${cutoff}`, {
      method: 'DELETE',
      headers: headers(serviceKey),
    });
  } catch { /* best-effort */ }
}

export async function seedVerifiedPhones(url, serviceKey, phones) {
  if (!serviceKey) return { skipped: 'no-service-key' };
  await pruneStaleSeeds(url, serviceKey);
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
