// 「전자상거래 등에서의 소비자보호에 관한 법률」 제10조·제13조상 판매자 정보 고지 SSOT.
//
// ★ 사업자등록증·통신판매업 신고증을 받으면 아래 빈 문자열 3줄(bizRegNo·mailOrderNo·address)만
//   채우면 된다. 다른 파일은 손대지 않는다.
//   ★ 빈 문자열이면 그 행이 화면에 렌더되지 않는다 — '등록 예정' 같은 placeholder 를 남기면
//   App Review Guideline 2.1(a)("placeholder text ... should be scrubbed before submission")에 걸린다.
//
// ★ phone 은 아직 확보하지 못한 값이라 비워 둔다. 전자상거래법 제13조 제1항 2호는 주소·전화번호·
//   전자우편주소를 함께 표시하도록 요구하므로, 유료 판매를 여는 시점 전에 대표번호(070 등)를
//   확보해 여기에 채워야 한다. 채워지면 자동으로 행이 렌더된다.
//
// ★ 대외 창구는 cristianojun@naver.com 하나로 통일한다. 결제 문의·환불 요청·개인정보
//   권리행사가 전부 이 주소로 오므로, 다른 주소를 대외 문서에 섞지 않는다.

export const BUSINESS_INFO = {
  companyName: '스퀘어테이블', // 사업자등록증 상호 그대로. legal-content.mjs 의 OPERATOR 와 항상 같아야 한다
  ceo: '장준혁',
  bizRegNo: '466-03-04380',
  mailOrderNo: '', // ← 통신판매업 신고증 수령 후 여기만 (예: '제2026-서울구로-1234호')
  address: '서울특별시 구로구 남부순환로95길 54, 106동 1504호',
  phone: '', // ← 고객센터 대표번호 확보 후 (예: '070-1234-5678')
  email: 'cristianojun@naver.com',
  hosting: 'Supabase / Vercel',
} as const;

/**
 * 이용약관 시행일 — 주문 시점 동의 기록(payment_claims.terms_version, 0116)에 그대로 저장한다.
 * ★SSOT 는 scripts/legal-content.mjs 의 EFFECTIVE_DATE 다(.ts 에서 .mjs 를 import 할 수 없어 복제).
 *   약관을 개정하면 **두 곳을 함께** 고친다 — 어긋나면 실제로 동의한 조건을 특정할 수 없게 된다.
 */
export const TERMS_VERSION = '2026-08-07';

/**
 * 입금 확인 약속(SLA) — 계좌이체는 사람이 통장을 보고 승인하는 구조라, 이 문장이 없으면
 * 사장은 "돈은 보냈는데 앱이 안 열리는" 무음 구간에 갇힌다.
 * ★시간(hour)이 아니라 영업일로 건다 — 밤·주말 입금을 자동으로 덮고, 1인 운영에서 지킬 수 있다.
 * ★같은 문장이 앱·웹·인스타 응대에 동일하게 쓰인다. 여기가 SSOT.
 */
export const PAYMENT_SLA_SENTENCE = '평일 10시~19시에 확인하고, 늦어도 다음 영업일 안에 열어드려요.';

/** 값이 채워진 행만 [라벨, 값] 쌍으로 돌려준다. 빈 값은 렌더하지 않는다. */
export function businessRows(): [string, string][] {
  const b = BUSINESS_INFO;
  return (
    [
      ['상호', b.companyName],
      ['대표자', b.ceo],
      ['사업자등록번호', b.bizRegNo],
      ['통신판매업 신고번호', b.mailOrderNo],
      ['주소', b.address],
      ['고객센터', b.phone],
      ['고객문의', b.email],
      ['호스팅 제공자', b.hosting],
    ] as [string, string][]
  ).filter(([, v]) => !!v);
}

/**
 * 전자상거래법 제10조·제13조가 요구하는 고지 항목이 전부 채워졌는가(유료 판매 고지 노출 판정용).
 * 제13조 제1항 2호가 전화번호까지 요구하므로 phone·address 도 함께 본다.
 */
export const BUSINESS_INFO_COMPLETE =
  !!BUSINESS_INFO.bizRegNo && !!BUSINESS_INFO.mailOrderNo && !!BUSINESS_INFO.address && !!BUSINESS_INFO.phone;
