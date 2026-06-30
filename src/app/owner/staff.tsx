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

export default function OwnerStaffScreen() {
  const router = useRouter();
  const wages = usePayrollStore((s) => s.wages);
  const setWage = usePayrollStore((s) => s.setWage);
  const staff = useStaffStore((s) => s.staff);
  const removeStaff = useStaffStore((s) => s.removeStaff);
  const INVITE_CODE = useSessionStore((s) => s.inviteCode) || '------';

  // 내보낼 직원 — 확인 모달용. 실수 방지 위해 빨강 모달로 한 번 더 확인한다.
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [phone, setPhone] = useState('');
  // 대기 중인 초대(아직 합류 전) — 재전송/취소 가능. 합류 완료 시 목록에서 제거.
  const [invites, setInvites] = useState<{ phone: string; status: '초대 보냄' | '재전송됨' }[]>([]);
  const { copied, copy } = useCopyToClipboard();

  const sendInvite = () => {
    const v = phone.trim();
    if (!v) return;
    setInvites((p) => (p.some((x) => x.phone === v) ? p : [{ phone: v, status: '초대 보냄' }, ...p]));
    setPhone('');
  };
  const resendInvite = (target: string) =>
    setInvites((p) => p.map((x) => (x.phone === target ? { ...x, status: '재전송됨' } : x)));
  const cancelInvite = (target: string) => setInvites((p) => p.filter((x) => x.phone !== target));

  const confirmRemove = () => {
    if (!removeTarget) return;
    removeStaff(removeTarget.id); // 낙관적 제거(실패 시 자동 복원·배너)
    setRemoveTarget(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '직원 관리' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 초대코드 */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>가게 초대코드</Text>
          <Text style={styles.inviteCode}>{INVITE_CODE}</Text>
          <Text style={styles.inviteHint}>직원이 회원가입 때 이 코드를 입력하면 바로 우리 가게에 합류돼요.</Text>
          <Pressable onPress={() => copy(INVITE_CODE)} style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#FFFFFF" />
            <Text style={styles.copyText}>{copied ? '복사됨' : '코드 복사'}</Text>
          </Pressable>
        </View>

        {/* 전화번호로 초대 */}
        <Text style={styles.sectionTitle}>전화번호로 초대</Text>
        <View style={styles.addRow}>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="010-0000-0000"
            placeholderTextColor={InkColors.ink3}
            keyboardType="phone-pad"
            style={styles.addInput}
            onSubmitEditing={sendInvite}
          />
          <Pressable onPress={sendInvite} disabled={!phone.trim()} style={({ pressed }) => [styles.inviteBtn, { opacity: !phone.trim() ? 0.4 : pressed ? 0.85 : 1 }]}>
            <Text style={styles.inviteBtnText}>초대 보내기</Text>
          </Pressable>
        </View>
        <Text style={styles.inviteHelp}>번호로 초대코드+앱 링크를 보냅니다. 상대가 직원 회원가입을 마치면 아래 ‘직원’으로 이동해요.</Text>

        {invites.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>대기 중인 초대 <Text style={styles.sectionSub}>(아직 합류 전)</Text></Text>
            <View style={styles.list}>
              {invites.map((inv) => (
                <View key={inv.phone} style={styles.pendingRow}>
                  <Ionicons name="time-outline" size={16} color={InkColors.ink3} />
                  <Text style={styles.pendingText}>{inv.phone}</Text>
                  <Text style={styles.pendingTag}>{inv.status}</Text>
                  <Pressable onPress={() => resendInvite(inv.phone)} hitSlop={6} style={({ pressed }) => [styles.pendingAction, pressed && { opacity: 0.6 }]}>
                    <Text style={styles.pendingActionText}>재전송</Text>
                  </Pressable>
                  <Pressable onPress={() => cancelInvite(inv.phone)} hitSlop={6} style={({ pressed }) => [styles.pendingCancel, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="close" size={16} color={InkColors.ink3} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.staffName}>{s.name}</Text>
                  <Text style={styles.staffMeta}>{s.shift ?? '시프트 미지정'}</Text>
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
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.16)', paddingVertical: 9, paddingHorizontal: 14, borderRadius: Radius.pill },
  copyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink2, marginTop: 6 },
  sectionSub: { fontSize: 12, fontWeight: '600', color: InkColors.ink3 },
  inviteHelp: { fontSize: 12, color: InkColors.ink3, lineHeight: 17, marginTop: -4 },
  addRow: { flexDirection: 'row', gap: 10 },
  addInput: { flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  inviteBtn: { paddingHorizontal: 20, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: BrandColors.brand },
  inviteBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  pendingText: { flex: 1, fontSize: 14, color: InkColors.ink2 },
  pendingTag: { fontSize: 11, color: InkColors.ink3, fontWeight: '700', backgroundColor: InkColors.bgSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  pendingAction: { paddingHorizontal: 8, paddingVertical: 4 },
  pendingActionText: { fontSize: 12, fontWeight: '800', color: BrandColors.brand },
  pendingCancel: { paddingHorizontal: 2, paddingVertical: 4 },

  list: { backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  staffTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
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
