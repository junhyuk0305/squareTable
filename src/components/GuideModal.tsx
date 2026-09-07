// 사용 안내 팝업 — 카드 2~3장을 '다음'으로 넘기며 읽는다.
// ConfirmModal 과 같은 방식으로 그린다(Modal + frameCapStyle) — 모바일 프레임(460px) 밖으로 새지 않게.
// ★딤을 눌러도 닫히지 않는다. 안내 도중 실수로 닫히는 것을 막는다(CoachmarkTour 와 같은 규칙).
import { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

import { Appear, stagger } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { frameCapStyle } from '@/lib/theme/layout';
import type { Guide } from '@/lib/guides/guideContent';

export function GuideModal({
  guide,
  visible,
  onClose,
}: {
  guide: Guide | null;
  visible: boolean;
  onClose: () => void;
}) {
  // 다른 가이드로 바뀌면 첫 장부터 — 호스트가 key 로 갈아 끼운다(여기서 effect 로 되돌리지 않는다).
  const [index, setIndex] = useState(0);

  if (!guide) return null;
  const total = guide.pages.length;
  const page = guide.pages[Math.min(index, total - 1)];
  const isLast = index >= total - 1;

  const next = () => {
    if (isLast) onClose();
    else setIndex((i) => i + 1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[frameCapStyle, { flex: 1 }]}>
        <View style={styles.backdrop}>
          {/* key={index} — 장을 넘길 때마다 등장 애니메이션을 다시 태운다(넘어간 게 보이도록). */}
          <Appear key={index}>
            <View style={styles.card}>
              <Appear delay={stagger(0)}>
                <Text style={styles.title}>{page.title}</Text>
              </Appear>
              <Appear delay={stagger(1)}>
                <Text style={styles.body}>{page.body}</Text>
              </Appear>

              <View style={styles.footer}>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.skipText}>건너뛰기</Text>
                </Pressable>

                {/* 점 인디케이터 — 장이 하나뿐이면 의미가 없어 감춘다. */}
                <View style={styles.dots}>
                  {total > 1
                    ? guide.pages.map((_, i) => (
                        <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
                      ))
                    : null}
                </View>

                <Pressable
                  onPress={next}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.nextText}>{isLast ? (guide.ctaLabel ?? '시작하기') : '다음'}</Text>
                </Pressable>
              </View>
            </View>
          </Appear>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // CoachmarkTour 와 같은 딤 값 — 두 안내가 다른 밝기로 보이지 않게.
    backgroundColor: 'rgba(17,17,17,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    padding: 22,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink, lineHeight: 26 },
  // 본문은 '읽어서 판단하는 문장' = 15sp(복잡도·워딩 표준).
  body: { fontSize: 15, lineHeight: 23, color: InkColors.ink2, marginTop: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 22, gap: 10 },
  skip: { paddingVertical: 8, paddingRight: 4 },
  skipText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: InkColors.line },
  dotOn: { backgroundColor: InkColors.ink },
  nextBtn: {
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: BrandColors.brand,
  },
  nextText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
