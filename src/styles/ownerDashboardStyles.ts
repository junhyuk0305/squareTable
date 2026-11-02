import { StyleSheet } from 'react-native';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Layout, Space, screenScrollStyle } from '@/lib/theme/layout';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

export const styles = StyleSheet.create({
  // 스크롤 컨테이너는 패딩만 — 섹션 간격(gap)은 단일 자식인 콘텐츠 래퍼(scrollInner)가 갖는다.
  // (contentContainer는 자식이 하나라 gap이 무효 → 래퍼로 일원화해 중복/혼동 제거)
  // 2026-11-02: 헤더 아래 첫 여백 16 · 섹션 사이 20(Layout). 상단바는 높이 83 고정이라 아래 여백을 따로 갖지 않는다.
  scroll: screenScrollStyle,
  scrollInner: { gap: Layout.sectionGap },
  // 섹션: [밖 라벨] + [안 카드] 묶음
  section: { gap: Space.sm },

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
  taskDoneBy: { flexShrink: 0, fontSize: 12, fontWeight: '700', color: TextColor.secondary },
  // 행 목록 카드(좌우 16 · 그림자 e1 = CardStyles) — 위아래 여백은 각 행이 갖는다.
  taskCard: CardStyles.rows,
  // 할일 0건 — 첫 할일 등록으로 안내(새 매장은 기본 할일이 없다). 위아래 = 카드 안쪽 16(행이 없으니 사방 16이 된다).
  taskEmpty: { alignItems: 'center', gap: Space.sm, paddingVertical: Layout.cardPad },
  taskEmptyText: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: InkColors.ink2, textAlign: 'center' },
  // 작은 버튼(44 · 알약 · 내용 폭). 가운데 정렬 칸 안이라 alignSelf 만 가운데로 둔다.
  taskEmptyCta: {
    ...ButtonStyles.small,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: BrandColors.brand,
  },
  taskEmptyCtaText: { ...ButtonTextStyles.small, color: InkColors.bubbleText },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 48, paddingVertical: Space.sm },
  taskRowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  // 제목 한 줄 + 그 아래 담당자 알약. 알약은 문장 시작에 맞춰 왼쪽으로 붙는다.
  taskBody: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: Space.xs },
  taskText: { alignSelf: 'stretch', fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },
  taskTextDone: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  // 담당자 알약 — 보조 표기(상태 꼬리표)라 15sp 하한 대상 아님.
  taskAssignee: {
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  taskAssigneeText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
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
