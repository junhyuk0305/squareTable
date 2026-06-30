import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RoleTabBar } from '@/components/RoleTabBar';
import { Avatar } from '@/components/Avatar';
import { SectionLabel } from '@/components/SectionLabel';
import { ScheduleWeek } from '@/components/schedule/ScheduleWeek';
import { ShiftEditorModal } from '@/components/schedule/ShiftEditorModal';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useScheduleStore, type ShiftTemplate, type SwapRequest } from '@/lib/store/useScheduleStore';
import type { Junior } from '@/types';
import { todayStr } from '@/lib/utils/attendance';
import { mondayOf, fmtDateKo, closedDaysLabel } from '@/lib/utils/schedule';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export default function OwnerScheduleScreen() {
  const router = useRouter();
  const staff = useStaffStore((s) => s.staff);
  const config = useScheduleStore((s) => s.config);
  const templates = useScheduleStore((s) => s.templates);
  const swaps = useScheduleStore((s) => s.swaps);
  const approveSwap = useScheduleStore((s) => s.approveSwap);
  const rejectSwap = useScheduleStore((s) => s.rejectSwap);

  const [monday, setMonday] = useState(() => mondayOf(todayStr()));
  const [editStaff, setEditStaff] = useState<Junior | null>(null);

  const nameOf = (id: string) => staff.find((x) => x.id === id)?.name ?? '직원';
  const tplById = (id: string) => templates.find((t) => t.id === id);

  // 사장 컨펌 대기(직원이 수락 완료한) 요청. 이미 지난 날짜는 컨펌 의미가 없어 제외.
  const today = todayStr();
  const pending = useMemo(
    () => swaps.filter((r) => r.status === 'accepted' && r.date >= today),
    [swaps, today],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '근무표' }} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ① 컨펌 대기 — 사장의 핵심 액션. 제목은 카드 밖, 대기 건수는 우측 뱃지 */}
        <View style={styles.section}>
          <SectionLabel
            icon="swap-horizontal-outline"
            title="교대 컨펌"
            trailing={
              pending.length > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pending.length}</Text>
                </View>
              ) : undefined
            }
          />
          {pending.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="checkmark-done-outline" size={20} color={InkColors.ink3} />
              <Text style={styles.emptyText}>컨펌할 교대 요청이 없어요.{'\n'}직원이 서로 합의하면 여기로 올라와요.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {pending.map((r) => (
                <PendingCard
                  key={r.id}
                  r={r}
                  nameOf={nameOf}
                  tplById={tplById}
                  onApprove={() => approveSwap(r.id)}
                  onReject={() => rejectSwap(r.id)}
                />
              ))}
            </View>
          )}
        </View>

        {/* ② 가게 기본 정보 */}
        <Pressable
          onPress={() => router.push('/owner/store-config')}
          style={({ pressed }) => [styles.infoCard, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.infoIcon}>
            <Ionicons name="storefront-outline" size={18} color={InkColors.ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>가게 기본 정보</Text>
            <Text style={styles.infoSub}>
              운영 {config.open}~{config.close} · 휴무 {closedDaysLabel(config.closedDays)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
        </Pressable>

        {/* ③ 직원 근무표 편집 */}
        <View style={styles.section}>
          <SectionLabel icon="people-outline" title="직원 근무표" />
          {staff.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={20} color={InkColors.ink3} />
              <Text style={styles.emptyText}>합류한 직원이 없어요.{'\n'}직원 관리에서 먼저 초대해 주세요.</Text>
            </View>
          ) : (
            <View style={styles.staffList}>
              {staff.map((st) => {
                const count = templates.filter((t) => t.staff_id === st.id).length;
                return (
                  <View key={st.id} style={styles.staffRow}>
                    <Avatar name={st.name} size={38} fontSize={15} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.staffName}>{st.name}</Text>
                      <Text style={styles.staffMeta}>{count > 0 ? `주 ${count}일 근무` : '근무표 미설정'}</Text>
                    </View>
                    <Pressable onPress={() => setEditStaff(st)} style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.8 }]}>
                      <Ionicons name="create-outline" size={15} color={InkColors.bubbleText} />
                      <Text style={styles.editText}>편집</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ④ 주간 전체 근무표 */}
        <View style={styles.section}>
          <SectionLabel icon="calendar-outline" title="전체 근무표" />
          <ScheduleWeek
            monday={monday}
            setMonday={setMonday}
            templates={templates}
            swaps={swaps}
            staff={staff}
            config={config}
          />
        </View>

        <View style={{ height: 12 }} />
      </ScrollView>

      {editStaff && <ShiftEditorModal staff={editStaff} onClose={() => setEditStaff(null)} />}

      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function PendingCard({
  r,
  nameOf,
  tplById,
  onApprove,
  onReject,
}: {
  r: SwapRequest;
  nameOf: (id: string) => string;
  tplById: (id: string) => ShiftTemplate | undefined;
  onApprove: () => void;
  onReject: () => void;
}) {
  const tpl = tplById(r.template_id);
  const tTpl = r.target_template_id ? tplById(r.target_template_id) : undefined;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindTag, r.kind === 'swap' && styles.kindTagSwap]}>
          <Text style={[styles.kindTagText, r.kind === 'swap' && { color: InkColors.bubbleText }]}>
            {r.kind === 'cover' ? '대타' : '맞교환'}
          </Text>
        </View>
        <Text style={styles.cardWait}>컨펌 대기</Text>
      </View>

      {/* 누가 빠지고 누가 들어오는지 */}
      <View style={styles.flow}>
        <View style={styles.flowCol}>
          <Text style={styles.flowLabel}>빠짐</Text>
          <Text style={styles.flowName}>{nameOf(r.requester_id)}</Text>
          <Text style={styles.flowWhen}>
            {fmtDateKo(r.date)}
            {'\n'}
            {tpl ? `${tpl.start}~${tpl.end}` : ''}
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color={InkColors.ink3} />
        <View style={styles.flowCol}>
          <Text style={styles.flowLabel}>들어옴</Text>
          <Text style={styles.flowName}>{r.accepted_by ? nameOf(r.accepted_by) : '—'}</Text>
          <Text style={styles.flowWhen}>
            {r.kind === 'swap' && r.target_date ? fmtDateKo(r.target_date) : '같은 시간 대타'}
            {r.kind === 'swap' && tTpl ? `\n${tTpl.start}~${tTpl.end}` : ''}
          </Text>
        </View>
      </View>

      {!!r.note && <Text style={styles.cardNote}>“{r.note}”</Text>}

      <View style={styles.actions}>
        <Pressable onPress={onReject} accessibilityRole="button" accessibilityLabel="교대 요청 반려" style={({ pressed }) => [styles.actBtn, styles.rejectBtn, pressed && { opacity: 0.8 }]}>
          <Text style={styles.rejectText}>반려</Text>
        </Pressable>
        <Pressable onPress={onApprove} accessibilityRole="button" accessibilityLabel="교대 요청 승인" style={({ pressed }) => [styles.actBtn, styles.approveBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="checkmark" size={16} color={InkColors.bubbleText} />
          <Text style={styles.approveText}>승인</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 16 },
  section: { gap: 10 },

  badge: { minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: Radius.pill, backgroundColor: BrandColors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '900', color: InkColors.bubbleText },

  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 24, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line },
  emptyText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },

  // 컨펌 카드
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.yellowDeep, padding: 14, gap: 10, ...Elevation.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindTag: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  kindTagSwap: { backgroundColor: InkColors.ink },
  kindTagText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  cardWait: { fontSize: 11.5, fontWeight: '800', color: BrandColors.warn },

  flow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flowCol: { flex: 1, gap: 2 },
  flowLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  flowName: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  flowWhen: { fontSize: 12, color: InkColors.ink2, lineHeight: 17, fontWeight: '600' },
  cardNote: { fontSize: 13, color: InkColors.ink2, fontStyle: 'italic', backgroundColor: InkColors.cream, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8 },

  actions: { flexDirection: 'row', gap: 10 },
  actBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12, borderRadius: Radius.md },
  rejectBtn: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  rejectText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  approveBtn: { backgroundColor: InkColors.ink },
  approveText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },

  // 가게 정보
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, padding: 14, marginTop: 6, ...Elevation.e1 },
  infoIcon: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  infoSub: { fontSize: 12.5, color: InkColors.ink3, marginTop: 2, fontWeight: '600' },

  // 직원 리스트
  staffList: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  staffName: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  staffMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: InkColors.ink, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill },
  editText: { fontSize: 13, fontWeight: '800', color: InkColors.bubbleText },
});
