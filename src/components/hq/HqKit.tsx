// HqKit.tsx — 본사 대시보드 공용 부품(데스크톱 전용 · 표시 전용). 데모 HTML `.phead/.btn/.pill/.notice/.formcard/.kv/.slab` 이식.
//
// ★로직 0. 판정·조회는 화면(src/app/hq/*)과 훅(useBrandStore)이 하고 여기는 값만 그린다.
// ★폰 프레임(460)·frameCapStyle 을 쓰지 않는다 — 본사 화면은 넓은 레이아웃 전용(정본 §5-1).
// 색은 앱 토큰(InkColors·BrandColors)이 정본. 데모의 --y-deep 는 BrandColors.yellowDeep 로.
import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, HQ_PAGE_GUTTER } from '@/lib/theme/layout';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * 화면 한 장 — 흰 머리 줄(← · 제목 + 개수 · 배지 · 설명 · 오른쪽 버튼 · 탭) + 회색 바탕 본문(최대 1400).
 *
 * 머리 줄과 본문을 **아래 선 하나와 바탕색**으로 가른다(2026-10-02 레퍼런스 개편). 예전엔 흰 바탕 위에
 * 흰 카드라 카드 경계가 테두리 한 줄뿐이었다 — 회색 바탕 위 흰 카드로 묶음이 먼저 보인다.
 * 탭은 머리 줄 바닥에 붙는다(밑줄 탭) — 탭이 바꾸는 것은 본문 전체라 본문 안에 두지 않는다.
 */
export function HqPage({
  title,
  count,
  badges,
  sub,
  back,
  actions,
  tabs,
  children,
  testID,
}: {
  title: string;
  /** 제목 옆 흐린 숫자("전체 매장 3"). 0 도 그린다 — 없음과 0 은 다르다. */
  count?: number;
  /** 제목 옆 배지(관계·공개 수준 등). */
  badges?: ReactNode;
  sub?: string;
  /** 왼쪽 ← — 상세 화면에서 목록으로. */
  back?: { label: string; onPress: () => void; testID?: string };
  actions?: ReactNode;
  /** 머리 줄 바닥의 탭(HqTabs). */
  tabs?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} testID={testID}>
      <View style={[styles.phead, !!tabs && { paddingBottom: 0 }]}>
        <View style={styles.pheadRow}>
          {back ? (
            <Pressable
              onPress={back.onPress}
              accessibilityRole="button"
              accessibilityLabel={back.label}
              testID={back.testID}
              style={({ pressed }) => [styles.back, pressed && { backgroundColor: InkColors.paper }]}
            >
              <Ionicons name="arrow-back" size={20} color={InkColors.ink} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.titleRow}>
              <Text style={styles.h1}>{title}</Text>
              {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
              {badges}
            </View>
            {sub ? <Text style={styles.psub}>{sub}</Text> : null}
          </View>
          {actions ? <View style={styles.pact}>{actions}</View> : null}
        </View>
        {tabs}
      </View>
      <View style={styles.page}>{children}</View>
    </ScrollView>
  );
}

/** 밑줄 탭 — HqPage 의 tabs 자리에 둔다. 선택 표시는 밑줄 + 굵기 + 색 셋이 같이 바뀐다. */
export function HqTabs<T extends string>({
  items,
  value,
  onChange,
  testID,
}: {
  items: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (k: T) => void;
  testID?: string;
}) {
  return (
    <View style={styles.tabs} testID={testID}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={it.label}
            testID={testID ? `${testID}-${it.key}` : undefined}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{it.label}</Text>
            {it.count !== undefined ? <Text style={styles.tabCount}>{it.count}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** 라벨이 위·값이 아래인 칸(설정·개요) — 카드 안을 여러 칸으로 나눌 때. 꼬리(도움말)는 값 아래 회색 한 줄. */
export function HqField({ label, children, hint, style }: { label: string; children: ReactNode; hint?: string; style?: ViewStyle }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldK}>{label}</Text>
      {typeof children === 'string' || typeof children === 'number' ? <Text style={styles.fieldV}>{children}</Text> : children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** 버튼 — pri(노랑) · dark(잉크) · plain(테두리). 넓은 화면이라 폰보다 한 단계 작다(높이 36). */
export function HqButton({
  label,
  onPress,
  variant = 'plain',
  disabled,
  icon,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'pri' | 'dark' | 'plain' | 'danger';
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
  style?: ViewStyle;
}) {
  const color =
    variant === 'dark' ? InkColors.bubbleText : variant === 'danger' ? BrandColors.badText : InkColors.ink;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.btn,
        variant === 'pri' && styles.btnPri,
        variant === 'dark' && styles.btnDark,
        variant === 'danger' && styles.btnDanger,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={15} color={color} /> : null}
      <Text style={[styles.btnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export type PillTone = 'g' | 'w' | 'b' | 'i' | 'n' | 'y';
const PILL: Record<PillTone, { bg: string; fg: string }> = {
  g: { bg: BrandColors.goodSoft, fg: BrandColors.goodText },
  w: { bg: BrandColors.warnSoft, fg: BrandColors.warnText },
  b: { bg: BrandColors.badSoft, fg: BrandColors.badText },
  i: { bg: BrandColors.mentionSoft, fg: BrandColors.mentionText },
  n: { bg: InkColors.paper, fg: InkColors.ink2 },
  y: { bg: BrandColors.yellowSoft, fg: InkColors.ink },
};
/** 상태 pill — 점 + 배경 + 글자색 셋이 같이 바뀐다(색 하나로 상태를 말하지 않는다). */
export function HqPill({ tone, label }: { tone: PillTone; label: string }) {
  const c = PILL[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: c.fg }]} />
      <Text style={[styles.pillText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** 고지 박스 — 본문 한 단락. */
export function HqNotice({ children, tone = 'n', style }: { children: ReactNode; tone?: 'n' | 'warn' | 'i'; style?: ViewStyle }) {
  return (
    <View
      style={[
        styles.notice,
        tone === 'warn' && { backgroundColor: BrandColors.warnSoft, borderColor: BrandColors.warnBorder },
        tone === 'i' && { backgroundColor: BrandColors.mentionSoft, borderColor: '#CFE2FB' },
        style,
      ]}
    >
      <Text style={[styles.noticeText, tone === 'warn' && { color: BrandColors.warnText }, tone === 'i' && { color: BrandColors.mentionText }]}>
        {children}
      </Text>
    </View>
  );
}

/** 카드(formcard) — 제목·설명 + 내용. 표 카드도 이걸 쓴다(padding 0). */
export function HqCard({
  title,
  sub,
  children,
  flush,
  style,
  testID,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
  /** 표처럼 안쪽 여백 없이 꽉 채울 때. */
  flush?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <View style={[styles.card, flush && { padding: 0 }, style]} testID={testID}>
      {title ? (
        <View style={[styles.cardHead, flush && { paddingHorizontal: 22, paddingTop: 20 }]}>
          <Text style={styles.cardTitle}>{title}</Text>
          {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** 키·값 한 줄(kv / frow) — 왼쪽 라벨 고정폭, 오른쪽 값 또는 노드. */
export function HqRow({ k, v, tail, first }: { k: string; v?: ReactNode; tail?: ReactNode; first?: boolean }) {
  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <Text style={styles.rowK}>{k}</Text>
      {/* 꼬리(보조 설명)는 값 **아래**에 둔다. 옆에 두면 좁은 칸(상세 392)에서 긴 꼬리가 값을 0 가까이 눌러
          배지가 세로로 섰고, 남은 90px 에서 꼬리가 "본사 부 / 담"처럼 끊겼다(2026-10-01 실측). */}
      <View style={styles.rowV}>
        {typeof v === 'string' || typeof v === 'number' ? <Text style={styles.rowVText}>{v}</Text> : v}
        {tail ? <View style={styles.rowTail}>{tail}</View> : null}
      </View>
    </View>
  );
}

/** 섹션 라벨(slab) — 제목 + 흐린 설명 + 오른쪽 링크. */
export function HqSlab({ title, hint, more }: { title: string; hint?: string; more?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.slab}>
      <Text style={styles.slabTitle}>{title}</Text>
      {hint ? <Text style={styles.slabHint}>{hint}</Text> : null}
      {more ? (
        <Pressable onPress={more.onPress} accessibilityRole="button" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <Text style={styles.slabMore}>{more.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 비어 있음 — 이유 한 줄 + 다음 행동(선택). */
export function HqEmpty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
      {/* HqButton 은 alignSelf:'flex-start' 라 감싸야 가운데로 온다 — 감싼 View 가 버튼 폭으로 줄어 가운데에 선다. */}
      {action ? <View>{action}</View> : null}
    </View>
  );
}

/**
 * 읽기 실패 자리 — "없어요"(0건)와 **다른 상태**다(앱의 `LoadErrorState` 와 같은 규약·같은 문구).
 * 화면 3분기: 기다리는 중 → ScreenLoading / 실패 → 이것 / 0건 → HqEmpty + 다음 행동.
 * 실패를 0건으로 흡수하면 장애가 "연결된 매장이 없어요" 같은 정상 문구로 위장된다.
 * 다시 시도 중에는 버튼이 '불러오는 중…'으로 바뀌고 잠긴다 — 눌렀는데 아무 반응이 없으면 또 누른다.
 */
export function HqLoadError({ title, onRetry, testID }: { title: string; onRetry: () => Promise<unknown>; testID?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.loadErr} testID={testID}>
      <Ionicons name="cloud-offline-outline" size={22} color={BrandColors.warnText} />
      <Text style={styles.loadErrTitle}>{title}</Text>
      <Text style={styles.loadErrBody}>연결을 확인하고 다시 시도해 주세요.</Text>
      <HqButton
        label={busy ? '불러오는 중…' : '다시 시도'}
        icon={busy ? undefined : 'refresh-outline'}
        disabled={busy}
        style={{ alignSelf: 'center' }}
        testID={testID ? `${testID}-retry` : undefined}
        onPress={() => {
          setBusy(true);
          void onRetry().finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

/** 세그먼트(요약/노하우/운영 · 본사/매장) — 넓은 화면용 작은 것. */
export function HqSegment<T extends string>({
  items,
  value,
  onChange,
  disabled,
  testID,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.seg} testID={testID}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            style={[styles.segItem, on && styles.segOn, disabled && { opacity: 0.5 }]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // 바탕 = 옅은 회색(paper), 카드·표·머리 줄 = 흰색. 경계가 선이 아니라 면으로 보인다.
  scroll: { flex: 1, backgroundColor: InkColors.paper },
  scrollBody: { flexGrow: 1 },
  page: { paddingTop: Space.xl, paddingBottom: 60, paddingHorizontal: HQ_PAGE_GUTTER, maxWidth: 1400, width: '100%' },
  phead: { backgroundColor: InkColors.bg, borderBottomWidth: 1, borderBottomColor: InkColors.line, paddingTop: 22, paddingBottom: 18, paddingHorizontal: HQ_PAGE_GUTTER },
  pheadRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  back: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: -Space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  h1: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: InkColors.ink, flexShrink: 0 },
  count: { fontSize: 22, fontWeight: '700', color: InkColors.ink3, fontVariant: ['tabular-nums'], flexShrink: 0 },
  psub: { fontSize: 14, color: InkColors.ink2, marginTop: Space.xs },
  pact: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexShrink: 0 },

  tabs: { flexDirection: 'row', gap: Space.xl, marginTop: Space.lg },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1, flexShrink: 0 },
  tabOn: { borderBottomColor: InkColors.ink },
  tabText: { fontSize: 15, fontWeight: '600', color: InkColors.ink3 },
  tabTextOn: { color: InkColors.ink, fontWeight: '800' },
  tabCount: { fontSize: 13, fontWeight: '700', color: InkColors.ink3, fontVariant: ['tabular-nums'] },

  field: { flex: 1, minWidth: 0, gap: 6 },
  fieldK: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },
  fieldV: { fontSize: 15.5, fontWeight: '700', color: InkColors.ink },
  fieldHint: { fontSize: 13, color: InkColors.ink3, lineHeight: 18 },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    minHeight: 40,
    alignSelf: 'flex-start', // 세로 컨테이너 안에서 가로로 늘어나지 않는다(드로어 실측 2026-09-23)
    flexShrink: 0,
  },
  btnPri: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  btnDark: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  btnDanger: { borderColor: BrandColors.badSoft, backgroundColor: BrandColors.badSoft },
  btnText: { fontSize: 14.5, fontWeight: '700' },

  // ★짧은 글자 부품(배지·버튼·세그먼트·라벨·제목)은 flexShrink 0 — 옆 요소에 눌려 접히지 않는다(ui.md 줄바꿈 규칙).
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2, paddingHorizontal: 9, borderRadius: Radius.pill, alignSelf: 'flex-start', flexShrink: 0 },
  pillDot: { width: 5, height: 5, borderRadius: Radius.pill, opacity: 0.85 },
  pillText: { fontSize: 13, fontWeight: '700' },

  notice: { borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 15, marginBottom: 22 },
  noticeText: { fontSize: 14, lineHeight: 22, color: InkColors.ink2 },

  card: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, padding: 22, paddingTop: 20, marginBottom: 18, ...Elevation.e1, overflow: 'hidden' },
  cardHead: { marginBottom: 14, gap: 3 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink },
  cardSub: { fontSize: 14, color: InkColors.ink2, lineHeight: 20 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, minHeight: 44 },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowK: { width: 160, flexShrink: 0, fontSize: 14.5, fontWeight: '600', color: InkColors.ink2 },
  rowV: { flex: 1, minWidth: 0, gap: Space.xs },
  rowVText: { fontSize: 14.5, fontWeight: '600', color: InkColors.ink },
  rowTail: { alignSelf: 'stretch' },

  // 제목은 줄지 않고, 옆 설명(긴 문장)이 남은 폭에서 줄바꿈한다.
  slab: { flexDirection: 'row', alignItems: 'baseline', gap: 9, marginBottom: 9 },
  slabTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink, flexShrink: 0 },
  slabHint: { fontSize: 13.5, color: InkColors.ink3, flex: 1, minWidth: 0 },
  slabMore: { fontSize: 14, fontWeight: '600', color: InkColors.ink2, flexShrink: 0 },

  empty: { paddingVertical: 28, paddingHorizontal: 16, alignItems: 'center', gap: Space.md },
  emptyText: { fontSize: 14.5, color: InkColors.ink3, textAlign: 'center' },
  loadErr: { alignItems: 'center', gap: Space.sm, paddingVertical: Space.xl, paddingHorizontal: Space.lg, borderWidth: 1, borderColor: BrandColors.warnBorder, borderRadius: Radius.md, backgroundColor: BrandColors.warnSoft, marginBottom: 22 },
  loadErrTitle: { fontSize: 15, fontWeight: '800', color: BrandColors.warnText, textAlign: 'center' },
  loadErrBody: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', marginBottom: Space.xs },

  // 흰 면 + 테두리 — 회색 바탕(HqPage)과 흰 카드 어디에 놓여도 보인다.
  seg: { flexDirection: 'row', backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, padding: 3, gap: 2, alignSelf: 'flex-start' },
  segItem: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: Radius.pill, flexShrink: 0 },
  segOn: { backgroundColor: InkColors.ink },
  segText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  segTextOn: { color: InkColors.bubbleText },
});
