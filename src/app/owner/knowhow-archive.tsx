// 노하우 보관함(J10 · 0248) — 사장이 보관한 노하우 목록 + 되살리기.
// 보관한 노하우는 직원 화면·AI 검색·퀴즈에서 빠져 있고, 응시·통과 기록은 그대로 남아 있다.
// 읽기는 정의자 RPC archived_knowhow(소유주만)다 — RLS 가 보관 행을 아무에게도 직접 보여 주지 않는다.
// 되돌릴 수 없는 지우기 버튼은 두지 않는다(J10 기록 유지). 진입: 노하우 탭 · 내 노하우 머리의 '보관함'.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear, stagger } from '@/components/Appear';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

function fmtDay(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function KnowhowArchive() {
  const archived = usePlaybookStore((s) => s.archived);
  const ready = usePlaybookStore((s) => s.archivedLoaded);
  const loadArchived = usePlaybookStore((s) => s.loadArchived);
  const restore = usePlaybookStore((s) => s.restore);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void loadArchived();
  }, [loadArchived]);

  const onRestore = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    const ok = await restore(id);
    setBusyId(null);
    showToast(ok ? '되살렸어요. 직원 화면과 퀴즈에 다시 보여요.' : '되살리지 못했어요. 잠시 후 다시 시도해 주세요.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false, title: '보관함' }} />
      <ScreenTitleHeader title="보관함" backFallback="/owner/knowledge" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!ready ? (
          <ScreenLoading label="보관한 노하우를 불러오고 있어요…" />
        ) : archived.length === 0 ? (
          <Appear delay={stagger(0)}>
            <View style={styles.card}>
              <Text style={styles.body}>보관한 노하우가 없어요.</Text>
            </View>
          </Appear>
        ) : (
          <>
            <Appear delay={stagger(0)}>
              <Text style={styles.lead}>보관한 노하우는 직원 화면과 퀴즈에서 빠져 있어요. 되살리면 다시 보여요.</Text>
            </Appear>
            {archived.map((e, i) => (
              <Appear key={e.id} delay={stagger(i + 1)}>
                <View style={styles.card}>
                  <View style={styles.rowHead}>
                    <View style={styles.icon}>
                      <Ionicons name="archive-outline" size={20} color={InkColors.ink2} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={2}>{e.title}</Text>
                      <Text style={styles.meta} numberOfLines={1}>보관한 날 {fmtDay(e.archived_at)}</Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => void onRestore(e.id)}
                    disabled={busyId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`${e.title} 되살리기`}
                    style={({ pressed }) => [styles.ghost, (pressed || busyId === e.id) && { opacity: 0.6 }]}
                  >
                    <Text style={styles.ghostText}>되살리기</Text>
                  </Pressable>
                </View>
              </Appear>
            ))}
          </>
        )}
      </ScrollView>
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
