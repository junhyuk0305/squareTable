import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { ScreenLoading } from '@/components/ScreenLoading';
import { SectionLabel } from '@/components/SectionLabel';
import { PressableScale } from '@/components/PressableScale';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { sectionOptions } from '@/lib/config/sections';
import { getSectionMeta } from '@/lib/utils/category';
import { fetchStoreParts, createStorePart, type StorePart } from '@/lib/db';
import {
  findSimilarEntry,
  findSimilarSection,
  dedupeQuery,
  SAME_SCORE_MIN,
} from '@/lib/utils/knowhowSimilarity';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

/**
 * 저장 전 확인 시트 — 노하우가 창고에 들어가기 직전의 유일한 문지기.
 *
 * 두 가지를 한 번에 처리한다(시트를 두 번 띄우지 않기 위해 합쳤다):
 *  ① 겹침 확인: 이미 비슷한 노하우가 있으면 "그걸 수정" 경로를 먼저 제시한다.
 *     (막지는 않는다 — 사장이 "그래도 새로"를 고르면 그대로 저장. 판정은 렉시컬이라 오검출이 있다.)
 *  ② 카테고리(section) 배정: 표준 세트에서 고르게 해 '기타' 몰림과 표기 난립(응대/진상응대/클레임)을 막는다.
 *     사용자 표면의 분류는 이것 하나다(종류 4종은 AI 내부용 — 2026-07-31 단일화).
 *  ③ 파트(홀·주방 같은 담당) 배정(0164): 카테고리와 **다른 축**이다 — 카테고리는 "무엇에 관한 것인가",
 *     파트는 "누구 담당인가". 표준 세트를 줄 수 없어(업종마다 다르다) 매장이 쓴 값이 곧 후보고,
 *     쓰기 시작할 때 지연 생성된다. 안 고르면 공통이다.
 *
 * 판정 규칙은 여기서 만들지 않고 knowhowSimilarity(SSOT)를 부른다 — 카테고리도 파트도 같은 함수다.
 */
export function PublishConfirmSheet({
  visible,
  entries,
  onCancel,
  onConfirm,
  onEditExisting,
  partsEnabled = true,
}: {
  visible: boolean;
  /** 저장하려는 노하우(단건 발행=1개, 분리 발행=N개). */
  entries: PlaybookEntry[];
  onCancel: () => void;
  /** 사장이 고른 카테고리·파트로 저장 진행. section null=미분류(기타), partId null=공통. */
  onConfirm: (section: string | null, partId: string | null) => void;
  /** "기존 것 수정하기" — 겹치는 기존 노하우 수정 화면으로. */
  onEditExisting: (entryId: string) => void;
  /**
   * 파트 행을 보여줄지. **다른 매장에 저장하는 경로(0121)에서는 false** —
   * 여기 파트 목록은 지금 보고 있는 매장 것이라, 그대로 붙이면 0164 §3 크로스테넌트 트리거가
   * 저장을 통째로 막는다. 고를 수 없는 것을 보여주지 않는 편이 맞다.
   */
  partsEnabled?: boolean;
}) {
  const allEntries = usePlaybookStore((s) => s.entries);
  const industry = useSessionStore((s) => s.industry);

  const [section, setSection] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  // 직접 추가한 이름이 기존 챕터와 겹칠 때, 사장이 "그래도 만들기"를 누르기 전까지 붙잡는다.
  const [dupSection, setDupSection] = useState<string | null>(null);

  const published = useMemo(() => allEntries.filter((e) => e.status === 'published'), [allEntries]);

  // 저장하려는 것 각각에 대해 "이미 있는 비슷한 노하우". 자기 자신은 제외(수정 재저장 대비).
  const overlaps = useMemo(() => {
    if (!visible) return [];
    return entries
      .map((e) => ({ draft: e, hit: findSimilarEntry(dedupeQuery(e), published, SAME_SCORE_MIN, e.id) }))
      .filter((r): r is { draft: PlaybookEntry; hit: NonNullable<ReturnType<typeof findSimilarEntry>> } => !!r.hit);
  }, [visible, entries, published]);

  // 선택지 = 표준 + 사용 중 + 매장이 만든 카테고리(0개짜리 포함 — 카테고리 편집에서 추가한 것).
  const customs = usePlaybookStore((s) => s.customCategories);
  const options = useMemo(
    () => sectionOptions(industry, [...published.map((e) => e.section), ...customs.map((c) => c.label)]),
    [industry, published, customs],
  );

  const pickNew = () => {
    const name = newName.trim();
    if (!name) return;
    const twin = findSimilarSection(name, options);
    if (twin && twin !== dupSection) { setDupSection(twin); return; } // 1회 되묻고, 재확인이면 통과
    setSection(name);
    setAdding(false);
    setNewName('');
    setDupSection(null);
  };

  // ── 파트(0164) — 카테고리와 같은 되묻기 패턴을 그대로 쓴다 ──────────────────
  // 다른 점은 저장 시점뿐이다: 카테고리는 문자열이라 노하우와 같이 저장되지만,
  // 파트는 표라서 **고른 그 자리에서** 행이 만들어진다(id 를 노하우에 붙여야 하므로).
  const [parts, setParts] = useState<StorePart[]>([]);
  const [partId, setPartId] = useState<string | null>(null);
  const [partAdding, setPartAdding] = useState(false);
  const [partName, setPartName] = useState('');
  const [dupPart, setDupPart] = useState<string | null>(null);
  const [partBusy, setPartBusy] = useState(false);
  const [partFailed, setPartFailed] = useState(false);
  // 파트 칩이 시트가 열린 뒤 늦게 채워지는 것을 막는 게이트. 실패해도 true 로 확정한다(영영 로딩 금지).
  const [partsLoaded, setPartsLoaded] = useState(false);

  useEffect(() => {
    if (!visible || !partsEnabled) return;
    let alive = true;
    void fetchStoreParts().then((rows) => {
      if (!alive) return;
      setParts(rows);
      setPartsLoaded(true);
    });
    return () => { alive = false; };
  }, [visible, partsEnabled]);

  const partNames = useMemo(() => parts.map((p) => p.name), [parts]);

  const pickNewPart = async () => {
    const name = partName.trim();
    if (!name || partBusy) return;
    const twin = findSimilarSection(name, partNames);
    if (twin && twin !== dupPart) { setDupPart(twin); return; } // 1회 되묻고, 재확인이면 통과
    setPartBusy(true);
    const made = await createStorePart(name); // 서버 unique 충돌이면 기존 파트가 그대로 돌아온다
    setPartBusy(false);
    if (!made) { setPartFailed(true); return; }
    setParts((v) => (v.some((p) => p.id === made.id) ? v : [...v, made]));
    setPartId(made.id);
    setPartAdding(false);
    setPartName('');
    setDupPart(null);
    setPartFailed(false);
  };

  const single = entries.length === 1;

  return (
    <BottomSheet visible={visible} onClose={onCancel} sheetStyle={styles.sheet}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{single ? '저장 전 확인' : `노하우 ${entries.length}개 저장`}</Text>

        {overlaps.length > 0 && (
          <View style={styles.warnCard}>
            <View style={styles.warnHead}>
              <Ionicons name="copy-outline" size={16} color={BrandColors.warn} />
              <Text style={styles.warnTitle}>
                {single ? '비슷한 노하우가 이미 있어요' : `${overlaps.length}개가 기존 노하우와 비슷해요`}
              </Text>
            </View>
            {overlaps.map(({ draft, hit }) => (
              <View key={draft.id} style={styles.warnRow}>
                <Text style={styles.warnExisting} numberOfLines={2}>{hit.entry.title}</Text>
                <PressableScale
                  onPress={() => onEditExisting(hit.entry.id)}
                  style={styles.warnCta}
                  accessibilityRole="button"
                  accessibilityLabel={`${hit.entry.title} 수정하기`}
                >
                  <Text style={styles.warnCtaText}>이걸 수정</Text>
                </PressableScale>
              </View>
            ))}
            <Text style={styles.warnHint}>
              같은 내용이면 새로 만들지 말고 기존 것을 고치는 편이 좋아요. 다른 내용이면 그대로 저장하세요.
            </Text>
          </View>
        )}

        <SectionLabel title="카테고리" hint="매뉴얼에서 묶이는 단위예요" />
        <View style={styles.chips}>
          {options.map((name) => {
            const on = section === name;
            const m = getSectionMeta(name);
            return (
              <PressableScale
                key={name}
                onPress={() => setSection(on ? null : name)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`카테고리 ${name}`}
              >
                <View style={[styles.chipDot, { backgroundColor: m.color }]} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
              </PressableScale>
            );
          })}
          {section && !options.includes(section) && (
            <View style={[styles.chip, styles.chipOn]}>
              <View style={[styles.chipDot, { backgroundColor: getSectionMeta(section).color }]} />
              <Text style={[styles.chipText, styles.chipTextOn]}>{section}</Text>
            </View>
          )}
          {!adding && (
            <PressableScale
              onPress={() => setAdding(true)}
              style={styles.chipAdd}
              accessibilityRole="button"
              accessibilityLabel="카테고리 직접 추가"
            >
              <Ionicons name="add" size={14} color={InkColors.ink3} />
              <Text style={styles.chipAddText}>직접 추가</Text>
            </PressableScale>
          )}
        </View>

        {adding && (
          <View style={styles.addBox}>
            <TextInput
              value={newName}
              onChangeText={(t) => { setNewName(t); setDupSection(null); }}
              placeholder="새 카테고리 이름 (예: 배달앱)"
              placeholderTextColor={InkColors.ink3}
              style={styles.addInput}
              onSubmitEditing={pickNew}
              returnKeyType="done"
              accessibilityLabel="새 카테고리 이름"
            />
            {dupSection && (
              <Text style={styles.addWarn}>
                이미 «{dupSection}» 카테고리가 있어요. 같은 뜻이면 그쪽에 넣어 주세요 — 한 번 더 누르면 새로 만들어요.
              </Text>
            )}
            <View style={styles.addRow}>
              {dupSection && (
                <PressableScale
                  onPress={() => { setSection(dupSection); setAdding(false); setNewName(''); setDupSection(null); }}
                  style={styles.addUse}
                  accessibilityRole="button"
                  accessibilityLabel={`${dupSection}에 넣기`}
                >
                  <Text style={styles.addUseText}>«{dupSection}»에 넣기</Text>
                </PressableScale>
              )}
              <PressableScale
                onPress={pickNew}
                style={styles.addOk}
                accessibilityRole="button"
                accessibilityLabel="카테고리 만들기"
              >
                <Text style={styles.addOkText}>{dupSection ? '그래도 만들기' : '추가'}</Text>
              </PressableScale>
            </View>
          </View>
        )}

        {/* 파트 블록만 게이트한다 — 카테고리 칩은 로컬 상수라 기다릴 것이 없다. */}
        {partsEnabled && !partsLoaded && <ScreenLoading label="파트를 불러오고 있어요…" />}
        {partsEnabled && partsLoaded && (
          <>
            <SectionLabel title="파트" hint="안 고르면 전원이 보는 공통이에요" />
            <View style={styles.chips}>
              {parts.map((p) => {
                const on = partId === p.id;
                return (
                  <PressableScale
                    key={p.id}
                    onPress={() => setPartId(on ? null : p.id)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`파트 ${p.name}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.name}</Text>
                  </PressableScale>
                );
              })}
              {!partAdding && (
                <PressableScale
                  onPress={() => setPartAdding(true)}
                  style={styles.chipAdd}
                  accessibilityRole="button"
                  accessibilityLabel="파트 직접 추가"
                >
                  <Ionicons name="add" size={14} color={InkColors.ink3} />
                  <Text style={styles.chipAddText}>직접 추가</Text>
                </PressableScale>
              )}
            </View>

            {partAdding && (
              <View style={styles.addBox}>
                <TextInput
                  value={partName}
                  onChangeText={(t) => { setPartName(t); setDupPart(null); setPartFailed(false); }}
                  placeholder="새 파트 이름 (예: 홀)"
                  placeholderTextColor={InkColors.ink3}
                  style={styles.addInput}
                  onSubmitEditing={() => void pickNewPart()}
                  returnKeyType="done"
                  accessibilityLabel="새 파트 이름"
                />
                {dupPart && (
                  <Text style={styles.addWarn}>
                    이미 «{dupPart}» 파트가 있어요. 같은 뜻이면 그쪽에 넣어 주세요 — 한 번 더 누르면 새로 만들어요.
                  </Text>
                )}
                {partFailed && (
                  <Text style={styles.addWarn}>파트를 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요.</Text>
                )}
                <View style={styles.addRow}>
                  {dupPart && (
                    <PressableScale
                      onPress={() => {
                        const hit = parts.find((p) => p.name === dupPart);
                        if (hit) setPartId(hit.id);
                        setPartAdding(false); setPartName(''); setDupPart(null); setPartFailed(false);
                      }}
                      style={styles.addUse}
                      accessibilityRole="button"
                      accessibilityLabel={`${dupPart}에 넣기`}
                    >
                      <Text style={styles.addUseText}>«{dupPart}»에 넣기</Text>
                    </PressableScale>
                  )}
                  <PressableScale
                    onPress={() => void pickNewPart()}
                    style={styles.addOk}
                    accessibilityRole="button"
                    accessibilityLabel="파트 만들기"
                  >
                    <Text style={styles.addOkText}>{dupPart ? '그래도 만들기' : '추가'}</Text>
                  </PressableScale>
                </View>
              </View>
            )}
          </>
        )}

        {/* 딤 탭만으로는 "저장 안 함"이 안 보인다 → 취소를 명시(ShiftEditorModal과 같은 푸터 패턴).
            여기만 PressableScale이 아니라 Pressable인 이유: PressableScale은 style을 안쪽
            Animated.View에 넘겨서 바깥 Pressable이 내용 크기로 잡힌다 → flex가 먹지 않는다. */}
        <View style={styles.foot}>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [styles.footBtn, styles.cancel, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="저장 취소"
          >
            <Text style={styles.cancelText}>취소</Text>
          </Pressable>
          <Pressable
            onPress={() => onConfirm(section, partId)}
            style={({ pressed }) => [styles.footBtn, styles.save, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="노하우 저장"
          >
            <Text style={styles.saveText} numberOfLines={1}>
              {section ? `«${section}»에 저장` : '카테고리 없이 저장'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '85%' },
  body: { paddingHorizontal: Space.gutter, paddingTop: Space.sm, paddingBottom: Space.xl, gap: Space.md },
  title: { fontSize: 17, fontWeight: '800', color: InkColors.ink },

  warnCard: { backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.md, gap: Space.sm },
  warnHead: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  warnTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  warnExisting: { flex: 1, fontSize: 15, color: InkColors.ink2 },
  warnCta: { paddingVertical: 6, paddingHorizontal: Space.md, borderRadius: Radius.pill, backgroundColor: InkColors.ink },
  warnCtaText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  warnHint: { fontSize: 12, color: InkColors.ink3, lineHeight: 17 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Space.sm, paddingHorizontal: Space.md, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },
  chipDot: { width: 7, height: 7, borderRadius: Radius.pill },
  chipOn: { backgroundColor: BrandColors.yellow },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: InkColors.ink },
  chipAdd: {
    flexDirection: 'row', alignItems: 'center', gap: Space.xs,
    paddingVertical: Space.sm, paddingHorizontal: Space.md,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line,
  },
  chipAddText: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },

  addBox: { gap: Space.sm },
  addInput: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: Space.md, paddingVertical: Space.md, fontSize: 14, color: InkColors.ink,
  },
  addWarn: { fontSize: 12, color: BrandColors.warnText, lineHeight: 17 },
  addRow: { flexDirection: 'row', gap: Space.sm },
  addUse: { flex: 1, paddingVertical: Space.md, borderRadius: Radius.sm, backgroundColor: BrandColors.yellow, alignItems: 'center' },
  addUseText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },
  addOk: { flex: 1, paddingVertical: Space.md, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft, alignItems: 'center' },
  addOkText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  foot: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  footBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: Space.lg, borderRadius: Radius.md },
  // 취소는 고정폭(내용만큼), 저장이 남은 폭을 먹는다 — 저장 문구가 챕터명에 따라 길어지기 때문.
  cancel: { paddingHorizontal: Space.xl, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  cancelText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  save: { flex: 1, backgroundColor: InkColors.ink },
  saveText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
