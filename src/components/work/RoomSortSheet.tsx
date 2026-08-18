import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { usePreferencesStore, type RoomSort } from '@/lib/store/usePreferencesStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const OPTIONS: { key: RoomSort; label: string; sub: string }[] = [
  { key: 'recent', label: '최신 메시지 순', sub: '마지막 대화가 최근인 방이 위로' },
  { key: 'unread', label: '안 읽은 메시지 순', sub: '안 읽은 대화가 많은 방이 위로' },
];

/**
 * 채팅방 목록 정렬 고르기 — 업무 채팅 목록 우상단 톱니.
 *
 * 저장 자리가 **기기 로컬**(usePreferencesStore)인 이유: 글자 크기와 같은 '이 기기에서의 보기 설정'이고,
 * 서버에 두면 (사용자 × 매장) 축 테이블을 목록 정렬 하나 때문에 늘려야 한다.
 * 고른 즉시 반영되므로 저장 버튼이 없다 → 되돌리기도 같은 자리에서 한 번 더 고르면 된다.
 */
export function RoomSortSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const roomSort = usePreferencesStore((s) => s.roomSort);
  const setPref = usePreferencesStore((s) => s.set);

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={{ paddingBottom: Space.xl }}>
      <Text style={s.title}>채팅방 정렬</Text>
      {OPTIONS.map((o) => {
        const on = roomSort === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => { setPref('roomSort', o.key); onClose(); }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: InkColors.paper }]}
          >
            <View style={{ flex: 1 }}>
              {/* 고른 것은 굵기 + 체크로 표시한다. accent(=bad)는 에러 빨강이라 '선택'에 쓰지 않는다. */}
              <Text style={[s.label, on && { fontWeight: '800' }]}>{o.label}</Text>
              <Text style={s.sub}>{o.sub}</Text>
            </View>
            {/* 색만으로 고른 것을 구분하지 않는다 — 체크 표시를 같이 둔다. */}
            {on && <Ionicons name="checkmark" size={20} color={InkColors.ink} />}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: Space.gutter, paddingTop: Space.sm, paddingBottom: Space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingHorizontal: Space.gutter, paddingVertical: Space.md, borderRadius: Radius.sm },
  label: { fontSize: 15.5, fontWeight: '700', color: InkColors.ink },
  sub: { fontSize: 13, color: InkColors.ink3, fontWeight: '600', marginTop: 2 },
});
