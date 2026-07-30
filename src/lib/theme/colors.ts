/**
 * 디자인 토큰 — 착착(CHACHAK) 디자인 시스템 v1 (2026-06-26 확정).
 * 원칙: 라이트 고정 · 노랑(#FFE14D)은 액센트 only · 검정은 컴포넌트 단위 · 소프트 드롭섀도.
 * export 이름은 기존과 동일 — 값만 새 팔레트로 교체했다. (54개 파일이 자동 반영)
 * SSOT: 착착_디자인시스템.md / 착착_디자인_확정안.html
 *
 * ▸ 2026-07-06 토스식 배경/그림자 개정 (§2 참조): 앱 배경 = 웜 페이퍼(#FAF8F2/#F1EFE9) → **완전 흰색**.
 *   카드는 보더에 기대지 않고 **넓고 옅은 그림자(Elevation)로 떠 보이게** — 보더 라인은 쿨·라이트로 후퇴,
 *   소프트 틴트(bgSoft/paper)는 쿨 그레이로. 값만 교체하므로 토큰 참조 화면 전부 자동 반영.
 */

// 4 카테고리 — 밝고 선명한 '한 가족'. 노랑 액센트와 조화되도록 따뜻한 톤 위주로 올리되
//  꿀팁은 노랑 계열(앰버골드)로 붙이고 나머지는 서로 구분되게 채도를 살렸다(2026-07-23 밝게 개정).
export const CategoryColors = {
  Routine:  '#3E92D9',   // 브라이트 블루 — 반복 업무 (차분한 앵커)
  Event:    '#F26A50',   // 코랄 — 돌발 상황 (밝고 경고감)
  Context:  '#2FAF6B',   // 프레시 그린 — 매장 룰·위치
  'Know-how': '#F2A83C', // 앰버골드 — 꿀팁·노하우 (노랑과 한 가족, 더 진해 액센트와 구분)
} as const;

export const CategoryColorsSoft = {
  Routine:  '#E7F2FC',
  Event:    '#FDEBE7',
  Context:  '#E4F6EC',
  'Know-how': '#FCF1DB',
} as const;

// 커스텀 카테고리(매장이 직접 만든 종류) — 기본 4색과 겹치지 않는 바이올렛 단일색.
// 커스텀끼리 색을 나누지 않는다(색 선택 UI 없음 — 단순함 원칙).
export const CustomCategoryColor = '#8A63D2';
export const CustomCategoryColorSoft = '#EFEAFA';

export const InkColors = {
  ink:    '#111111',   // 주색 · 텍스트 · 1차 버튼/말풍선 배경
  ink2:   '#6b6b6b',   // 본문 보조 텍스트 (--soft)
  ink3:   '#a4a29b',   // 흐린 메타 · 비활성 · 플레이스홀더 (--faint)
  line:   '#EAECEF',   // 보더 — 쿨·라이트(토스식). 흰 배경에서 존재감↓, 리프트는 그림자가 담당. (옛 #E7E5DE)
  bg:     '#FFFFFF',
  bgSoft: '#F4F5F7',   // 소프트 표면 틴트(칩·게이지트랙·안내박스) = 쿨 그레이. (옛 웜 페이퍼 #F1EFE9)
  paper:  '#F4F5F7',   // 명시적 별칭(= bgSoft)
  bubble: '#111111',   // 사용자 발화 버블 = 검정 (텍스트는 흰색)
  bubbleText: '#FFFFFF', // 말풍선/노랑면 위 흰 글씨 (리터럴 #FFFFFF 대체용 명시 토큰)
  cream:  '#FFFFFF',   // 앱/화면/프레임 배경 = 완전 흰색(토스식, 2026-07-06). 옛 웜 페이퍼 #FAF8F2 폐기
  scrim:  'rgba(255,255,255,0.61)', // 반투명 흰 배경(날짜 디바이더 칩 등) — 기존 #ffffff9c
} as const;

export const BrandColors = {
  brand:     '#111111',   // 기본 액션(CTA) = 잉크 블랙
  brand2:    '#2a2a2a',   // 그라데이션 보조
  brandSoft: '#F4F5F7',   // 소프트 중립 표면(선택/보조 틴트) = 쿨 그레이. (옛 웜 #F1EFE9)
  // 핵심 액센트 = 마커 옐로. (워드마크 밑줄·완료·강조·게이지)
  yellow:     '#FFE14D',
  yellowDeep: '#F5C518',  // 게이지 그라데이션 끝 · 옐로 요소 테두리/그림자
  yellowSoft: '#FFF3B8',  // 옐로 배경 틴트(배너·아이콘 바탕)
  // accent = "강조/경고성 단일 액센트". 기존 벽돌색이 에러·위험·삭제 텍스트로 광범위 사용 →
  // 가독성 유지 위해 노랑이 아니라 상태 레드(bad)로 매핑.
  accent:     '#c44b4b',
  accentSoft: '#F6E6E6',
  good:       '#1c7d3f',  // 완료
  warn:       '#c98a2e',  // 대기 · 주의/확인필요 텍스트·아이콘
  bad:        '#c44b4b',  // 지연/에러
  // 주의/확인필요 표면(앰버) — 브랜드 노랑(#FFE14D=긍정 액센트)과 색상·채도를 벌려
  // '미검증·확인 필요' 배너/뱃지가 노랑 CTA로 오인되지 않게 한다. (2026-07-07)
  warnSoft:   '#FCE8C4',  // 확인필요 배너/뱃지 배경 틴트 (apricot; ≠ yellowSoft 레몬크림)
  warnBorder: '#E6A94D',  // 확인필요 배너/칩 테두리 (앰버; ≠ gold 옐로골드)
  // gold(기존 키 유지) → 옐로 딥으로 재배치. 테두리·코드카드·뱃지 등 옐로 요소에 사용.
  gold:       '#F5C518',
  // 멘션(@) 텍스트 — 채팅/멘션입력 두 곳에 하드코딩되던 파랑을 시스템에 정식 등록.
  mention:     '#2f6fd6',
  mentionSoft: '#E8F0FB',
  // 출처 푸터 배경 — 골드 크림(SourceFooter 하드코딩 #FEF9EC 대체).
  sourceBg:    '#FEF9EC',
} as const;
