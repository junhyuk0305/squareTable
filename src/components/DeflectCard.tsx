import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Type } from '@/lib/theme/type';
import { Layout, Gap, Space } from '@/lib/theme/layout';
import { STORE_WORDS } from '@/lib/place/words';

type Props = {
  aiGeneralAnswer?: string;
  /** 비슷한 질문 누적 수(있으면 '같은 질문 N명' 메타 노출). */
  similarCount?: number;
  /**
   * 등록 단계 상태.
   *  · asking     : 아직 사장님께 안 보냄 → 등록 여부를 묻는다(기본)
   *  · registered : 알바가 '등록'을 눌러 사장님 인박스로 보냄
   *  · declined   : '괜찮아요'로 접음(다시 등록 가능)
   *  · answered   : 보낸 질문에 답이 왔다(질문이 노하우로 해결됨 · 6번 덩이). [답 보기]로 그 노하우를 연다.
   */
  status: 'asking' | 'registered' | 'declined' | 'answered';
  onRegister: () => void;
  onDecline: () => void;
  /** answered 일 때 [답 보기]. 없으면 버튼을 그리지 않는다(노하우를 못 찾음 · 지워짐). */
  onOpenAnswer?: () => void;
};

/**
 * 매칭 실패 시 표시되는 카드.
 * 곧장 사장님께 보내지 않고 **등록 여부를 먼저 묻는다**(오타·장난성 질문이 인박스에 그대로 쌓이는 걸 방지).
 * 카테고리는 AI 내부 비계(프레임 v2) — 사용자에게 노출하지 않는다.
 * 사장님 답변이 들어오면 추후 SquareCard로 자동 전환되는 슬롯.
 */
export function DeflectCard({ aiGeneralAnswer, similarCount, status, onRegister, onDecline, onOpenAnswer }: Props) {
  // ★6번 덩이: 보낸 뒤 = 단어 사전 notFoundAsk 매장 칸 한 문장(제목 없음). 옛 제목·안내 두 줄은 서로 다른 곳
  //   ('내 공간' · '노하우')을 가리켰다. 답이 오면 answered 로 바뀐다(옛: 승인 뒤에도 "보냈어요"로 남았다).
  const header: { icon: keyof typeof Ionicons.glyphMap; title?: string; sub: string } =
    status === 'answered'
      ? { icon: 'checkmark-circle-outline', title: STORE_WORDS.answeredBy, sub: '보낸 질문이 우리 매장 노하우가 됐어요.' }
      : status === 'registered'
        ? { icon: 'paper-plane-outline', sub: STORE_WORDS.notFoundAsk }
        : status === 'declined'
          ? { icon: 'close-circle-outline', title: '보내지 않았어요', sub: '필요하면 언제든 다시 사장님께 보낼 수 있어요' }
          : { icon: 'help-circle-outline', title: '사장님께 보낼까요?', sub: '아직 매장에 없는 질문이에요. 보내면 사장님이 답을 정해줘요' };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name={header.icon} size={Space.xl} color={InkColors.ink} />
        <View style={{ flex: 1, gap: 2 }}>
          {header.title ? <Text style={styles.title}>{header.title}</Text> : null}
          <Text style={header.title ? styles.subtitle : styles.sentText}>{header.sub}</Text>
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
            <Text style={[styles.btnText, styles.btnPrimaryText]}>질문 보내기</Text>
          </Pressable>
          <Pressable
            onPress={onDecline}
            style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.btnText, styles.btnGhostText]}>괜찮아요</Text>
          </Pressable>
        </View>
      )}

      {/* 답이 왔다 — 그 노하우를 바로 연다(6번 덩이). 등록 완료 안내 줄은 위 한 문장과 같은 뜻이라 뺐다. */}
      {status === 'answered' && onOpenAnswer && (
        <Pressable
          onPress={onOpenAnswer}
          accessibilityRole="button"
          accessibilityLabel={STORE_WORDS.answerOpen}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, styles.btnSolo, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.btnText, styles.btnPrimaryText]}>{STORE_WORDS.answerOpen}</Text>
        </Pressable>
      )}

      {/* 접음 — 마음 바뀌면 다시 등록 */}
      {status === 'declined' && (
        <Pressable
          onPress={onRegister}
          style={({ pressed }) => [styles.reRegister, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.reRegisterText}>역시 사장님께 보낼래요</Text>
        </Pressable>
      )}

      {/* 등록을 접지 않은 동안에는 일반 참고 답변을 함께 보여준다(답이 온 뒤에는 매장 답이 있어 뺀다) */}
      {status !== 'declined' && status !== 'answered' && aiGeneralAnswer ? (
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
    padding: Layout.cardPad,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    gap: Gap.item,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
  },
  title: Type.section,
  // 보낸 뒤 한 문장(제목 없이 이 문장이 카드의 주인이다) — 본문 크기.
  sentText: { ...Type.body, fontWeight: '600' },
  subtitle: {
    ...Type.desc,
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
  similarText: { ...Type.micro, fontWeight: '800', color: InkColors.ink2 },
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
  // 작은 버튼(44 알약) 두 개를 반씩 나눠 쓴다 — 폭만 flex 로 바꾼다.
  btn: {
    ...ButtonStyles.small,
    flex: 1,
  },
  // 답 보기 한 개 — 반쪽이 아니라 왼쪽에 제 폭으로.
  btnSolo: { flex: 0, alignSelf: 'flex-start', paddingHorizontal: Space.lg },
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
  btnText: { ...ButtonTextStyles.small },
  reRegister: {
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
  },
  reRegisterText: { ...Type.tag, fontWeight: '700', color: InkColors.ink2 },
  general: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: InkColors.line,
    gap: 4,
  },
  generalLabel: {
    ...Type.micro,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: TextColor.secondary,
    textTransform: 'uppercase',
  },
  generalText: {
    ...Type.desc,
  },
});
