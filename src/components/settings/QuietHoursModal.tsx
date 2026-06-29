// 방해 금지 시간대 — 시작/종료 시각을 '스크롤 휠 + 토글'로 고른다.
// 숫자 직접 입력 대신: [시작|종료] 토글로 대상을 고르고, 시/분 휠을 스크롤해 선택한다.
import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { frameCapStyle } from '@/lib/theme/layout';

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0~23
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55
const ITEM_H = 40;
const VISIBLE = 3; // 가운데 1줄이 선택값

const pad2 = (n: number) => String(n).padStart(2, '0');
const parse = (t: string): [number, number] => {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
};

export function QuietHoursModal({
  visible,
  start,
  end,
  onClose,
  onSave,
}: {
  visible: boolean;
  start: string;
  end: string;
  onClose: () => void;
  onSave: (start: string, end: string) => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [target, setTarget] = useState<'start' | 'end'>('start');

  // 열릴 때마다 현재 저장값으로 초기화 — 렌더 중 이전 visible 과 비교하는
  // React 권장 패턴(effect 안 setState 회피).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setS(start);
      setE(end);
      setTarget('start');
    }
  }

  const active = target === 'start' ? s : e;
  const [ah, am] = parse(active);
  const setActive = (v: string) => (target === 'start' ? setS(v) : setE(v));

  const save = () => {
    onSave(s, e);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* 딤·시트를 모바일 프레임(460px) 안에 가둔다 — 웹 와이드에서 좌우로 새지 않도록. */}
      <View style={[frameCapStyle, { flex: 1 }]}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.head}>
              <Ionicons name="moon-outline" size={20} color={InkColors.ink} />
              <Text style={styles.title}>방해 금지 시간</Text>
            </View>
            <Text style={styles.sub}>이 시간대에는 푸시 알림을 보내지 않아요.</Text>

            {/* 대상 토글 — 시작/종료 중 무엇을 고를지 */}
            <View style={styles.seg}>
              <SegBtn label="시작" time={s} on={target === 'start'} onPress={() => setTarget('start')} />
              <Ionicons name="arrow-forward" size={15} color={InkColors.ink3} />
              <SegBtn label="종료" time={e} on={target === 'end'} onPress={() => setTarget('end')} />
            </View>

            {/* 시·분 휠 (스크롤로 선택) */}
            <View style={styles.picker}>
              <Wheel data={HOURS} value={ah} suffix="시" onChange={(h) => setActive(`${pad2(h)}:${pad2(am)}`)} />
              <Wheel data={MINUTES} value={am} suffix="분" onChange={(m) => setActive(`${pad2(ah)}:${pad2(m)}`)} />
              {/* 가운데 선택 밴드 */}
              <View pointerEvents="none" style={styles.band} />
            </View>

            <Text style={styles.hint}>
              {s > e ? `밤 ${s}부터 다음 날 ${e}까지 알림을 끕니다.` : `${s}부터 ${e}까지 알림을 끕니다.`}
            </Text>

            <View style={styles.actions}>
              <Pressable style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]} onPress={onClose}>
                <Text style={styles.btnGhostText}>취소</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.btn, styles.btnSolid, pressed && { opacity: 0.85 }]} onPress={save}>
                <Text style={styles.btnSolidText}>저장</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function SegBtn({ label, time, on, onPress }: { label: string; time: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segBtn, on && styles.segBtnOn]}>
      <Text style={[styles.segLabel, on && styles.segLabelOn]}>{label}</Text>
      <Text style={[styles.segTime, on && styles.segTimeOn]}>{time}</Text>
    </Pressable>
  );
}

function Wheel({ data, value, suffix, onChange }: { data: number[]; value: number; suffix: string; onChange: (n: number) => void }) {
  const ref = useRef<ScrollView>(null);
  const selIdx = Math.max(0, data.indexOf(value));

  // 외부 value(타깃 토글 등) 변경 시 휠 위치를 동기화.
  useEffect(() => {
    const id = setTimeout(() => ref.current?.scrollTo({ y: selIdx * ITEM_H, animated: false }), 0);
    return () => clearTimeout(id);
  }, [selIdx]);

  const commit = (ev: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(data.length - 1, Math.max(0, Math.round(ev.nativeEvent.contentOffset.y / ITEM_H)));
    if (data[i] !== value) onChange(data[i]);
  };

  return (
    <View style={styles.wheel}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        nestedScrollEnabled
        onMomentumScrollEnd={commit}
        onScrollEndDrag={commit}
        contentContainerStyle={{ paddingVertical: ITEM_H }}
      >
        {data.map((n, i) => (
          <Pressable
            key={n}
            style={styles.wheelItem}
            onPress={() => {
              onChange(n);
              ref.current?.scrollTo({ y: i * ITEM_H, animated: true });
            }}
          >
            <Text style={[styles.wheelText, n === value && styles.wheelTextActive]}>
              {pad2(n)}
              <Text style={styles.wheelSuffix}>{suffix}</Text>
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31,29,26,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 13, color: InkColors.ink2, marginTop: 6 },

  seg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  segBtnOn: { backgroundColor: BrandColors.brandSoft, borderColor: BrandColors.brand },
  segLabel: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  segLabelOn: { color: BrandColors.brand },
  segTime: { fontSize: 19, fontWeight: '800', color: InkColors.ink2, marginTop: 1, letterSpacing: 0.5 },
  segTimeOn: { color: InkColors.ink },

  picker: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 16, height: ITEM_H * VISIBLE, position: 'relative' },
  wheel: { width: 88, height: ITEM_H * VISIBLE, overflow: 'hidden' },
  wheelItem: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  wheelText: { fontSize: 18, fontWeight: '600', color: InkColors.ink3 },
  wheelTextActive: { fontSize: 22, fontWeight: '800', color: InkColors.ink },
  wheelSuffix: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  // 가운데 선택 밴드 — pickerRow 높이의 중앙 한 칸.
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_H,
    height: ITEM_H,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },

  hint: { fontSize: 12.5, color: InkColors.ink2, textAlign: 'center', marginTop: 14, minHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  btnSolid: { backgroundColor: BrandColors.brand },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
