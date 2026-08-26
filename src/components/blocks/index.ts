/**
 * 블록 어휘 — 문서 ↔ 코드 대조표 **정본**(2026-08-27, 블록어휘 §7-5 "코드 반영 후 여기로 옮긴다").
 *
 * 설계 정본: `기획/ux/화면우선순위_블록어휘_2026-08-05.md` §3(16종)·**§7(v2 "오밀조밀" — 충돌 시 §7 우선)**
 * 렌더 정본: `기획/ux/블록개선_오밀조밀_데모_2026-08-26.html` §2·§4(v5)
 * 전부 **표시 전용 · 로직 0** — props 로 받은 값만 그린다. 판정·데이터 접근은 훅/스토어 몫이다.
 * 블록을 추가·삭제하면 `.claude/rules/ui.md` 블록 어휘 절과 `scripts/lib/block-count.mjs` 의
 * `BLOCK_LEAF` 를 **같이** 고친다(드리프트가 실제로 생긴다).
 *
 * | 문서 ID | 코드                | 상태 | 비고 |
 * |---------|---------------------|------|------|
 * | H3 / H3′| `ProgressRing`      | 개정 | 기본·hero + `right` 슬롯·`swap` 두 면 전환(4초·1회전 후 정지) |
 * | H4      | `FocusCard`         | 부활 | 옛 `InboxHeroCard`(0곳) 개명·문자열 props 로 개보수 후 삭제 |
 * | H5      | `Heatmap`           | 신규 | 퀴즈 홈 히어로 · 색=아는 직원 비율 · 12/16/20열 자동 · 177개↑ 접기 |
 * | L4      | `StatCardGrid`      | 신규 | 2열 지표 카드. 칸 = `StatCard`(가로 스크롤 D 에서도 같은 칸) |
 * | (L4 원자)| `Sparkline`        | 신규 | 세로 막대 — 이력 있는 지표만(R4) |
 * | (L4 원자)| `StackBar`         | 신규 | 가로 구성 스택 — 스냅샷 지표 |
 * | L5      | `RollupRows`        | 신규 | 지표 행 2~3 + 대표 대상 1줄(R2) |
 * | L6      | `PickRow`           | 신규 | 고르기 행 + 우측 담기 원. 좌측 아이콘 없음(확정) |
 * | X2 / X2′| `AlertRow`          | 개정 | 한줄형 기본 · `preview` 주면 미리보기형(§7-3 조건 둘 다일 때만·화면당 1) |
 * | A1′/A2′ | `ActionRow`         | 개정 | `variant="card"`(AR2+, 기본) · `"tile"`(AR4+). **AR1 맨바닥 원형 폐기** |
 * | I3      | `MiniStats`         | 유지 | 새 화면은 L4 를 먼저 검토 |
 * | C형     | `StepProgress`      | 유지 | |
 * | N2      | `HeroSubNav`        | 유지 | |
 * | D10     | `KnowhowRows`       | 유지 | 노하우 본문의 유일한 형태 |
 * | D9      | `WeekStrip`         | 유지 | |
 * | (문서 없음)| `MiniCalendar`    | 유지 | 월 달력(WeekStrip 과 다른 물건) |
 * | D7      | `ProgressPill`      | 유지 | 행 안의 원자 — 블록 아님 |
 * | D4      | `GutterRow`         | 0곳  | D10 삭제 판정 대기 |
 * | I2      | `KvTable`           | 0곳  | D10 삭제 판정 대기 |
 * | —       | `TransitionCover`   | 유지 | 화면을 대체하는 커버(CHROME) |
 * | (폐기)  | SpotlightCard · '챙길 것' MiniStats 3칸 · AR1 | — | §7-2 |
 */
export { ActionRow, type ActionRowItem } from './ActionRow';
export { AlertRow } from './AlertRow';
export { FocusCard } from './FocusCard';
export { GutterRow } from './GutterRow';
export { Heatmap, type HeatCell, type HeatGroup, type HeatLevel } from './Heatmap';
export { HeroSubNav } from './HeroSubNav';
export { KnowhowRows, type KnowhowRow, type KnowhowRowKind } from './KnowhowRows';
export { KvTable } from './KvTable';
export { MiniCalendar } from './MiniCalendar';
export { MiniStats, type MiniStatsItem } from './MiniStats';
export { PickRow, type PickChip, type PickChipTone, type PickRowItem } from './PickRow';
export { ProgressPill, type ProgressTone } from './ProgressPill';
export { ProgressRing } from './ProgressRing';
export { RollupRows, type RollupRow } from './RollupRows';
export { Sparkline, type SparkTone } from './Sparkline';
export { StackBar, type StackPart } from './StackBar';
export { StatCard, StatCardGrid, type StatCardItem } from './StatCardGrid';
export { StepProgress } from './StepProgress';
export { TransitionCover } from './TransitionCover';
export { WeekStrip } from './WeekStrip';
