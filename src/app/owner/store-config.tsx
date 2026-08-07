import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { SectionLabel } from '@/components/SectionLabel';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { maskHHMM } from '@/lib/utils/attendance';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, closedDaysLabel } from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

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

  // 다점포 매장 삭제 — 매장이 2개 이상일 때만. 파괴적이라 빨강 확인 → 성공 시 활성 재지정·목록 갱신.
  const stores = useSessionStore((s) => s.stores);
  const storeName = useSessionStore((s) => s.storeName);
  const deleteStore = useSessionStore((s) => s.deleteStore);
  // 0093: 매장 삭제 = 사장 전용(잠금 영역). 매니저에겐 위험 구역 자체를 비노출.
  const isOwner = useSessionStore((s) => s.role) === 'owner';
  const [deleting, setDeleting] = useState(false);

  const onDelete = async () => {
    const ok = await confirmAction(
      '이 매장을 삭제할까요?',
      `“${storeName}”의 노하우·근무·급여 등 모든 데이터가 영구 삭제돼요. 되돌릴 수 없어요.`,
      '삭제',
      { destructive: true, icon: 'trash-outline' },
    );
    if (!ok) return;
    setDeleting(true);
    const { error } = await deleteStore(useSessionStore.getState().unitId);
    setDeleting(false);
    if (error) return showToast(error, 'warn');
    showToast('매장을 삭제했어요.');
    router.replace('/owner/dashboard');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '매장 기본 정보' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>운영시간과 정기 휴무를 정해두면 근무표에 반영돼요.</Text>

        {/* 운영시간 — 이 화면의 최우선. 2026-08-06: 카드 껍데기를 벗겨 시각 자체가 화면에서 가장 큰
            요소가 되게 했다(세 섹션이 전부 '제목→카드'라 한 종류의 나열로 읽히던 것을 여기서 끊는다). */}
        <View style={styles.section}>
          <SectionLabel title="운영시간" />
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
            <Ionicons name="arrow-forward" size={16} color={InkColors.ink3} style={styles.timeArrow} />
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

        {/* 정기 휴무 — 카드 없이 칩 줄. 선택 상태 요약(연중무휴·월·화)은 라벨 우측 hint 로 올렸다. */}
        <View style={styles.section}>
          <SectionLabel title="정기 휴무" hint={closedDaysLabel(closedDays)} />
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

        {/* 비고 — 이 화면에서 유일하게 카드로 남긴 블록(배치규칙⑤: 화면당 카드 1~2개는 남긴다).
            여러 줄 자유 입력이라 경계면이 있어야 어디까지 쓰는 칸인지 보인다. */}
        <View style={styles.section}>
          <SectionLabel title="비고" hint="선택" />
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
        </View>

        <Pressable onPress={save} disabled={!valid} style={({ pressed }) => [styles.saveBtn, !valid && { opacity: 0.4 }, pressed && valid && { opacity: 0.85 }]}>
          <Text style={styles.saveText}>{saved ? '저장됐어요 ✓' : '저장'}</Text>
        </Pressable>

        {/* 다점포 전용 위험 구역 — 이 매장 삭제(사장 전용 + 매장 2개 이상일 때만) */}
        {isOwner && stores.length > 1 ? (
          <View style={styles.dangerBox}>
            <Text style={styles.dangerLabel}>위험 구역</Text>
            <Text style={styles.dangerDesc}>이 매장(“{storeName}”)을 완전히 삭제해요. 노하우·근무·급여 등 모든 데이터가 사라지고 되돌릴 수 없어요. (직원이 있으면 먼저 내보내야 해요.)</Text>
            <Pressable
              onPress={onDelete}
              disabled={deleting}
              style={({ pressed }) => [styles.dangerBtn, (pressed || deleting) && { opacity: 0.65 }]}
              accessibilityRole="button"
              accessibilityLabel="이 매장 삭제"
            >
              <Ionicons name="trash-outline" size={16} color={BrandColors.bad} />
              <Text style={styles.dangerBtnText}>{deleting ? '삭제 중…' : '이 매장 삭제'}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ height: 12 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.xl },
  lead: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },

  // 카드가 빠진 자리에서 섹션을 가르는 건 여백이다 — 섹션 안은 좁게(sm), 섹션 사이는 넓게(scroll gap xl).
  section: { gap: Space.sm },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 16, gap: 10, ...Elevation.e1 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  timeField: { flex: 1, alignItems: 'center', gap: Space.xs },
  // 필드 위 라벨 높이만큼 화살표를 내려 시각 입력의 세로 중앙에 맞춘다(라벨은 화살표 쪽에 없다).
  timeArrow: { marginTop: Space.gutter },
  timeLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  // 카드 보더가 사라졌으니 입력칸이 스스로 면을 갖는다 — 흰 배경에 흰 필드면 어디를 누르는지 안 보인다.
  timeInp: { alignSelf: 'stretch', textAlign: 'center', fontSize: 24, fontWeight: '800', color: InkColors.ink, letterSpacing: 1, paddingVertical: 10, backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  bad: { borderColor: BrandColors.bad },
  warn: { fontSize: 15, color: BrandColors.badText, fontWeight: '700', textAlign: 'center' },

  dows: { flexDirection: 'row', justifyContent: 'space-between' },
  dow: { width: 38, height: 38, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  dowSun: { backgroundColor: BrandColors.badSolid, borderColor: BrandColors.bad },
  dowText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  hint: { fontSize: 12, color: InkColors.ink3 },

  noteInp: { fontSize: 15, color: InkColors.ink, minHeight: 56, lineHeight: 22, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },

  saveBtn: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  dangerBox: { marginTop: Space.lg, borderWidth: 1, borderColor: BrandColors.bad, borderRadius: Radius.md, padding: 16, gap: 8, backgroundColor: InkColors.bg },
  dangerLabel: { fontSize: 12, fontWeight: '800', color: BrandColors.badText, letterSpacing: 0.3 },
  dangerDesc: { fontSize: 15, color: InkColors.ink2, lineHeight: 21 },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, paddingVertical: 12, borderRadius: Radius.sm, borderWidth: 1, borderColor: BrandColors.bad, backgroundColor: InkColors.bg },
  dangerBtnText: { fontSize: 14, fontWeight: '800', color: BrandColors.badText },
});
