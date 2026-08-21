import { StyleSheet } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  // 스크롤 컨테이너는 패딩만 — 섹션 간격(gap)은 단일 자식인 콘텐츠 래퍼(scrollInner)가 갖는다.
  // (contentContainer는 자식이 하나라 gap이 무효 → 래퍼로 일원화해 중복/혼동 제거)
  // ★위 패딩은 주지 않는다 — 상단바(AppTopBar)가 스크롤 밖에서 자기 아래 여백을 이미 갖는다.
  // 여기서 또 주면 허브보다 콘텐츠가 20px 더 내려간다.
  scroll: { paddingHorizontal: Space.gutter, paddingBottom: Space.gutter },
  scrollInner: { gap: 18 },
  // 섹션: [밖 라벨] + [안 카드] 묶음
  section: { gap: 8 },

  // 미검증 우선 배너는 공용 <AlertRow>(블록 X2)로 대체됨(2026-08-05).

  // 상단바 스타일은 공용 AppTopBar 가 갖는다(직원 홈과 같은 것을 쓴다 — 2026-08-08 통일).

  onboard: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#E8C9C2',
    padding: 20,
    gap: 8,
    alignItems: 'flex-start',
  },
  onboardTitle: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  onboardBody: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  onboardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: BrandColors.brand,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
  },
  onboardCtaText: { color: InkColors.bubbleText, fontSize: 14, fontWeight: '800' },
  seedLabel: { fontSize: 12, color: InkColors.ink2, fontWeight: '700', marginTop: 12 },
  seedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  seedChip: {
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  seedChipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink },

  // 2026-08-07: 히어로가 <HeroSubNav>(블록 N2 · 검은 색면)로 바뀌면서
  // InboxHeroCard(H4)·MiniStats(I3)·ActionRow(A1)와 '질문 0건 조용한 카드'가 홈에서 빠졌다.
  // 질문 0건 상태는 히어로가 직접 말한다("없어요" + 노하우 남기기 CTA) — 블록을 하나 더 쓰지 않는다.

  // ② '오늘' 카드 — 섹션 라벨은 카드 밖, [근무 머리줄 + 업무 3건]이 카드 안.
  moreLink: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  // 머리줄: 오늘 누가 나와 있나. 누르면 근무표(전체보기는 업무로 가므로 목적지가 겹치지 않는다).
  // 보조 표기(위치·상태 꼬리표)라 본문 15sp 하한 대상이 아니다.
  dutyRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 40, paddingVertical: Space.sm },
  dutyRowDivider: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  dutyText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '700', color: InkColors.ink2 },
  // 완료 꼬리표(완료자·시각) — 감시원칙 D1이 드러내라고 정한 값. 역시 보조 표기.
  taskDoneBy: { flexShrink: 0, fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  taskCard: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
    ...Elevation.e1,
  },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.sm },
  taskRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  taskText: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  taskTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  // 업무 시간 — 제목 앞에 붙는 꼬리표(보조 표기라 15sp 하한 대상 아님). 할일 화면 timeTag 와 같은 값.
  taskTime: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  // 카드 맨 위 진행 바 — 오늘 할일 전체 기준(잘라 보여주는 5건이 아니다).
  progRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 40,
    paddingVertical: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  progTrack: { flex: 1, height: 6, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, overflow: 'hidden' },
  progFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },
  progText: { flexShrink: 0, fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },

  miniRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  miniLink: { fontSize: 13, color: InkColors.ink2, fontWeight: '700' },
});
