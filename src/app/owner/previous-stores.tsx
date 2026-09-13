// 이전 매장(0196) — 유료가 끝나 닫힌 매장 목록 + 다시 열기.
// 목록 판정은 서버(my_previous_units = unit_access_locked)가 SSOT 다. 다시 열기(reopen_store)는 새 매장 추가와
// 같은 규칙으로 이용권(슬롯) 1개를 쓰고, 직원·근무표·출퇴근·업무 보드를 비운다. 노하우·퀴즈·퀴즈 기록·채팅·설정은 남는다.
// 진입: 설정 → 이전 매장 · 매장 추가 → 이전 매장에서 고르기.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Appear, stagger } from '@/components/Appear';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { fetchMyPreviousUnits, rpcReopenStore, type PreviousUnitRow } from '@/lib/db';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function PreviousStores() {
  const router = useRouter();
  const refreshMembership = useSessionStore((s) => s.refreshMembership);
  const [rows, setRows] = useState<PreviousUnitRow[]>([]);
  // ★실패해도 true — 읽기 한 번 실패로 영영 로딩이 되면 안 된다(실패 고지는 db.ts readFail 배너).
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState<PreviousUnitRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchMyPreviousUnits().then(({ data }) => {
      if (!alive) return;
      if (data) setRows(data);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  const reopen = async () => {
    if (!target || busy) return;
    setBusy(true);
    const { error } = await rpcReopenStore(target.unit_id);
    setBusy(false);
    if (error) {
      setTarget(null);
      // named 에러 → 문구. 슬롯이 없으면 이용권 화면이 다음 행동이다.
      if (/no_store_slot/.test(error.message)) {
        return showToast('매장을 더 열려면 먼저 이용권을 늘려 주세요.', undefined, { label: '이용권 보기', onPress: () => router.push('/billing') });
      }
      if (/not_locked/.test(error.message)) return showToast('이 매장은 이미 열려 있어요.');
      return showToast('매장을 다시 열지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    showToast(`${target.store_name}을 다시 열었어요. 직원 초대코드가 새로 발급됐어요.`);
    setTarget(null);
    await refreshMembership();
    router.replace('/stores');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false, title: '이전 매장' }} />
      <ScreenTitleHeader title="이전 매장" backFallback="/account-settings" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!ready ? (
          <ScreenLoading label="이전 매장을 불러오고 있어요…" />
        ) : rows.length === 0 ? (
          <Appear delay={stagger(0)}>
            <View style={styles.card}>
              <Text style={styles.body}>이전 매장이 없어요. 이용권이 끝나 닫힌 매장이 여기에 보관돼요.</Text>
              <Pressable onPress={() => router.replace('/stores')} accessibilityRole="button" style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}>
                <Text style={styles.ghostText}>매장 목록으로</Text>
              </Pressable>
            </View>
          </Appear>
        ) : (
          <>
            <Appear delay={stagger(0)}>
              <Text style={styles.lead}>
                이용권이 끝나 닫힌 매장이에요. 다시 열면 이용권 1개를 쓰고, 노하우·퀴즈·채팅은 그대로 이어져요.
              </Text>
            </Appear>
            {rows.map((r, i) => (
              <Appear key={r.unit_id} delay={stagger(i + 1)}>
                <View style={styles.card}>
                  <View style={styles.rowHead}>
                    <View style={styles.icon}>
                      <Ionicons name="storefront-outline" size={20} color={InkColors.ink2} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{r.store_name}</Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {r.industry ? `${r.industry} · ` : ''}닫힌 날 {fmtDay(r.closed_at)}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => setTarget(r)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.ghostText}>다시 열기</Text>
                  </Pressable>
                </View>
              </Appear>
            ))}
          </>
        )}
      </ScrollView>

      {/* 직원 전원이 빠지는 동작이라 한 번 확인한다(되돌릴 수 없다). */}
      <ConfirmModal
        visible={target !== null}
        title={target ? `${target.store_name}을 다시 열까요?` : ''}
        message="이용권 1개를 써요. 직원·근무표·출퇴근·업무 보드는 비워지고 초대코드가 새로 발급돼요. 노하우·퀴즈·퀴즈 기록·채팅·매장 설정은 그대로 남아요."
        confirmLabel="다시 열기"
        cancelLabel="그대로 두기"
        busy={busy}
        onConfirm={() => void reopen()}
        onCancel={() => { if (!busy) setTarget(null); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.md },
  lead: { fontSize: 15, lineHeight: 22, color: InkColors.ink2, marginBottom: Space.xs },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  meta: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },
  body: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  ghost: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
});
