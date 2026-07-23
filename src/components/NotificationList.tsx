import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatAsked } from '@/lib/utils/time';
import type { JuniorNotifKind, OwnerNotifKind } from '@/lib/utils/notifications';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import type React from 'react';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// kind → 아이콘·틴트 매핑(데이터는 notifications util SSOT, 표현은 여기 한 곳) —
// 직원/사장 알림 화면 + stores 허브 통합 알림이 공유한다(화면별 재정의 금지).
export const JUNIOR_KIND_UI: Record<JuniorNotifKind, { icon: IconName; tint: string }> = {
  notice: { icon: 'megaphone', tint: BrandColors.yellowSoft },
  mention: { icon: 'at', tint: BrandColors.brandSoft },
  assign: { icon: 'clipboard', tint: BrandColors.yellowSoft },
  swap: { icon: 'swap-horizontal', tint: BrandColors.accentSoft },
  swap_approved: { icon: 'checkmark-circle', tint: '#E4F2E8' },
  swap_rejected: { icon: 'close-circle', tint: BrandColors.accentSoft },
  suggestion_approved: { icon: 'bulb', tint: '#E4F2E8' },
  suggestion_rejected: { icon: 'bulb', tint: BrandColors.accentSoft },
};
export const OWNER_KIND_UI: Record<OwnerNotifKind, { icon: IconName; tint: string }> = {
  join_request: { icon: 'person-add', tint: BrandColors.yellowSoft },
  question: { icon: 'chatbubble-ellipses', tint: BrandColors.yellowSoft },
  suggestion: { icon: 'bulb', tint: BrandColors.brandSoft },
  swap_approval: { icon: 'swap-horizontal', tint: BrandColors.accentSoft },
  mention: { icon: 'at', tint: BrandColors.brandSoft },
};
/** 허브(역할 혼합 가능) 용 — 두 맵 합성. mention 은 동일 표현이라 충돌 없음. */
export const ALL_KIND_UI = { ...JUNIOR_KIND_UI, ...OWNER_KIND_UI };

/** 알림 한 행의 공통 모양(직원·사장 공유). kind는 화면별 union을 문자열로 받는다.
 *  route/noticeId 는 탭 동작용 — 실제 라우팅/읽음처리는 화면(onPress)이 수행. */
export type NotifRow = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  at: string;
  unread: boolean;
  route?: string;
  /** 탭 시 읽음처리(read_by)할 feed id — 공지·멘션. */
  readFeedId?: string;
  noticeId?: string;
  /** 통합(전체 매장) 목록: 어느 매장 알림인지 — 있으면 제목 위에 매장 점·이름을 그린다. */
  storeLabel?: string;
  storeColor?: string;
};

/**
 * 알림 목록(프레젠테이셔널) — 직원/사장 알림 화면이 공유.
 * 데이터(rows)와 kind→아이콘 매핑·탭 동작은 화면이 주입, 여기선 렌더/스타일만.
 */
export function NotificationList({
  rows,
  kindUI,
  onPress,
  empty,
}: {
  rows: NotifRow[];
  kindUI: Record<string, { icon: IconName; tint: string }>;
  onPress: (row: NotifRow) => void;
  empty: { icon?: IconName; text: string; sub?: string };
}) {
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name={empty.icon ?? 'notifications-off-outline'} size={30} color={InkColors.ink3} />
        <Text style={styles.emptyText}>{empty.text}</Text>
        {empty.sub ? <Text style={styles.emptySub}>{empty.sub}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {rows.map((r) => {
        const ui = kindUI[r.kind] ?? { icon: 'ellipse', tint: InkColors.bgSoft };
        return (
          <Pressable
            key={r.id}
            onPress={() => onPress(r)}
            style={({ pressed }) => [styles.row, r.unread && styles.rowUnread, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: ui.tint }]}>
              <Ionicons name={ui.icon} size={17} color={InkColors.ink} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              {!!r.storeLabel && (
                <View style={styles.storeRow}>
                  <View style={[styles.storeDot, { backgroundColor: r.storeColor ?? InkColors.ink3 }]} />
                  <Text style={styles.storeText} numberOfLines={1}>
                    {r.storeLabel}
                  </Text>
                </View>
              )}
              <Text style={styles.rowTitle} numberOfLines={1}>
                {r.title}
              </Text>
              {!!r.body && (
                <Text style={styles.rowBody} numberOfLines={2}>
                  {r.body}
                </Text>
              )}
              <Text style={styles.rowTime}>{formatAsked(r.at)}</Text>
            </View>
            {r.unread && <View style={styles.unreadDot} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    overflow: 'hidden',
    ...Elevation.e1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  rowUnread: { backgroundColor: BrandColors.yellowSoft + '55' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  storeDot: { width: 6, height: 6, borderRadius: Radius.pill },
  storeText: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  iconWrap: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  rowBody: { fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
  rowTime: { fontSize: 11.5, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: Radius.pill, backgroundColor: BrandColors.accent },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  emptyText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  emptySub: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },
});
