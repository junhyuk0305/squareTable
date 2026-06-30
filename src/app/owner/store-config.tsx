import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { maskHHMM } from '@/lib/utils/attendance';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, closedDaysLabel } from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export default function OwnerStoreConfigScreen() {
  const router = useRouter();
  const config = useScheduleStore((s) => s.config);
  const setConfig = useScheduleStore((s) => s.setConfig);

  const [open, setOpen] = useState(config.open);
  const [close, setClose] = useState(config.close);
  const [closedDays, setClosedDays] = useState<number[]>(config.closedDays);
  const [note, setNote] = useState(config.note);
  const [saved, setSaved] = useState(false);

  // 심야 영업(예: 22:00→02:00) 허용 — close < open 은 자정을 넘는 정상 케이스다.
  // open===close(영업시간 0)만 무효로 막는다.
  const valid = TIME_RE.test(open) && TIME_RE.test(close) && open !== close;

  const toggleDay = (wd: number) =>
    setClosedDays((p) => (p.includes(wd) ? p.filter((x) => x !== wd) : [...p, wd]));

  const save = () => {
    if (!valid) return;
    setConfig({ open, close, closedDays, note: note.trim() });
    setSaved(true);
    setTimeout(() => router.back(), 450);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '가게 기본 정보' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>운영시간과 정기 휴무를 정해두면 근무표에 반영돼요.</Text>

        {/* 운영시간 */}
        <Text style={styles.label}>운영시간</Text>
        <View style={styles.card}>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>오픈</Text>
              <TextInput
                value={open}
                onChangeText={(t) => setOpen(maskHHMM(t))}
                keyboardType="number-pad"
                maxLength={5}
                placeholder="09:00"
                placeholderTextColor={InkColors.ink3}
                style={[styles.timeInp, !TIME_RE.test(open) && open.length > 0 && styles.bad]}
              />
            </View>
            <Ionicons name="arrow-forward" size={16} color={InkColors.ink3} style={{ marginTop: 20 }} />
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>마감</Text>
              <TextInput
                value={close}
                onChangeText={(t) => setClose(maskHHMM(t))}
                keyboardType="number-pad"
                maxLength={5}
                placeholder="22:00"
                placeholderTextColor={InkColors.ink3}
                style={[styles.timeInp, !TIME_RE.test(close) && close.length > 0 && styles.bad]}
              />
            </View>
          </View>
          {!valid && <Text style={styles.warn}>HH:MM 형식으로, 오픈이 마감보다 빠르게 입력해 주세요.</Text>}
        </View>

        {/* 정기 휴무 */}
        <Text style={styles.label}>정기 휴무 <Text style={styles.labelSub}>· {closedDaysLabel(closedDays)}</Text></Text>
        <View style={styles.card}>
          <View style={styles.dows}>
            {WEEKDAY_ORDER.map((wd) => {
              const on = closedDays.includes(wd);
              return (
                <Pressable
                  key={wd}
                  onPress={() => toggleDay(wd)}
                  style={[styles.dow, on && styles.dowOn, wd === 0 && on && styles.dowSun]}
                >
                  <Text style={[styles.dowText, on && { color: '#fff' }]}>{WEEKDAY_LABELS[wd]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>쉬는 요일을 누르세요. 연중무휴면 모두 끄면 돼요.</Text>
        </View>

        {/* 비고 */}
        <Text style={styles.label}>비고 (선택)</Text>
        <View style={styles.card}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="예) 14~15시 브레이크타임 · 명절 당일 휴무"
            placeholderTextColor={InkColors.ink3}
            style={styles.noteInp}
            multiline
          />
        </View>

        <Pressable onPress={save} disabled={!valid} style={({ pressed }) => [styles.saveBtn, !valid && { opacity: 0.4 }, pressed && valid && { opacity: 0.85 }]}>
          <Text style={styles.saveText}>{saved ? '저장됐어요 ✓' : '저장'}</Text>
        </Pressable>
        <View style={{ height: 12 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 10 },
  lead: { fontSize: 13.5, color: InkColors.ink2, lineHeight: 20 },

  label: { fontSize: 14, fontWeight: '800', color: InkColors.ink2, marginTop: 10 },
  labelSub: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3 },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 10, ...Elevation.e1 },

  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  timeField: { alignItems: 'center', gap: 6 },
  timeLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  timeInp: { width: 110, textAlign: 'center', fontSize: 24, fontWeight: '800', color: InkColors.ink, letterSpacing: 1, paddingVertical: 10, backgroundColor: InkColors.cream, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  bad: { borderColor: BrandColors.bad },
  warn: { fontSize: 12, color: BrandColors.bad, fontWeight: '700', textAlign: 'center' },

  dows: { flexDirection: 'row', justifyContent: 'space-between' },
  dow: { width: 38, height: 38, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  dowSun: { backgroundColor: BrandColors.bad, borderColor: BrandColors.bad },
  dowText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  hint: { fontSize: 12, color: InkColors.ink3 },

  noteInp: { fontSize: 14, color: InkColors.ink, minHeight: 56, lineHeight: 20, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },

  saveBtn: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  saveText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
