import { View, Text, Pressable, StyleSheet } from 'react-native';
import { KnowhowRows } from '@/components/blocks/KnowhowRows';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

type Props = {
  /** 존칭 포함 완성 라벨("김영자 사장님"/"박지원 매니저") — 판정은 knowhowSourceLabel SSOT가 담당. */
  creatorName: string;
  title: string;
  version: number;
  updatedAt: string;
  onPress?: () => void;
};

/**
 * 답변 카드 하단 '출처' — 형태는 노하우 본문과 같은 `KnowhowRows`(D10) 행이다.
 *
 * ★2026-08-08 통일. 그 전에는 이 자리만 **골드-크림 라운드 박스**였다. 같은 카드 안에서
 *   본문(좌측 라벨 열)과 출처(색 면 박스)가 서로 다른 형태라, 한 문서로 안 읽혔다.
 *   노하우 원문 시트의 출처도 같은 날 같은 행 형태로 갔다 — 네 화면이 이제 한 어휘를 쓴다.
 * ★내용은 그대로다(누가·무엇을·언제 갱신·원문 보기). 바꾼 것은 담는 그릇뿐이다.
 */
export function SourceFooter({ creatorName, title, version, updatedAt, onPress }: Props) {
  const inner = (
    <KnowhowRows
      rows={[{
        kind: 'source',
        // 값 칸은 3줄 구성이라 render 로 직접 그린다(KnowhowRows 는 text+sub 2줄까지만 안다).
        render: (
          <View style={styles.value}>
            <Text style={styles.creator}>{creatorName} 가이드</Text>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>v{version} · {updatedAt} 갱신</Text>
              {onPress ? <Text style={styles.openHint}>원문 보기 ›</Text> : null}
            </View>
          </View>
        ),
      }]}
    />
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title} 원문 보기`}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  value: { gap: Space.xs },
  creator: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  title: { fontSize: 15, color: InkColors.ink2, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  meta: { fontSize: 12.5, color: InkColors.ink3 },
  // ★골드(#F0D000)를 글자색으로 쓰지 않는다 — 크림 면이 사라진 흰 배경에서는 대비가 1.6 수준이다.
  //   색 규칙("color: 에 500을 쓰지 않는다")대로 중립 800으로 내린다.
  openHint: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
});
