import { useEffect, useRef } from 'react';
import { Modal, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { usePreferencesStore } from '@/lib/store/usePreferencesStore';
import { InkColors } from '@/lib/theme/colors';
import { FRAME_MAX_WIDTH, Space } from '@/lib/theme/layout';

/**
 * 글자 크기 전환 오버레이 — 크기를 고르면 _layout의 Stack(key=textScale)이 통째로 리마운트되며
 * 열려 있던 시트가 사라지고 화면이 잠깐 깜빡인다("UI 깨짐"). 그 리마운트를 불투명 로딩 화면 뒤로 숨긴다:
 *   begin(이 오버레이 표시) → [화면 덮은 뒤] commit(배율 반영·리마운트) → end(오버레이 사라짐, 새 크기로 원화면 복귀).
 *
 * _layout에서 Stack '바깥' 형제로 렌더 → key 리마운트에도 이 오버레이는 살아남는다.
 * Modal(포털)이라 열려 있던 바텀시트 위로 얹혀 그 아래의 리마운트를 완전히 가린다.
 * 프레임 폭(460)으로 가둬 웹에서 좌우로 새지 않게 한다(AGENTS.md 레이아웃 불변식).
 */
export function TextScaleTransition() {
  const applying = usePreferencesStore((s) => s.applyingScale);
  const commit = usePreferencesStore((s) => s.commitPendingScale);
  const end = usePreferencesStore((s) => s.endTextScale);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!applying) return;
    // 오버레이가 화면을 덮은 뒤(하한 홀드) 실제 배율을 반영 → 리마운트 깜빡임이 가려진다.
    const t1 = setTimeout(() => {
      commit();
      // 리마운트 + 새 크기 레이아웃이 안정된 뒤 오버레이를 내려 원래 화면(새 크기)으로 복귀.
      timers.current.push(setTimeout(end, 480));
    }, 420);
    timers.current.push(t1);
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [applying, commit, end]);

  if (!applying) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.fill}>
        <ActivityIndicator size="large" color={InkColors.ink} />
        <Text style={styles.label}>글자 크기를 바꾸고 있어요…</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    maxWidth: FRAME_MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: InkColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.lg,
  },
  label: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
});
