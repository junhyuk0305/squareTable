import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Avatar } from '@/components/Avatar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { DEFAULT_HOURLY_WAGE } from '@/lib/utils/attendance';
import { useCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { rotateInviteCode } from '@/lib/db';

export default function OwnerStaffScreen() {
  const router = useRouter();
  const wages = usePayrollStore((s) => s.wages);
  const setWage = usePayrollStore((s) => s.setWage);
  const staff = useStaffStore((s) => s.staff);
  const removeStaff = useStaffStore((s) => s.removeStaff);
  const pending = useStaffStore((s) => s.pending);
  const approve = useStaffStore((s) => s.approve);
  const reject = useStaffStore((s) => s.reject);
  const INVITE_CODE = useSessionStore((s) => s.inviteCode) || '------';

  // 내보낼 직원 — 확인 모달용. 실수 방지 위해 빨강 모달로 한 번 더 확인한다.
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  // 거절 대상 — 확인 모달용(신청 거절도 되돌리기 번거로우니 한 번 확인).
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const confirmRemove = () => {
    if (!removeTarget) return;
    removeStaff(removeTarget.id); // 낙관적 제거(실패 시 자동 복원·배너)
    setRemoveTarget(null);
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    reject(rejectTarget.id);
    setRejectTarget(null);
  };

  // 초대코드 재발급(남용 #31) — 새 6자리+7일 만료. 이전 코드는 즉시 무효(유출 차단).
  const confirmRotate = async () => {
    setRotating(true);
    const res = await rotateInviteCode();
    setRotating(false);
    setRotateOpen(false);
    if (res) useSessionStore.setState({ inviteCode: res.inviteCode });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '직원 관리' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 초대코드 */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>가게 초대코드</Text>
          <Text style={styles.inviteCode}>{INVITE_CODE}</Text>
          <Text style={styles.inviteHint}>직원이 코드를 입력해 신청하면 아래에서 승인해 주세요. 승인 전에는 매장 정보에 접근할 수 없어요.</Text>
          <View style={styles.inviteBtnRow}>
            <Pressable onPress={() => copy(INVITE_CODE)} style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#FFFFFF" />
              <Text style={styles.copyText}>{copied ? '복사됨' : '코드 복사'}</Text>
            </Pressable>
            <Pressable onPress={() => setRotateOpen(true)} style={({ pressed }) => [styles.rotateBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
              <Text style={styles.copyText}>코드 변경</Text>
            </Pressable>
          </View>
        </View>

        {/* 합류 신청(승인 대기) — 남용 #2. 코드로 신청한 사람을 사장이 승인해야 소속된다. */}
        {pending.length > 0 && (
          <View style={styles.pendingWrap}>
            <Text style={styles.sectionTitle}>합류 신청 ({pending.length}명) <Text style={styles.sectionSub}>· 승인해야 합류돼요</Text></Text>
            <View style={styles.list}>
              {pending.map((p) => (
                <View key={p.id} style={styles.staffRow}>
                  <Avatar name={p.name} size={40} fontSize={15} />
                  <View style={styles.nameCol}>
                    <Text style={styles.staffName} numberOfLines={1}>{p.name || '이름 미입력'}</Text>
                    <Text style={styles.staffMeta} numberOfLines={1}>{p.phone_last4 ? `••••-${p.phone_last4}` : '연락처 미입력'}</Text>
                  </View>
                  <Pressable onPress={() => setRejectTarget({ id: p.id, name: p.name || '신청자' })} hitSlop={6} style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.rejectText}>거절</Text>
                  </Pressable>
                  <Pressable onPress={() => approve(p.id)} hitSlop={6} style={({ pressed }) => [styles.approveBtn, pressed && { opacity: 0.85 }]}>
                    <Text style={styles.approveText}>승인</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 직원 목록 */}
        <Text style={styles.sectionTitle}>합류한 직원 ({staff.length}명) <Text style={styles.sectionSub}>· 탭 → 출근기록</Text></Text>
        {staff.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={22} color={InkColors.ink3} />
            <Text style={styles.emptyText}>아직 합류한 직원이 없어요.{'\n'}위 초대코드를 직원에게 알려주세요.</Text>
          </View>
        ) : (
        <View style={styles.list}>
          {staff.map((s) => (
            <View key={s.id} style={styles.staffRow}>
              <Pressable onPress={() => router.push(`/owner/timesheet/${s.id}`)} style={({ pressed }) => [styles.staffTap, pressed && { opacity: 0.6 }]}>
                <Avatar name={s.name} size={40} fontSize={15} />
                <View style={styles.nameCol}>
                  <Text style={styles.staffName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.staffMeta} numberOfLines={1}>{s.shift ?? '시프트 미지정'}</Text>
                </View>
              </Pressable>
              <View style={styles.wageBox}>
                <Text style={styles.wageLabel}>시급</Text>
                <View style={styles.wageInputRow}>
                  <TextInput
                    value={String(wages[s.id] ?? DEFAULT_HOURLY_WAGE)}
                    onChangeText={(t) => setWage(s.id, Math.min(Number(t.replace(/[^0-9]/g, '').slice(0, 7)) || 0, 1000000))}
                    keyboardType="number-pad"
                    maxLength={7}
                    style={styles.wageInput}
                  />
                  <Text style={styles.wageWon}>원</Text>
                </View>
              </View>
              {/* 내보내기 — 오탭 방지로 빨강 모달 확인 후 실행 */}
              <Pressable
                onPress={() => setRemoveTarget({ id: s.id, name: s.name })}
                hitSlop={8}
                accessibilityLabel={`${s.name} 내보내기`}
                style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="person-remove-outline" size={19} color={BrandColors.bad} />
              </Pressable>
            </View>
          ))}
        </View>
        )}
        <Text style={styles.demoNote}>* 시급을 바꾸면 근무·급여 화면에 바로 반영돼요.</Text>
        <View style={{ height: 12 }} />
      </ScrollView>
      <ConfirmModal
        visible={!!removeTarget}
        icon="person-remove-outline"
        destructive
        title="직원 내보내기"
        message={`'${removeTarget?.name ?? ''}' 님을 매장에서 내보내요.\n내보내면 이 직원은 더 이상 매장 노하우·근무에 접근할 수 없어요. 다시 함께하려면 초대코드로 재합류해야 해요.`}
        confirmLabel="내보내기"
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
      <ConfirmModal
        visible={!!rejectTarget}
        icon="close-circle-outline"
        destructive
        title="합류 신청 거절"
        message={`'${rejectTarget?.name ?? ''}' 님의 합류 신청을 거절해요.\n거절해도 상대는 다시 신청할 수 있어요.`}
        confirmLabel="거절"
        onConfirm={confirmReject}
        onCancel={() => setRejectTarget(null)}
      />
      <ConfirmModal
        visible={rotateOpen}
        icon="refresh-outline"
        destructive
        title="초대코드 변경"
        message={'새 초대코드를 만들면 이전 코드는 즉시 못 쓰게 돼요.\n이미 코드를 받은 직원에게는 새 코드를 다시 알려주세요.'}
        confirmLabel={rotating ? '변경 중…' : '코드 변경'}
        onConfirm={confirmRotate}
        onCancel={() => setRotateOpen(false)}
      />
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 12 },

  inviteCard: { backgroundColor: InkColors.ink, borderRadius: Radius.lg, padding: 20, gap: 6, alignItems: 'flex-start' },
  inviteLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  inviteCode: { fontSize: 30, fontWeight: '900', color: '#FFFFFF', letterSpacing: 3 },
  inviteHint: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 17 },
  inviteBtnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', paddingVertical: 9, paddingHorizontal: 14, borderRadius: Radius.pill },
  rotateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 9, paddingHorizontal: 14, borderRadius: Radius.pill },
  copyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  pendingWrap: { gap: 8 },
  rejectBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line },
  rejectText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  approveBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: Radius.sm, backgroundColor: BrandColors.brand },
  approveText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink2, marginTop: 6 },
  sectionSub: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },

  list: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  staffTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  nameCol: { flex: 1, minWidth: 0 },
  staffName: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  staffMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  wageBox: { alignItems: 'flex-end', gap: 3 },
  wageLabel: { fontSize: 11, color: InkColors.ink3, fontWeight: '600' },
  wageInputRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  wageInput: { minWidth: 64, textAlign: 'right', borderWidth: 1, borderColor: InkColors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 14, color: InkColors.ink },
  wageWon: { fontSize: 13, color: InkColors.ink3 },
  removeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm, backgroundColor: BrandColors.accentSoft },

  demoNote: { fontSize: 12, color: InkColors.ink3, marginTop: 6 },
  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 28, backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line },
  emptyText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },
});
