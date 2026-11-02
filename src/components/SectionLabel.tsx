import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { InkColors, TextColor } from '@/lib/theme/colors';
import { Type } from '@/lib/theme/type';
import { Space } from '@/lib/theme/layout';

/**
 * 섹션 라벨 — 제목은 카드 '밖'(위)에, 내용은 카드 '안'에 두는 공용 IA.
 * (알바몬·캐시노트식: 카드 안은 내용만 남겨 스캔이 빨라진다)
 *
 * - icon: 좌측 아이콘(선택)
 * - title: 섹션 제목
 * - hint: 우측 보조문구(선택)
 * - trailing: 우측 카운트/뱃지 등 노드(선택)  ※ hint와 trailing은 보통 둘 중 하나만 쓴다
 * - titleAccessory: 제목 바로 옆 노드(선택). 제목을 설명하는 ⓘ 처럼 제목에 붙어야 뜻이 서는 것(2026-11-02).
 * - flush: 위 여백을 들지 않는다. 섹션 사이를 화면 틀(`<Screen>`·`<SectionStack>`·`<Section>`)이 정하는 자리에서 켠다.
 */
export function SectionLabel({
  icon,
  title,
  hint,
  trailing,
  titleAccessory,
  flush = false,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  trailing?: React.ReactNode;
  titleAccessory?: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <View style={[styles.row, !flush && styles.rowTop]}>
      {icon ? <Ionicons name={icon} size={15} color={InkColors.ink2} /> : null}
      <Text style={styles.title}>{title}</Text>
      {titleAccessory}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 제목↔카드는 10 으로 통일한다(2026-10-14 사용자 결정). `<Section>` 의 gap sm(8) + 여기 아래 2.
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginBottom: 2 },
  // 옛 화면용 위 여백 12 — 부모 gap 과 더해져 섹션 사이가 된다(화면마다 달랐던 원인).
  //   새 화면 틀은 섹션 사이를 `Layout.sectionGap`(20) 으로 정하므로 flush 로 끈다.
  //   ★2026-11-02 기본값에서 지웠다가 되살렸다: 아직 틀로 안 옮긴 하위 화면 38파일의 간격이 20→8 로 줄었다(사용자 결정 = 2차 이관 때 같이 맞춘다).
  rowTop: { marginTop: Space.md },
  // 섹션 제목 = Type.section(16/800). 줄높이는 옛 15/21 비율(1.4)을 지켜 22.
  title: { ...Type.section, lineHeight: 22, letterSpacing: -0.2 },
  // 오른쪽 보조문구도 읽는 글자라 secondary(2026-11-02 결정표 '읽는 회색 글자').
  hint: { marginLeft: 'auto', fontSize: 12, color: TextColor.secondary, fontWeight: '600' },
  trailing: { marginLeft: 'auto' },
});
