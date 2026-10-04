// supabase/functions/otp/helpers.ts — otp 엣지의 순수 함수(Deno·Node 둘 다 import 한다. 외부 import 금지).
// 검사: scripts/qa-account-security.mjs [4] 진리표.

/**
 * 이메일을 가린다(0238 Q15). 번호를 도용당해도(SIM 스왑) 전체 주소가 새지 않게 한다.
 *   로컬부: 3자 이상이면 앞 2자, 그보다 짧으면 앞 1자 + '****'(길이를 드러내지 않는다).
 *   도메인: 첫 마디의 첫 글자 + '****' + 나머지 마디 그대로. 예) mail.example.co.kr → m****.example.co.kr
 *   형식이 아니면 '****', 비었으면 ''.
 */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? '').trim();
  if (!e) return '';
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return '****';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const head = local.slice(0, local.length >= 3 ? 2 : 1);
  const dot = domain.indexOf('.');
  const tail = dot > 0 ? domain.slice(dot) : '';
  return `${head}****@${domain[0]}****${tail}`;
}
