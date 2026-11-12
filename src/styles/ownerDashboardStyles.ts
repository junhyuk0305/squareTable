import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { AppStyles, AppTypography } from '@/lib/theme/appDesign';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.bgSoft },
  // 스크롤 컨테이너는 패딩만 — 섹션 간격(gap)은 단일 자식인 콘텐츠 래퍼(scrollInner)가 갖는다.
  // (contentContainer는 자식이 하나라 gap이 무효 → 래퍼로 일원화해 중복/혼동 제거)
  // 상단바 다음 첫 콘텐츠는 16px을 띄운다.
  scroll: { paddingHorizontal: Space.gutter, paddingTop: Space.lg, paddingBottom: Space.gutter },
  scrollInner: { ...AppStyles.groupSpacing },
  // 섹션: [밖 라벨] + [안 카드] 묶음
  section: { gap: 8 },

  // 미검증 우선 배너는 공용 <AlertRow>(블록 X2)로 대체됨(2026-08-05).

  // 상단바 스타일은 공용 AppTopBar 가 갖는다(직원 홈과 같은 것을 쓴다 — 2026-08-08 통일).

  onboard: {
    ...AppStyles.group,
    padding: 20,
    gap: 8,
    alignItems: 'flex-start',
  },
  onboardTitle: { color: InkColors.ink, ...AppTypography.group },
  onboardBody: { color: InkColors.ink2, ...AppTypography.body },
  onboardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: Space.sm,
    backgroundColor: BrandColors.yellow,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    minHeight: 52,
  },
  onboardCtaText: { color: InkColors.ink, ...AppTypography.button },
  seedLabel: { color: InkColors.ink2, marginTop: 12, ...AppTypography.meta },
  seedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  seedChip: {
    backgroundColor: InkColors.bgSoft,
    borderWidth: 0,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: Space.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  seedChipText: { color: InkColors.ink, ...AppTypography.meta },

  // 2026-08-07: 히어로가 <HeroSubNav>(블록 N2 · 검은 색면)로 바뀌면서
  // InboxHeroCard(H4)·MiniStats(I3)·ActionRow(A1)와 '질문 0건 조용한 카드'가 홈에서 빠졌다.
  // 질문 0건 상태는 히어로가 직접 말한다("없어요" + 노하우 남기기 CTA) — 블록을 하나 더 쓰지 않는다.

  // ② '오늘' 카드 — 섹션 라벨은 카드 밖, [근무 머리줄 + 업무 3건]이 카드 안.
  moreLink: { color: InkColors.ink2, ...AppTypography.body },
  // 머리줄: 오늘 누가 나와 있나. 누르면 근무표(전체보기는 업무로 가므로 목적지가 겹치지 않는다).
  // 보조 표기(위치·상태 꼬리표)라 본문 15sp 하한 대상이 아니다.
  dutyRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48, paddingVertical: Space.sm },
  dutyRowDivider: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  dutyText: { flex: 1, minWidth: 0, color: InkColors.ink2, ...AppTypography.meta },
  // 완료 꼬리표(완료자·시각) — 감시원칙 D1이 드러내라고 정한 값. 역시 보조 표기.
  taskDoneBy: { flexShrink: 0, color: InkColors.ink3, ...AppTypography.meta },
  // 할일 0건 — 첫 할일 등록으로 안내(새 매장은 기본 할일이 없다).
  taskEmpty: { alignItems: 'flex-start', gap: Space.sm, paddingVertical: Space.sm },
  taskEmptyText: { color: InkColors.ink2, ...AppTypography.body },
  taskEmptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: BrandColors.yellow,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    minHeight: 52,
  },
  taskEmptyCtaText: { color: InkColors.ink, ...AppTypography.button },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 52, paddingVertical: Space.sm },
  taskRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  // 제목 한 줄 + 그 아래 담당자 알약. 알약은 문장 시작에 맞춰 왼쪽으로 붙는다.
  taskBody: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: Space.xs },
  taskText: { alignSelf: 'stretch', color: InkColors.ink, ...AppTypography.body },
  taskTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  // 담당자 알약 — 보조 표기(상태 꼬리표)라 15sp 하한 대상 아님.
  taskAssignee: {
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 0,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  taskAssigneeText: { color: InkColors.ink2, ...AppTypography.meta },
  // 업무 시간 — 제목 앞에 붙는 꼬리표(보조 표기라 15sp 하한 대상 아님). 할일 화면 timeTag 와 같은 값.
  taskTime: { color: InkColors.ink2, ...AppTypography.status },
  // 카드 맨 위 진행 바 — 오늘 할일 전체 기준(잘라 보여주는 5건이 아니다).
  progRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingVertical: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  progTrack: { flex: 1, height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  progFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  progText: { flexShrink: 0, color: InkColors.ink2, ...AppTypography.meta },

  miniRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  miniLink: { color: InkColors.ink2, ...AppTypography.meta },
});

export const dashboardCtaIconColor = InkColors.ink;
