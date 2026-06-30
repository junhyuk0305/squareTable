import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

import type { PlaybookEntry } from '@/types';

/**
 * 후보 노하우 카드 — 매칭이 애매할 때 사장 라우팅 전에 "혹시 이거?"로 비슷한 노하우를 먼저 보여준다.
 *  · 후보를 탭하면 원본 노하우 상세를 연다(즉시 도움).
 *  · 진짜 없으면 '사장님께 등록'으로 떨어진다(기존 떠넘기기 경로).
 * 카테고리는 색 액센트로만(프레임 v2 — 라벨 비노출).
 */
type Props = {
  entries: PlaybookEntry[];
  onPick: (entry: PlaybookEntry) => void;
  onRegister: () => void;
};

export function CandidateCard({ entries, onPick, onRegister }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>🔎</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>혹시 이거 찾으세요?</Text>
          <Text style={styles.subtitle}>딱 맞는 답은 못 찾았지만, 비슷한 노하우가 있어요</Text>
        </View>
      </View>

      <View style={styles.list}>
        {entries.map((e) => {
          const meta = getCategoryMeta(e.category);
          const preview = e.square.situation || e.square.action.steps[0] || '';
          return (
            <Pressable
              key={e.id}
              onPress={() => onPick(e)}
              style={({ pressed }) => [styles.item, { borderLeftColor: meta.color }, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`${e.title} 자세히 보기`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.itemTitle} numberOfLines={1}>{e.title}</Text>
                {!!preview && <Text style={styles.itemPreview} numberOfLines={1}>{preview}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />

      <Pressable
        onPress={onRegister}
        style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Text style={styles.registerText}>찾는 게 없어요 · 사장님께 물어보기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    gap: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { fontSize: 24, lineHeight: 28 },
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  subtitle: { fontSize: 13, color: InkColors.ink3, fontWeight: '500' },

  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: InkColors.bg,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderLeftWidth: 4,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  itemTitle: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink },
  itemPreview: { fontSize: 12.5, color: InkColors.ink3 },

  divider: { height: 1, backgroundColor: InkColors.line },

  registerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  registerText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
});
