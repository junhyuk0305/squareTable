import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { logout } from '@/lib/auth';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import type { PlaybookEntry } from '@/types';

function LogoutHeaderBtn() {
  return (
    <Pressable onPress={() => void logout()} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: BrandColors.brand }}>로그아웃</Text>
    </Pressable>
  );
}

// 검증 3-state 배지 — BrowseList/SquareCard와 동일 매핑.
type VerifyMeta = { label: string; fg: string; bg: string };
function verifyMeta(state: PlaybookEntry['verification']): VerifyMeta | null {
  switch (state?.state) {
    case 'owner_verified':
      return { label: '사장님 검증', fg: InkColors.ink, bg: BrandColors.yellowSoft };
    case 'field_tested':
      return { label: '현장 검증', fg: BrandColors.good, bg: '#E6F1EA' };
    case 'unverified':
      return { label: '미검증', fg: InkColors.ink3, bg: InkColors.bgSoft };
    default:
      return null;
  }
}

/**
 * 내 노하우 — 사장님이 등록한 노하우 전체 목록(노하우 탭 '내 노하우'의 전체 보기).
 * 각 행: 카테고리 점·제목·검증배지·해결률·버전. 탭하면 수정.
 */
export default function OwnerKnowledgeScreen() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);

  // 카테고리 → 발행/검증 우선 노출은 그대로 두고, 정렬은 기존 입력순 유지.
  const list = useMemo(() => entries, [entries]);

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: '내 노하우', headerRight: () => <LogoutHeaderBtn /> }} />
        <ActivityIndicator color={InkColors.ink3} />
        <Text style={styles.loadingText}>노하우를 불러오는 중...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '내 노하우' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headRow}>
          <Text style={styles.subline}>
            총 {list.length}개{list.length > 0 ? ' · 탭하면 수정할 수 있어요' : ''}
          </Text>
          <Pressable
            onPress={() => router.push('/owner/categories')}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.addBtnText}>노하우 추가</Text>
          </Pressable>
        </View>

        {list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📒</Text>
            <Text style={styles.emptyTitle}>아직 등록된 노하우가 없어요</Text>
            <Text style={styles.emptyHint}>
              알바 질문에 답하거나, 직접 추가하면 여기에 쌓여요.
            </Text>
            <Pressable
              onPress={() => router.push('/owner/categories')}
              style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.emptyBtnText}>첫 노하우 추가하기</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {list.map((e) => {
              const meta = getCategoryMeta(e.category);
              const v = verifyMeta(e.verification);
              const ratePct = Math.round((e.stats?.resolution_rate ?? 0) * 100);
              return (
                <Pressable
                  key={e.id}
                  onPress={() => router.push({ pathname: '/owner/edit/[id]', params: { id: e.id } })}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.dot, { backgroundColor: meta.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>
                      {e.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.meta}>
                        {meta.label} · v{e.version}
                      </Text>
                      {e.stats?.resolution_rate ? (
                        <Text style={styles.metaRate}>· 해결률 {ratePct}%</Text>
                      ) : null}
                      {v ? (
                        <View style={[styles.badge, { backgroundColor: v.bg }]}>
                          <Text style={[styles.badgeText, { color: v.fg }]}>{v.label}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={{ height: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  scroll: { padding: 20, gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  subline: { flex: 1, fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: InkColors.ink,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  addBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 48,
    paddingHorizontal: 16,
  },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  emptyHint: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 19 },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: InkColors.ink,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  list: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontSize: 15, fontWeight: '600', color: InkColors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  metaRate: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  badge: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.pill },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
