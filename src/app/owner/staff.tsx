import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePayrollStore } from '@/lib/store/usePayrollStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors, BrandColors } from '@/lib/theme/colors';

export default function OwnerStaffScreen() {
  const wages = usePayrollStore((s) => s.wages);
  const setWage = usePayrollStore((s) => s.setWage);
  const staff = useStaffStore((s) => s.staff);
  const INVITE_CODE = useSessionStore((s) => s.inviteCode) || '------';

  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState('');
  const [invites, setInvites] = useState<string[]>([]);

  const copy = async () => {
    const nav = (globalThis as any).navigator;
    const writeText = nav?.clipboard?.writeText;
    // 실제 복사가 가능한 환경(주로 웹)에서만 '복사됨'을 표시한다(네이티브 거짓 성공 방지).
    if (typeof writeText !== 'function') return;
    try {
      await writeText.call(nav.clipboard, INVITE_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 복사 실패 시 상태 변화 없음 */
    }
  };
  const sendInvite = () => {
    const v = phone.trim();
    if (!v) return;
    setInvites((p) => [v, ...p]);
    setPhone('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '직원 관리' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 초대코드 */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>가게 초대코드</Text>
          <Text style={styles.inviteCode}>{INVITE_CODE}</Text>
          <Text style={styles.inviteHint}>직원이 회원가입 시 이 코드를 입력하면 합류 신청이 됩니다.</Text>
          <Pressable onPress={copy} style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.85 }]}>
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
            <Text style={styles.inviteBtnText}>초대</Text>
          </Pressable>
        </View>
        {invites.map((p, i) => (
          <View key={`${p}-${i}`} style={styles.pendingRow}>
            <Ionicons name="time-outline" size={16} color={InkColors.ink3} />
            <Text style={styles.pendingText}>{p}</Text>
            <Text style={styles.pendingTag}>초대 보냄</Text>
          </View>
        ))}

        {/* 직원 목록 */}
        <Text style={styles.sectionTitle}>직원 ({staff.length}명)</Text>
        {staff.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={22} color={InkColors.ink3} />
            <Text style={styles.emptyText}>아직 합류한 직원이 없어요.{'\n'}위 초대코드를 직원에게 알려주세요.</Text>
          </View>
        ) : (
        <View style={styles.list}>
          {staff.map((s) => (
            <View key={s.id} style={styles.staffRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{s.name.slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.staffName}>{s.name}</Text>
                <Text style={styles.staffMeta}>{s.shift ?? '시프트 미지정'}</Text>
              </View>
              <View style={styles.wageBox}>
                <Text style={styles.wageLabel}>시급</Text>
                <View style={styles.wageInputRow}>
                  <TextInput
                    value={String(wages[s.id] ?? 10030)}
                    onChangeText={(t) => setWage(s.id, Number(t.replace(/[^0-9]/g, '')) || 0)}
                    keyboardType="number-pad"
                    style={styles.wageInput}
                  />
                  <Text style={styles.wageWon}>원</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
        )}
        <Text style={styles.demoNote}>* 시급은 즉시 반영됩니다(근무·급여 화면). 승인/권한은 데이터 연결 단계에서.</Text>
        <View style={{ height: 12 }} />
      </ScrollView>
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 12 },

  inviteCard: { backgroundColor: InkColors.ink, borderRadius: 16, padding: 20, gap: 6, alignItems: 'flex-start' },
  inviteLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  inviteCode: { fontSize: 30, fontWeight: '900', color: '#FFFFFF', letterSpacing: 3 },
  inviteHint: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 17 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.16)', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999 },
  copyText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  sectionTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink2, marginTop: 6 },
  addRow: { flexDirection: 'row', gap: 10 },
  addInput: { flex: 1, borderWidth: 1, borderColor: InkColors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: InkColors.ink, backgroundColor: '#FFFFFF' },
  inviteBtn: { paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: BrandColors.brand },
  inviteBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  pendingText: { flex: 1, fontSize: 14, color: InkColors.ink2 },
  pendingTag: { fontSize: 12, color: InkColors.ink3, fontWeight: '700' },

  list: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  staffName: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  staffMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  wageBox: { alignItems: 'flex-end', gap: 3 },
  wageLabel: { fontSize: 11, color: InkColors.ink3, fontWeight: '600' },
  wageInputRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  wageInput: { minWidth: 64, textAlign: 'right', borderWidth: 1, borderColor: InkColors.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 14, color: InkColors.ink },
  wageWon: { fontSize: 13, color: InkColors.ink3 },

  demoNote: { fontSize: 12, color: InkColors.ink3, marginTop: 6 },
  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 28, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line },
  emptyText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },
});
