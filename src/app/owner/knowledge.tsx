import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors } from '@/lib/theme/colors';

export default function OwnerKnowledgeScreen() {
  const router = useRouter();
  const entries = usePlaybookStore((s) => s.entries);
  const loaded = usePlaybookStore((s) => s.loaded);

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: '내 노하우' }} />
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
            총 {entries.length}개{entries.length > 0 ? ' · 탭하면 수정할 수 있어요' : ''}
          </Text>
          <Pressable
            onPress={() => router.push('/owner/categories')}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.addBtnText}>노하우 추가</Text>
          </Pressable>
        </View>

        {entries.length === 0 ? (
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
            {entries.map((e) => {
              const meta = getCategoryMeta(e.category);
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
                    <Text style={styles.meta}>
                      {meta.label} · v{e.version}
                    </Text>
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
  meta: { fontSize: 12, color: InkColors.ink3, marginTop: 2, fontWeight: '600' },
});
