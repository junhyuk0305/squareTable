/**
 * 디자인 토큰 — 착착(CHACHAK) 디자인 시스템 v1 (2026-06-26 확정).
 * 원칙: 라이트 고정 · 노랑(#FFE14D)은 액센트 only · 검정은 컴포넌트 단위 · 소프트 드롭섀도.
 * export 이름은 기존과 동일 — 값만 새 팔레트로 교체했다. (54개 파일이 자동 반영)
 * SSOT: 착착_디자인시스템.md / 착착_디자인_확정안.html
 */

// 4 카테고리 — 노랑 액센트와 충돌하지 않도록 채도를 더 낮춘 '음소거된 한 가족'(옵션 a).
export const CategoryColors = {
  Routine:  '#5E6B78',   // 슬레이트 — 반복 업무
  Event:    '#B0635A',   // 테라코타 — 돌발 상황 (벽돌에서 채도 ↓)
  Context:  '#637A5E',   // 세이지   — 매장 룰·위치
  'Know-how': '#9A8550', // 카키브론즈 — 꿀팁·노하우 (노랑과 분리되도록 톤 다운)
} as const;

export const CategoryColorsSoft = {
  Routine:  '#EEF0F2',
  Event:    '#F5ECEA',
  Context:  '#EDF1EC',
  'Know-how': '#F3EFE5',
} as const;

export const InkColors = {
  ink:    '#111111',   // 주색 · 텍스트 · 1차 버튼/말풍선 배경
  ink2:   '#6b6b6b',   // 본문 보조 텍스트 (--soft)
  ink3:   '#a4a29b',   // 흐린 메타 · 비활성 · 플레이스홀더 (--faint)
  line:   '#E7E5DE',   // 보더
  bg:     '#FFFFFF',
  bgSoft: '#F1EFE9',   // 앱 메인 배경(따뜻한 페이퍼, = paper)
  paper:  '#F1EFE9',   // 명시적 별칭
  bubble: '#111111',   // 사용자 발화 버블 = 검정 (텍스트는 흰색)
  cream:  '#FAF8F2',   // 진입/상단 그라데이션 밝은 끝
} as const;

export const BrandColors = {
  brand:     '#111111',   // 기본 액션(CTA) = 잉크 블랙
  brand2:    '#2a2a2a',   // 그라데이션 보조
  brandSoft: '#F1EFE9',
  // 핵심 액센트 = 마커 옐로. (워드마크 밑줄·완료·강조·게이지)
  yellow:     '#FFE14D',
  yellowDeep: '#F5C518',  // 게이지 그라데이션 끝 · 옐로 요소 테두리/그림자
  yellowSoft: '#FFF3B8',  // 옐로 배경 틴트(배너·아이콘 바탕)
  // accent = "강조/경고성 단일 액센트". 기존 벽돌색이 에러·위험·삭제 텍스트로 광범위 사용 →
  // 가독성 유지 위해 노랑이 아니라 상태 레드(bad)로 매핑.
  accent:     '#c44b4b',
  accentSoft: '#F6E6E6',
  good:       '#1c7d3f',  // 완료
  warn:       '#c98a2e',  // 대기
  bad:        '#c44b4b',  // 지연/에러
  // gold(기존 키 유지) → 옐로 딥으로 재배치. 테두리·코드카드·뱃지 등 옐로 요소에 사용.
  gold:       '#F5C518',
} as const;
