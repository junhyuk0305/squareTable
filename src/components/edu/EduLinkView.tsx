/**
 * 교육 링크 본문(P5 링크 화면) — 로그인 없는 웹(/l/[token])과 앱 안(가입한 사람)이 같이 쓴다.
 *
 * 상태 셋(이 단계):
 *  · 닫힌 링크: 안내 한 줄만. 닫힘·만료·없는 주소를 구분해 말하지 않는다(토큰 떠보기 방지 · 서버도 하나로 준다).
 *  · 빈 링크: 묻는 칸 + "아직 담은 노하우가 없어요" 문구.
 *  · 노하우 있음: 묻는 칸 맨 위 → 바로 아래 "먼저 읽어 보세요" → 목록. 목록은 접거나 숨기지 않는다.
 * 묻는 칸은 다음 단계에서 열린다. 지금은 칸 모양만 두고 "곧 열려요"라고 사실대로 말한다(입력은 받지 않는다).
 *
 * ★표시 전용이다. 데이터는 부모가 읽어 넘긴다(앱 안에서 쓸 때 같은 화면을 그대로 쓰려고).
 * ★토큰은 이 부품에 들어오지 않는다. 계측·로그에 실릴 자리 자체를 만들지 않는다.
 * ★노하우 본문은 공용 KnowhowRows 로 그린다(노하우 상세·답변 카드와 같은 모양 · ui.md).
 */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Appear, stagger } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { KnowhowRows, type KnowhowRow } from '@/components/blocks/KnowhowRows';
import type { EduLinkEntry, EduLinkInfo } from '@/lib/db';
import { EDU_WORDS, emptyLinkText } from '@/lib/edu/words';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { EmptyStyles } from '@/lib/theme/empty';
import { Radius } from '@/lib/theme/elevation';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/** 노하우 한 건의 본문 행. 빈 칸은 행을 만들지 않는다(EntryDetailModal 과 같은 규칙). */
function rowsOf(e: EduLinkEntry): KnowhowRow[] {
  const sq = e.square;
  const rows: KnowhowRow[] = [];
  if (!sq) return rows;
  if (sq.description?.trim()) rows.push({ kind: 'summary', text: sq.description });
  if (sq.situation?.trim()) rows.push({ kind: 'situation', text: sq.situation });
  const steps = (sq.action?.steps ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (steps.length > 0) rows.push({ kind: 'todo', items: steps });
  if (sq.extract?.dont?.trim()) rows.push({ kind: 'dont', text: sq.extract.dont });
  return rows;
}

export function EduLinkView({ info, entries }: { info: EduLinkInfo; entries: EduLinkEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!info.ok) {
    return (
      <Appear style={st.fill}>
        <View style={st.center}>
          <Ionicons name="lock-closed-outline" size={26} color={TextColor.iconMuted} />
          <Text style={st.centerText}>{EDU_WORDS.linkClosed}</Text>
        </View>
      </Appear>
    );
  }

  const title = info.title.trim() || EDU_WORDS.link;

  return (
    <View style={st.body}>
      <Appear delay={stagger(0)} style={st.head}>
        {info.placeName ? <Text style={st.kicker} numberOfLines={1}>{info.placeName}</Text> : null}
        <Text style={st.title}>{title}</Text>
      </Appear>

      {/* 묻는 칸 — 다음 단계에서 연다. 지금은 모양만 두고 입력을 받지 않는다. */}
      <Appear delay={stagger(1)} style={st.askWrap}>
        <View style={st.askBox} accessibilityRole="text" accessibilityLabel={`${EDU_WORDS.askPlaceholder}. ${EDU_WORDS.askSoon}`}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={TextColor.iconMuted} />
          <Text style={st.askPlaceholder} numberOfLines={1}>{EDU_WORDS.askPlaceholder}</Text>
        </View>
        <Text style={st.askNote}>{EDU_WORDS.askSoon}</Text>
      </Appear>

      {entries.length === 0 ? (
        <Appear delay={stagger(2)}>
          <View style={EmptyStyles.box}>
            <Text style={EmptyStyles.text}>{emptyLinkText(info.placeKind)}</Text>
          </View>
        </Appear>
      ) : (
        <Appear delay={stagger(2)} style={st.section}>
          <SectionLabel title={EDU_WORDS.firstRead} hint={`${entries.length}개`} />
          <View style={st.list}>
            {entries.map((e, i) => {
              const open = openId === e.id;
              const rows = open ? rowsOf(e) : [];
              return (
                <View key={e.id} style={i > 0 && st.divider}>
                  <Pressable
                    onPress={() => setOpenId(open ? null : e.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={e.title}
                    style={({ pressed }) => [st.row, pressed && st.pressed]}
                  >
                    <Text style={st.rowTitle}>{e.title}</Text>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={TextColor.iconMuted} />
                  </Pressable>
                  {open ? (
                    rows.length > 0 ? (
                      <View style={st.rowBody}>
                        <KnowhowRows rows={rows} />
                      </View>
                    ) : (
                      <Text style={st.rowEmpty}>아직 적힌 내용이 없어요.</Text>
                    )
                  ) : null}
                </View>
              );
            })}
          </View>
        </Appear>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  // Appear 가 flex:1 자식(st.center)을 감쌀 때 높이를 넘겨주는 래퍼.
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, paddingHorizontal: Space.xl },
  centerText: { ...Type.body, fontWeight: '600', color: InkColors.ink2, textAlign: 'center', lineHeight: 23 },

  body: { gap: Gap.group },
  head: { gap: Gap.inline },
  kicker: { ...Type.tag, fontWeight: '800', color: TextColor.secondary },
  title: { ...Type.pageTitle, color: InkColors.ink },

  askWrap: { gap: Space.sm },
  // 회색 바탕 위에 카드 없이 놓인 칸 — 흰 면 + lineStrong(ui.md). 높이는 입력칸과 같은 52.
  askBox: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    minHeight: 52, paddingHorizontal: Space.md,
    borderWidth: 1, borderColor: InkColors.lineStrong, borderRadius: Radius.md, backgroundColor: InkColors.bg,
  },
  askPlaceholder: { ...Type.body, color: TextColor.placeholder, flex: 1, minWidth: 0 },
  askNote: { ...Type.desc, fontWeight: '600' },

  section: { gap: Space.sm },
  list: CardStyles.rows,
  divider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 52, paddingVertical: Space.md },
  pressed: { opacity: 0.6 },
  rowTitle: { ...Type.body, fontWeight: '700', flex: 1, minWidth: 0, lineHeight: 22 },
  rowBody: { paddingBottom: Space.sm },
  rowEmpty: { ...Type.desc, paddingBottom: Space.md },
});
