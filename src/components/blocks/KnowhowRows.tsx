import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * D10 · 노하우 행 — **좌측 라벨 열 + 점**. 노하우 본문을 그리는 자리는 전부 이것 하나다.
 *
 * 2026-08-08 통일. 그 전에는 같은 내용이 화면마다 다른 형태였다:
 *   · 노하우 추가 카드 = 라운드 박스 + 왼쪽 4px 컬러바 ×3
 *   · 노하우 상세      = 줄무늬 표(KvTable)
 *   · 노하우 원문 시트 = 좌측 컬러바(라운드 없음)
 *   · 직원 답변 카드   = 좌측 컬러바
 * 만들 때와 읽을 때가 다르게 보이면 사장은 같은 것이라고 못 읽는다 → 형태를 1종으로 모았다.
 *
 * ★ 점 색은 **블록 종류**다(상황·할 일·멘트·금지·출처). 옛 카드가 쓰던 **카테고리 색**이 아니다 —
 *   카테고리는 2026-07-31 단일화에서 라벨을 전면 비노출로 정했는데 색만 남아 뜻 없는 색이 돼 있었다.
 * ★ **할 일에 번호를 붙이지 않는다.** `action.steps` 는 그냥 문자열 배열이라 순서 보장이 없고
 *   (AI 서빙 경로도 `' / '` 로 이어붙여 순서를 버린다), 번호는 보장 못 하는 순서를 주장하는 표시였다.
 *   순서가 진짜 중요한 노하우는 사장이 문장에 쓴다("예열 끝나고 …").
 * ★ 표시 전용 — 판정·데이터 접근을 넣지 않는다. 편집 입력창은 호출부가 `render` 로 꽂는다.
 */

export type KnowhowRowKind = 'situation' | 'todo' | 'script' | 'dont' | 'source';

export type KnowhowRow = {
  kind: KnowhowRowKind;
  /** 라벨을 덮어쓸 때만. 기본값은 종류별 표준 라벨. */
  label?: string;
  /** 한 덩어리 텍스트 — 상황·금지·출처. */
  text?: string;
  /** 여러 줄 — 할 일·멘트. 불릿으로 그린다(번호 없음). */
  items?: string[];
  /** 꼬리 메타(출처의 `v1 · 2026-07-31 갱신` 등) — 본문보다 작게. */
  sub?: string;
  /** 값 칸을 통째로 대신 그린다(편집 입력창 주입). 있으면 text·items 를 안 그린다. */
  render?: ReactNode;
};

const LABEL: Record<KnowhowRowKind, string> = {
  situation: '상황',
  todo: '할 일',
  script: '멘트',
  dont: '금지',
  source: '출처',
};

/** 점 = 500 역할(점·인디케이터). 글자에는 쓰지 않는다. */
const TONE: Record<KnowhowRowKind, string> = {
  situation: InkColors.ink,
  todo: BrandColors.good,
  script: BrandColors.mention,
  dont: BrandColors.bad,
  source: BrandColors.gold,
};

/** 라벨 열 폭 — '할 일' 두 글자가 안 접히는 최소치. 도형 자체 치수라 간격 토큰 대상이 아니다. */
const LABEL_COL_W = 58;
/** 점 지름. 같은 이유로 토큰 대상 아님. */
const DOT = 8;

export function KnowhowRows({ rows }: { rows: KnowhowRow[] }) {
  if (rows.length === 0) return null;

  return (
    <View>
      {rows.map((r, i) => (
        <View key={`${r.kind}-${i}`} style={[styles.row, i > 0 && styles.rowDivider]}>
          <View style={styles.label}>
            <View style={[styles.dot, { backgroundColor: TONE[r.kind] }]} />
            <Text style={styles.labelText}>{r.label ?? LABEL[r.kind]}</Text>
          </View>
          <View style={styles.value}>
            {r.render ?? <RowValue row={r} />}
            {r.sub ? <Text style={styles.sub}>{r.sub}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 값 한 칸 — 여러 줄(items)은 불릿, 한 덩어리(text)는 문단. 멘트는 그대로 읽어서 말하는 문장이라 겹따옴표+기울임. */
function RowValue({ row }: { row: KnowhowRow }) {
  if (row.items && row.items.length > 0) {
    return (
      <View>
        {row.items.map((it, i) => (
          <View key={i} style={[styles.bullet, i > 0 && styles.bulletGap]}>
            <View style={[styles.bulletDot, { backgroundColor: TONE[row.kind] }]} />
            <Text style={[styles.text, row.kind === 'script' && styles.script]}>
              {row.kind === 'script' ? `“${it}”` : it}
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (!row.text) return null;
  return <Text style={[styles.text, row.kind === 'script' && styles.script]}>{row.text}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start', paddingVertical: Space.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },

  label: { width: LABEL_COL_W, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingTop: 2 },
  dot: { width: DOT, height: DOT, borderRadius: Radius.pill },
  // 위치 꼬리표라 본문 15sp 하한 대상이 아니다(simplicity-voice §4 '보조').
  labelText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3 },

  value: { flex: 1, minWidth: 0 },
  text: { fontSize: 15, lineHeight: 22, color: InkColors.ink },
  script: { fontStyle: 'italic' },
  sub: { fontSize: 12.5, color: InkColors.ink3, marginTop: Space.xs },

  bullet: { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start' },
  bulletGap: { marginTop: Space.sm },
  // 불릿 점은 첫 줄 글자 가운데에 맞춘다(15sp · lineHeight 22 → 약 8.5).
  bulletDot: { width: 5, height: 5, borderRadius: Radius.pill, marginTop: 8.5 },
});
