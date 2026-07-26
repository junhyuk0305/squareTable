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
// ★ 대외 창구는 contact@team-roundtable.com 하나로 통일한다. 결제 문의·환불 요청·개인정보
//   권리행사가 전부 이 주소로 오므로, 개인 계정 주소를 대외 문서에 섞지 않는다.

export const BUSINESS_INFO = {
  companyName: '팀 스퀘어테이블',
  ceo: '장준혁',
  bizRegNo: '', // ← 사업자등록증 수령 후 여기만 (예: '123-45-67890')
  mailOrderNo: '', // ← 통신판매업 신고증 수령 후 여기만 (예: '제2026-서울마포-1234호')
  address: '', // ← 사업자등록증 기재 주소 그대로
  phone: '', // ← 고객센터 대표번호 확보 후 (예: '070-1234-5678')
  email: 'contact@team-roundtable.com',
  hosting: 'Supabase / Vercel',
} as const;

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
