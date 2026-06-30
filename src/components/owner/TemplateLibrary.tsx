import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { InfoDot } from '@/components/InfoDot';
import {
  KNOWHOW_TEMPLATES,
  templatesForIndustry,
  forkTemplate,
  type PlaybookTemplate,
} from '@/data/knowhowPacks';
import { getCategoryMeta, ALL_CATEGORIES } from '@/lib/utils/category';
import { notifyAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Category } from '@/types';

const RECO_LIMIT = 6; // 검색 전 추천으로 띄울 개수
const TAG_LIMIT = 10; // 빠른검색 칩 개수

// 검색 매칭 — 제목·소분류·키워드·태그·상황 부분일치(대소문자·# 무시).
function matchesQuery(t: PlaybookTemplate, q: string): boolean {
  if (!q) return true;
  if (t.title?.toLowerCase().includes(q)) return true;
  if (t.subcategory?.toLowerCase().includes(q)) return true;
  if ((t.search_keywords ?? []).some((k) => k.toLowerCase().includes(q))) return true;
  if ((t.tags ?? []).some((tag) => tag.replace(/^#/, '').toLowerCase().includes(q))) return true;
  if (t.square?.situation?.toLowerCase().includes(q)) return true;
  return false;
}

/** 펼쳐지는 템플릿 카드 — 닫힘=제목/소분류, 탭하면 아래로 상황·단계·멘트·가져오기가 펼쳐진다. */
function TemplateCard({
  t,
  open,
  onToggle,
  imported,
  onImport,
}: {
  t: PlaybookTemplate;
  open: boolean;
  onToggle: () => void;
  imported: boolean;
  onImport: () => void;
}) {
  const m = getCategoryMeta(t.category);
  const steps = t.square?.action?.steps ?? [];
  const scripts = t.square?.action?.scripts ?? [];
  const dont = t.square?.extract?.dont?.trim();

  return (
    <View style={[styles.card, open && styles.cardOpen]}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.cardHead, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${t.title} ${open ? '접기' : '펼치기'}`}
      >
        <View style={[styles.dot, { backgroundColor: m.color }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle} numberOfLines={open ? undefined : 1}>
            {t.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaCat}>{m.label}</Text>
            {t.subcategory ? <Text style={styles.metaSub}>· {t.subcategory}</Text> : null}
            {imported ? (
              <View style={styles.addedBadge}>
                <Ionicons name="checkmark" size={10} color={InkColors.ink2} />
                <Text style={styles.addedBadgeText}>추가됨</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={InkColors.ink3} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {t.square?.situation ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>상황</Text>
              <Text style={styles.fieldText}>{t.square.situation}</Text>
            </View>
          ) : null}

          {steps.length > 0 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>이렇게 하세요</Text>
              {steps.map((s, i) => (
                <Text key={i} style={styles.stepText}>
                  {s}
                </Text>
              ))}
            </View>
          ) : null}

          {scripts.length > 0 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>이렇게 말하세요</Text>
              {scripts.map((s, i) => (
                <Text key={i} style={styles.scriptText}>
                  “{s.replace(/^"|"$/g, '')}”
                </Text>
              ))}
            </View>
          ) : null}

          {dont ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: BrandColors.warn }]}>이건 하지 마세요</Text>
              <Text style={styles.fieldText}>{dont}</Text>
            </View>
          ) : null}

          {imported ? (
            <View style={[styles.importBtn, styles.importBtnDone]}>
              <Ionicons name="checkmark-circle" size={16} color={InkColors.ink3} />
              <Text style={styles.importBtnDoneText}>이미 내 노하우에 있어요</Text>
            </View>
          ) : (
            <Pressable
              onPress={onImport}
              style={({ pressed }) => [styles.importBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${t.title} 내 노하우로 추가`}
            >
              <Ionicons name="add" size={16} color={InkColors.bubbleText} />
              <Text style={styles.importBtnText}>내 노하우로 추가</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * TemplateLibrary — 업종 표준 노하우 템플릿 둘러보기(검색 우선).
 * 큰 검색창이 주인공: 검색 전엔 빠른검색 칩 + 추천 템플릿, 입력하면 전체에서 즉시 필터된
 * 펼침 카드 리스트. 각 카드는 탭하면 아래로 펼쳐지고 '내 노하우로 추가'로 매장에 fork한다.
 * (크롬리스 본문 — SafeArea/헤더/탭바는 상위 owner/templates 가 소유)
 */
export function TemplateLibrary() {
  const entries = usePlaybookStore((s) => s.entries);
  const add = usePlaybookStore((s) => s.add);
  const unitId = useSessionStore((s) => s.unitId);
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const industry = useSessionStore((s) => s.industry);

  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<Category | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [openId, setOpenId] = useState<string | null>(null); // 한 번에 하나만 펼침(아코디언)

  // 우리 업종 팩 vs 전체 팩. 전체에만 있는 템플릿이 있을 때만 업종 토글을 노출.
  const myTemplates = useMemo(() => templatesForIndustry(industry), [industry]);
  const hasOtherIndustry = KNOWHOW_TEMPLATES.length > myTemplates.length;
  const pool = scope === 'mine' ? myTemplates : KNOWHOW_TEMPLATES;

  // 이미 매장에 있는 노하우 제목(가져오기 중복 방지·'추가됨' 배지). 온보딩 자동등록분 포함.
  const ownedTitles = useMemo(
    () => new Set(entries.map((e) => e.title.trim().toLowerCase())),
    [entries],
  );
  const isImported = (t: PlaybookTemplate) => ownedTitles.has(t.title.trim().toLowerCase());

  // 빠른검색 칩 — 풀에서 자주 나오는 태그 상위 N.
  const topTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const t of pool)
      for (const raw of t.tags ?? []) {
        const tag = raw.replace(/^#/, '');
        if (tag) freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, TAG_LIMIT).map(([t]) => t);
  }, [pool]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0 || activeCat !== null;

  const filtered = useMemo(() => {
    let list = pool.filter((t) => matchesQuery(t, q));
    if (activeCat) list = list.filter((t) => t.category === activeCat);
    return list;
  }, [pool, q, activeCat]);

  const recommended = useMemo(
    () => pool.filter((t) => t.recommended).slice(0, RECO_LIMIT),
    [pool],
  );

  const toggleCard = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  const doImport = async (t: PlaybookTemplate) => {
    if (isImported(t)) return;
    const entry = forkTemplate(t, { unitId, creatorId: userId, creatorName: userName });
    add({ ...entry, source: { kind: 'import', label: '업종 표준 템플릿' } });
    await notifyAction(
      '내 노하우에 추가했어요',
      `“${t.title}”을(를) 가져왔어요.`,
      '확인',
      {
        icon: 'checkmark-circle-outline',
        accent: '아직 미검증 상태예요. 우리 매장 기준이 맞는지 꼭 검토해 주세요.',
      },
    );
  };

  const renderCard = (t: PlaybookTemplate) => (
    <TemplateCard
      key={t.id}
      t={t}
      open={openId === t.id}
      onToggle={() => toggleCard(t.id)}
      imported={isImported(t)}
      onImport={() => doImport(t)}
    />
  );

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* 안내 한 줄 */}
      <View style={styles.lead}>
        <Text style={styles.leadText}>업종에서 자주 쓰는 노하우 예시예요</Text>
        <InfoDot
          title="템플릿이 뭐예요?"
          body={'다른 매장들이 많이 쓰는 상황별 대응 예시예요.\n마음에 드는 걸 가져와서 우리 매장 기준으로 고치면 바로 내 노하우가 돼요.'}
        />
      </View>

      {/* 검색창 — 주인공 */}
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={InkColors.ink3} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="어떤 상황이 궁금하세요? (예: 클레임, 마감)"
          placeholderTextColor={InkColors.ink3}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={InkColors.ink3} />
          </Pressable>
        ) : null}
      </View>

      {/* 업종 범위 토글 — 전체 팩에만 있는 템플릿이 있을 때만 */}
      {hasOtherIndustry ? (
        <View style={styles.scopeRow}>
          <Pressable
            onPress={() => setScope('mine')}
            style={[styles.scopeChip, scope === 'mine' && styles.scopeChipOn]}
          >
            <Text style={[styles.scopeText, scope === 'mine' && styles.scopeTextOn]}>
              우리 업종{industry ? ` · ${industry}` : ''}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setScope('all')}
            style={[styles.scopeChip, scope === 'all' && styles.scopeChipOn]}
          >
            <Text style={[styles.scopeText, scope === 'all' && styles.scopeTextOn]}>전체 업종</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 카테고리 칩(보조 필터) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Pressable onPress={() => setActiveCat(null)} style={[styles.chip, activeCat === null && styles.chipOn]}>
          <Text style={[styles.chipText, activeCat === null && styles.chipTextOn]}>전체</Text>
        </Pressable>
        {ALL_CATEGORIES.map((c) => {
          const on = activeCat === c;
          const m = getCategoryMeta(c);
          return (
            <Pressable key={c} onPress={() => setActiveCat(on ? null : c)} style={[styles.chip, on && styles.chipOn]}>
              <View style={[styles.chipDot, { backgroundColor: m.color }]} />
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 본문 — 검색 전: 빠른검색 + 추천 / 검색 중: 결과 리스트 */}
      {!searching ? (
        <>
          {topTags.length > 0 ? (
            <View style={styles.block}>
              <SectionLabel icon="pricetags-outline" title="빠른 검색" />
              <View style={styles.tagWrap}>
                {topTags.map((tag) => (
                  <Pressable key={tag} onPress={() => setQuery(tag)} style={({ pressed }) => [styles.tag, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.tagText}>#{tag}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {recommended.length > 0 ? (
            <Appear style={styles.block}>
              <SectionLabel icon="star-outline" title="추천 템플릿" hint="많이 쓰는 순" />
              <View style={styles.list}>{recommended.map(renderCard)}</View>
            </Appear>
          ) : null}

          <View style={styles.allHint}>
            <Text style={styles.allHintText}>위에서 검색하거나 카테고리를 누르면 전체 {pool.length}개를 볼 수 있어요</Text>
          </View>
        </>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={styles.emptyText}>조건에 맞는 템플릿이 없어요</Text>
          <Pressable onPress={() => { setQuery(''); setActiveCat(null); }}>
            <Text style={styles.resetLink}>검색 초기화</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.resultCount}>{filtered.length}개</Text>
          <View style={styles.list}>{filtered.map(renderCard)}</View>
        </View>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.md },

  lead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  // 검색창(주인공)
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: InkColors.bg, borderWidth: 1.5, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingHorizontal: 16, paddingVertical: 13, ...Elevation.e1,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, padding: 0 },

  // 업종 범위 토글
  scopeRow: { flexDirection: 'row', gap: Space.xs, backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, padding: 3, alignSelf: 'flex-start' },
  scopeChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.pill },
  scopeChipOn: { backgroundColor: InkColors.ink },
  scopeText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink3 },
  scopeTextOn: { color: InkColors.bubbleText },

  // 카테고리 칩
  chipRow: { flexDirection: 'row', gap: 7, paddingVertical: 1, paddingRight: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipDot: { width: 7, height: 7, borderRadius: Radius.pill },
  chipText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.bubbleText },

  block: { gap: Space.md },

  // 빠른검색 태그
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: BrandColors.yellowSoft, borderWidth: 1, borderColor: BrandColors.gold, borderRadius: Radius.pill, paddingVertical: 7, paddingHorizontal: 13 },
  tagText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  allHint: { paddingVertical: 8, alignItems: 'center' },
  allHintText: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', textAlign: 'center' },

  resultCount: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },

  // 카드(아코디언)
  list: { gap: Space.sm },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, overflow: 'hidden' },
  cardOpen: { borderColor: InkColors.ink2, ...Elevation.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  dot: { width: 10, height: 10, borderRadius: Radius.pill },
  cardTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' },
  metaCat: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  metaSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  addedBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: InkColors.bgSoft, borderRadius: Radius.pill, paddingVertical: 1, paddingHorizontal: 7 },
  addedBadgeText: { fontSize: 10, fontWeight: '800', color: InkColors.ink2 },

  // 펼친 본문 — 아래로 추가
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 12, borderTopWidth: 1, borderTopColor: InkColors.line, paddingTop: 12 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0.2 },
  fieldText: { fontSize: 14, color: InkColors.ink2, lineHeight: 21 },
  stepText: { fontSize: 14, color: InkColors.ink, lineHeight: 22 },
  scriptText: { fontSize: 14, color: InkColors.ink2, lineHeight: 21, fontStyle: 'italic' },

  // 가져오기 버튼
  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    marginTop: 2, paddingVertical: 11, borderRadius: Radius.sm, backgroundColor: InkColors.ink,
  },
  importBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.bubbleText },
  importBtnDone: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  importBtnDoneText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },

  // 빈 결과
  empty: { alignItems: 'center', gap: 6, paddingVertical: 40 },
  emptyEmoji: { fontSize: 34 },
  emptyText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  resetLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, marginTop: 4, textDecorationLine: 'underline' },
});
