import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

type Props = {
  aiGeneralAnswer?: string;
  /** 비슷한 질문 누적 수(있으면 '같은 질문 N명' 메타 노출). */
  similarCount?: number;
  /**
   * 등록 단계 상태.
   *  · asking     : 아직 사장님께 안 보냄 → 등록 여부를 묻는다(기본)
   *  · registered : 알바가 '등록'을 눌러 사장님 인박스로 보냄
   *  · declined   : '괜찮아요'로 접음(다시 등록 가능)
   */
  status: 'asking' | 'registered' | 'declined';
  onRegister: () => void;
  onDecline: () => void;
};

/**
 * 매칭 실패 시 표시되는 카드.
 * 곧장 사장님께 보내지 않고 **등록 여부를 먼저 묻는다**(오타·장난성 질문이 인박스에 그대로 쌓이는 걸 방지).
 * 카테고리는 AI 내부 비계(프레임 v2) — 사용자에게 노출하지 않는다.
 * 사장님 답변이 들어오면 추후 SquareCard로 자동 전환되는 슬롯.
 */
export function DeflectCard({ aiGeneralAnswer, similarCount, status, onRegister, onDecline }: Props) {
  const header =
    status === 'registered'
      ? { icon: '🙋', title: '사장님께 등록했어요', sub: '답이 등록되면 ‘노하우’에서 확인할 수 있어요' }
      : status === 'declined'
        ? { icon: '🙂', title: '등록하지 않았어요', sub: '필요하면 언제든 다시 사장님께 등록할 수 있어요' }
        : { icon: '🙋', title: '사장님께 등록할까요?', sub: '아직 매장에 없는 질문이에요 — 등록하면 사장님이 답을 정해줘요' };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>{header.icon}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>{header.title}</Text>
          <Text style={styles.subtitle}>{header.sub}</Text>
        </View>
      </View>

      {status === 'registered' && typeof similarCount === 'number' && similarCount > 0 ? (
        <View style={styles.row}>
          <View style={styles.similarBadge}>
            <Text style={styles.similarText}>같은 질문 {similarCount + 1}명</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.divider} />

      {/* 등록 여부를 묻는 단계 — 알바가 직접 고른다 */}
      {status === 'asking' && (
        <View style={styles.actions}>
          <Pressable
            onPress={onRegister}
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.85 }]}
          >
            <Text style={[styles.btnText, styles.btnPrimaryText]}>사장님께 등록</Text>
          </Pressable>
          <Pressable
            onPress={onDecline}
            style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.btnText, styles.btnGhostText]}>괜찮아요</Text>
          </Pressable>
        </View>
      )}

      {/* 등록 완료 — 다음 동선 안내 */}
      {status === 'registered' && (
        <View style={styles.notifyRow}>
          <Text style={styles.notifyDot}>✦</Text>
          <Text style={styles.notifyText}>
            사장님이 답을 등록하면 ‘노하우’에서 확인할 수 있어요. 급하면 사장님께 직접 여쭤보세요.
          </Text>
        </View>
      )}

      {/* 접음 — 마음 바뀌면 다시 등록 */}
      {status === 'declined' && (
        <Pressable
          onPress={onRegister}
          style={({ pressed }) => [styles.reRegister, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.reRegisterText}>역시 사장님께 등록할래요</Text>
        </Pressable>
      )}

      {/* 등록을 접지 않은 동안에는 일반 참고 답변을 함께 보여준다 */}
      {status !== 'declined' && aiGeneralAnswer ? (
        <View style={styles.general}>
          <Text style={styles.generalLabel}>일반적으로는…</Text>
          <Text style={styles.generalText}>{aiGeneralAnswer}</Text>
        </View>
      ) : null}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  icon: { fontSize: 26, lineHeight: 30 },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: InkColors.ink,
  },
  subtitle: {
    fontSize: 13,
    color: InkColors.ink3,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  similarBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.yellowSoft,
  },
  similarText: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  divider: {
    height: 1,
    backgroundColor: InkColors.line,
  },
  // 등록 여부 선택 버튼 행
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: Radius.pill,
  },
  btnPrimary: {
    backgroundColor: BrandColors.yellow, // 노랑 = 권장 액션(검정 글자로 대비)
  },
  btnPrimaryText: { color: InkColors.ink },
  btnGhost: {
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  btnGhostText: { color: InkColors.ink2 },
  btnText: { fontSize: 14, fontWeight: '800' },
  reRegister: {
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  reRegisterText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notifyDot: {
    fontSize: 13,
    color: BrandColors.brand,
    fontWeight: '800',
  },
  notifyText: {
    fontSize: 13,
    color: InkColors.ink2,
    fontWeight: '600',
    flex: 1,
  },
  general: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    gap: 4,
  },
  generalLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: InkColors.ink3,
    textTransform: 'uppercase',
  },
  generalText: {
    fontSize: 13,
    color: InkColors.ink2,
    lineHeight: 19,
  },
});
