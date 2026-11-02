// qa-staff.mjs — 하니스가 직원을 만드는 길 하나(2026-11-02)
//
// 0346(즉시 합류)에서 합류 규칙이 바뀌자 하니스 15개를 한꺼번에 고쳤다. 저마다 "join_by_invite → approve_member"를
// 손으로 적어 두었기 때문이다. 다음에 합류 규칙이 바뀌면 이 파일 하나만 고친다.
//   joinAsStaff  — 초대 코드로 합류. 실패하면 던진다(조용히 넘어가 다음 검사가 엉뚱하게 깨지지 않게).
//   seedPending  — 0346 전 옛 신청(대기 행)을 service_role 로 심는다. 승인·반려 경로를 잴 때만 쓴다.
// 0346부터 approve_member 는 이미 멤버면 아무것도 안 한다. 그래서 joinAsStaff 뒤에 부르지 않는다.

/** 초대 코드로 합류한다. 반환 = { unit_id, store_name }. */
export async function joinAsStaff(client, code) {
  const { data, error } = await client.rpc('join_by_invite', { p_code: code });
  if (error) throw new Error(`join_by_invite(${code}): ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.unit_id) throw new Error(`join_by_invite(${code}): 빈 결과`);
  return { unit_id: row.unit_id, store_name: row.store_name };
}

/** 옛 신청 대기 행을 심는다. 이미 그 매장 멤버면 거부한다(승인 경로가 no-op 이 돼 검사가 거짓말한다). */
export async function seedPending(admin, uid, unit) {
  const { data: m, error: me } = await admin.from('unit_members').select('role').eq('user_id', uid).eq('unit_id', unit).maybeSingle();
  if (me) throw new Error(`seedPending 멤버 확인: ${me.message}`);
  if (m) throw new Error(`seedPending: ${uid} 는 이미 ${unit} 멤버(${m.role})`);
  const { data, error } = await admin.from('profiles').update({ pending_unit_id: unit }).eq('id', uid).select('id');
  if (error) throw new Error(`seedPending(${unit}): ${error.message}`);
  // 없는 uid 는 0행 갱신으로 조용히 끝난다. 심은 줄이 정확히 1개인지 본다.
  if ((data ?? []).length !== 1) throw new Error(`seedPending(${unit}): 프로필 ${uid} 를 찾지 못했다`);
}
