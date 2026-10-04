// 가입 동의 항목 정본 (J12). 가입 화면과 프로필 완성 화면이 같은 행을 쓴다.
// 키는 서버 허용 목록(0240 user_consents.item)과 글자까지 같아야 한다. 다르면 서버가 그 항목을 조용히 버린다.
// 버전은 결제 동의와 같은 TERMS_VERSION 을 보낸다(0230 선례).
// 마케팅 동의는 저장도 사용도 하지 않아서 뺐다. 법률 문서 쪽 정리는 토스 동결 뒤 법무 판단과 함께 한다.
import { TERMS_VERSION } from './business';

export type ConsentKey = 'age14' | 'terms' | 'privacy_collect' | 'labor';
export type ConsentDoc = '/terms' | '/legal/collect' | '/legal/labor';
export type ConsentRow = { key: ConsentKey; label: string; doc?: ConsentDoc };
export type ConsentChecked = Partial<Record<ConsentKey, boolean>>;

const BASE_ROWS: ConsentRow[] = [
  { key: 'age14', label: '만 14세 이상입니다' },
  { key: 'terms', label: '서비스 이용약관', doc: '/terms' },
  { key: 'privacy_collect', label: '개인정보 수집·이용', doc: '/legal/collect' },
];
const LABOR_ROW: ConsentRow = { key: 'labor', label: '근로·급여정보 처리', doc: '/legal/labor' };

/** 역할별 동의 행. 모두 필수다. 직원은 근로·급여정보 처리가 더 붙는다. */
export function consentRows(role: 'owner' | 'junior'): ConsentRow[] {
  return role === 'owner' ? BASE_ROWS : [...BASE_ROWS, LABOR_ROW];
}

export function allConsented(role: 'owner' | 'junior', checked: ConsentChecked): boolean {
  return consentRows(role).every((r) => !!checked[r.key]);
}

/** 서버로 보낼 값. signUp 메타와 record_my_consents 가 같이 쓴다. 화면 행에 없는 키는 싣지 않는다. */
export function consentPayload(role: 'owner' | 'junior', checked: ConsentChecked): { consents: ConsentKey[]; consent_version: string } {
  return {
    consents: consentRows(role).filter((r) => !!checked[r.key]).map((r) => r.key),
    consent_version: TERMS_VERSION,
  };
}

/** 앱 판정(isUnder14)과 서버 under_14(0240) 오류가 같은 문구를 쓴다. */
export const UNDER_14_TEXT = '만 14세 미만은 가입할 수 없어요.';
