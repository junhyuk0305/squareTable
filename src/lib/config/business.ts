// 「전자상거래 등에서의 소비자보호에 관한 법률」 제10조·제13조상 판매자 정보 고지 SSOT.
//
// ★ 사업자등록증·통신판매업 신고증을 받으면 아래 빈 문자열 3줄(bizRegNo·mailOrderNo·address)만
//   채우면 된다. 다른 파일은 손대지 않는다.
//   ★ 빈 문자열이면 그 행이 화면에 렌더되지 않는다 — '등록 예정' 같은 placeholder 를 남기면
//   App Review Guideline 2.1(a)("placeholder text ... should be scrubbed before submission")에 걸린다.
//
// ★ phone = 전자상거래법 제13조 제1항 2호의 전화번호(2026-09-15 사용자 확정, 토스페이먼츠 카드사
//   심사 제출값). 토스 온보딩팀이 하단 사업자정보에 사업장 연락처 기재를 요청해 2026-09-22 반영했다.
//   토스 FAQ 기준 유선번호 자리에 휴대폰번호도 허용된다.
//   ⛔카드사 심사(회신 B 발송 후 10~14일) 중에는 이 값을 바꾸면 반려다.
//   legal-content.mjs 의 BUSINESS.phone 과 public/*.html 푸터에 같은 값이 복제돼 있다.
//
// ★ 대외 창구는 cristianojun@naver.com 하나로 통일한다. 결제 문의·환불 요청·개인정보
//   권리행사가 전부 이 주소로 오므로, 다른 주소를 대외 문서에 섞지 않는다.

export const BUSINESS_INFO = {
  companyName: '스퀘어테이블', // 사업자등록증 상호 그대로. legal-content.mjs 의 OPERATOR 와 항상 같아야 한다
  ceo: '장준혁',
  bizRegNo: '466-03-04380',
  mailOrderNo: '', // ← 통신판매업 신고증 수령 후 여기만 (예: '제2026-서울구로-1234호')
  address: '서울특별시 구로구 남부순환로95길 54, 106동 1504호',
  phone: '010-8282-9583',
  email: 'cristianojun@naver.com',
  hosting: 'Supabase / Vercel',
} as const;

/**
 * 이용약관 시행일 — 주문 시점 동의 기록(payment_claims.terms_version, 0116)에 그대로 저장한다.
 * ★SSOT 는 scripts/legal-content.mjs 의 EFFECTIVE_DATE 다(.ts 에서 .mjs 를 import 할 수 없어 복제).
 *   약관을 개정하면 **두 곳을 함께** 고친다 — 어긋나면 실제로 동의한 조건을 특정할 수 없게 된다.
 */
// ★v2.1 = 2026-09-13 즉시 시행(공고일 = 시행일, 사용자 결정). v2 의 시행일도 09-13 이라 날짜만으로는 둘이
//   구별되지 않는다 — 실유료 고객 0명이라 받아들인 것이다. 다음 개정부터는 날짜가 겹치지 않게 한다.
export const TERMS_VERSION = '2026-09-13';

/**
 * 입금 확인 약속(SLA) — 계좌이체는 사람이 통장을 보고 승인하는 구조라, 이 문장이 없으면
 * 사장은 "돈은 보냈는데 앱이 안 열리는" 무음 구간에 갇힌다.
 * ★시간(hour)이 아니라 영업일로 건다 — 밤·주말 입금을 자동으로 덮고, 1인 운영에서 지킬 수 있다.
 * ★같은 문장이 앱·웹·인스타 응대에 동일하게 쓰인다. 여기가 SSOT.
 */
export const PAYMENT_SLA_SENTENCE = '평일 10시~19시에 확인하고, 늦어도 다음 영업일 안에 열어드려요.';

