// /hq/knowhow/[id] — 본사 노하우 편집기(정본 §5-2): 2단. 왼쪽 입력(붙여넣기 → AI 구조화) / 오른쪽 카드 편집·발행.
// id === 'new' 면 새로 쓰기.
//
// ★로직은 **매장 앱 lib 그대로**다(정본 §5-2 마지막 줄 · §6-3 "서버 기능 신규 0"):
//   구조화 = `structureSquare`(AI 엣지) · 조립 = `buildPlaybookEntryFromSquare` · 저장 = `db.ts` · 색인 = `embedEntry`.
//   이 화면이 하는 일은 **작업실 unit 으로 부르는 것**뿐이다. 새 서버 경로를 만들지 않는다.
//
// ★왜 unit_id 를 명시로 넘기나: `buildPlaybookEntryFromSquare` 는 세션의 `unitId` 를 쓴다. 담당자의
//   활성 매장은 서버에서 작업실로 바뀌었지만(0215) **클라 세션은 그 전에 hydrate 됐을 수 있다** —
//   그대로 두면 노하우가 담당자의 옛 매장 id 로 조립돼 RLS 가 거부하거나(42501) 엉뚱한 매장에 들어간다.
//   그래서 스토어가 들고 있는 `wsUnitId` 로 덮어쓴다(무음 오배치 금지).
//
// PDF 올리기·템플릿은 다음 단계다(지시서 §3-2 "최소 흐름부터").
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { HqPage, HqButton, HqCard, HqNotice, HqRow, HqSegment, HqPill } from '@/components/hq/HqKit';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { structureSquare, embedEntry } from '@/lib/ai';
import { getCategoryGuide } from '@/lib/ai/categoryGuide';
import { CATEGORY_LABELS } from '@/lib/ai/embedText';
import { buildDirectUq, buildPlaybookEntryFromSquare, isSquarePublishable } from '@/lib/utils/buildEntry';
import { insertEntry, updateEntry } from '@/lib/db';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock, Category } from '@/types';

const CATS = (Object.keys(CATEGORY_LABELS) as Category[]).map((k) => ({ key: k, label: CATEGORY_LABELS[k] }));

/** 카드 편집이 다루는 칸 — SQUARE 6칸 중 사람이 실제로 손보는 것들(정본 노하우 카드와 같은 순서). */
type Draft = {
  title: string;
  category: Category;
  situation: string;
  steps: string[];
  dont: string;
  section: string;
};

const draftOf = (e: PlaybookEntry): Draft => ({
  title: e.title,
  category: (e.category as Category) ?? 'Routine',
  situation: e.square?.situation ?? '',
  steps: e.square?.action?.steps ?? [],
  dont: e.square?.extract?.dont ?? '',
  section: e.section ?? '',
});

const squareOf = (base: SquareBlock | undefined, d: Draft): SquareBlock => ({
  ...(base ?? { situation: '', quagmire: '', uncover: '', action: { steps: [] }, result: { before: '', after: '', metric: '' }, extract: { do: '', dont: '' } }),
  situation: d.situation,
  action: { ...(base?.action ?? {}), steps: d.steps.filter((s) => s.trim()) },
  extract: { ...(base?.extract ?? { do: '', dont: '' }), dont: d.dont },
});

export default function HqKnowhowEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const wsUnitId = useBrandKnowhowStore((s) => s.wsUnitId);
  const entries = useBrandKnowhowStore((s) => s.entries);
  const loaded = useBrandKnowhowStore((s) => s.loaded);
  const storeError = useBrandKnowhowStore((s) => s.error);
  const hydrate = useBrandKnowhowStore((s) => s.hydrate);
  const refresh = useBrandKnowhowStore((s) => s.refresh);
  useFocusEffect(useCallback(() => { void hydrate(); }, [hydrate]));

  const deployed = useBrandKnowhowStore((s) => (isNew ? 0 : s.list.find((l) => l.id === id)?.deployed_units ?? 0));

  const existing = useMemo(() => (isNew ? null : entries.find((e) => e.id === id) ?? null), [entries, id, isNew]);

  const [raw, setRaw] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [square, setSquare] = useState<SquareBlock | undefined>(undefined);
  const [phase, setPhase] = useState<'idle' | 'structuring' | 'saving'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 기존 노하우를 열었을 때 초안을 **한 번만** 채운다. effect 가 아니라 렌더 중 보정이다 —
  // effect 로 하면 한 프레임 빈 카드가 스쳤다가 채워지고(깜빡임), 스토어가 재조회될 때마다
  // 입력 중인 내용을 서버 값으로 덮는다. `seededId` 가 "어느 노하우를 채워 뒀나"를 기억한다
  // (React 의 '값이 바뀌면 상태 보정' 패턴 — https://react.dev/learn/you-might-not-need-an-effect).
  const [seededId, setSeededId] = useState<string | null>(null);
  if (existing && seededId !== existing.id) {
    setSeededId(existing.id);
    setDraft(draftOf(existing));
    setSquare(existing.square);
  }

  const runStructure = async () => {
    if (!raw.trim()) { setErr('먼저 노하우 내용을 붙여넣어 주세요.'); return; }
    if (!wsUnitId) { setErr('작업실이 준비되지 않아 AI 정리를 할 수 없어요.'); return; }
    setPhase('structuring');
    setErr(null);
    setNote(null);
    const cat: Category = draft?.category ?? 'Routine';
    const out = await structureSquare({
      storeId: wsUnitId,
      rawText: raw,
      category: cat,
      categoryGuide: getCategoryGuide(cat).extractionGuide,
    });
    setPhase('idle');
    if (out.usable === false) {
      setErr('운영 내용으로 읽히지 않았어요. 어떤 상황에서 무엇을 어떻게 하는지가 들어가면 카드로 정리돼요.');
      return;
    }
    // ★AI 서버가 죽어 mock 으로 떨어졌으면 **말한다**. 조용히 가짜 카드를 저장하면 그게 무음 오염이다.
    if (out.degraded) setNote('AI 서버에 닿지 못해 기본 정리로 만들었어요. 내용을 꼭 확인해 주세요.');
    setSquare(out.square);
    setDraft({
      title: out.title || raw.slice(0, 30),
      category: cat,
      situation: out.square.situation ?? '',
      steps: out.square.action?.steps ?? [],
      dont: out.square.extract?.dont ?? '',
      section: draft?.section ?? '',
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!wsUnitId) { setErr('작업실이 준비되지 않아 저장할 수 없어요.'); return; }
    const sq = squareOf(square, draft);
    if (!isSquarePublishable(sq)) { setErr('할 일 단계를 하나 이상 적거나 상황을 조금 더 자세히 써 주세요.'); return; }
    setPhase('saving');
    setErr(null);

    if (existing) {
      const ok = await updateEntry(existing.id, {
        title: draft.title.trim() || existing.title,
        category: draft.category,
        square: sq,
        section: draft.section.trim() || null,
      });
      setPhase('idle');
      if (!ok) { setErr('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
      // 본문이 바뀌었으니 색인도 다시 — 안 하면 검색이 옛 문장으로 남는다.
      void embedEntry({ ...existing, title: draft.title, category: draft.category, square: sq });
      await refresh();
      setNote('저장했어요. 매장에 보내려면 노하우 목록에서 골라 [배포]를 누르세요.');
      return;
    }

    // 새로 쓰기 — 조립은 매장 앱과 같은 함수, unit 만 작업실로 덮는다(머리주석).
    const uq = buildDirectUq(draft.category, draft.title || raw.slice(0, 60));
    const entry: PlaybookEntry = {
      ...buildPlaybookEntryFromSquare(uq, sq, { title: draft.title, section: draft.section.trim() || null }),
      unit_id: wsUnitId,
    };
    const ok = await insertEntry(entry);
    setPhase('idle');
    if (!ok) { setErr('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return; }
    void embedEntry(entry);
    await refresh();
    router.replace({ pathname: '/hq/knowhow/[id]', params: { id: entry.id } });
  };

  // 스토어가 아직 안 섰거나 작업실 진입이 실패하면 편집기를 열지 않는다(ready 게이트 — 빈 칸에
  // 글을 쓰게 하고 저장에서 실패하는 것이 가장 나쁘다).
  if (!loaded) return <HqPage title="노하우" sub="불러오는 중…">{null}</HqPage>;
  if (storeError || !wsUnitId) {
    return (
      <HqPage title="노하우" sub="편집기를 열 수 없어요" actions={<HqButton label="목록으로" onPress={() => router.replace('/hq/knowhow')} />}>
        <HqNotice tone="warn">{storeError ?? '작업실이 아직 준비되지 않았어요.'}</HqNotice>
      </HqPage>
    );
  }
  if (!isNew && !existing) {
    return (
      <HqPage title="노하우" sub="찾을 수 없어요" actions={<HqButton label="목록으로" onPress={() => router.replace('/hq/knowhow')} />}>
        <HqNotice tone="warn">이 노하우를 찾을 수 없어요. 목록에서 다시 골라 주세요.</HqNotice>
      </HqPage>
    );
  }


  return (
    <HqPage
      title={existing ? '노하우 고치기' : '노하우 쓰기'}
      sub={
        existing
          ? deployed
            ? `${deployed}곳에 배포됐어요. 고친 내용은 다시 [배포]를 눌러야 매장에 갑니다 — 저장만으로는 안 가요.`
            : '아직 배포하지 않았어요.'
          : '붙여넣기만 해도 AI가 카드로 정리해요. 정리된 내용을 고친 뒤 저장하세요.'
      }
      actions={<HqButton label="목록으로" icon="arrow-back" onPress={() => router.replace('/hq/knowhow')} />}
      testID="hq-knowhow-editor"
    >
      {err ? <HqNotice tone="warn">{err}</HqNotice> : null}
      {note ? <HqNotice tone="i">{note}</HqNotice> : null}

      <View style={styles.two}>
        {/* ── 왼쪽: 입력 ─────────────────────────────────────────── */}
        <View style={styles.col}>
          <HqCard title="원문 붙여넣기" sub="사장님께 설명하듯 그냥 쓰거나, 문서에서 복사해 붙여넣어도 돼요.">
            <TextInput
              value={raw}
              onChangeText={setRaw}
              multiline
              placeholder={'예) 오픈하면 먼저 냉장고 온도를 확인한다. 3도가 넘으면 점장에게 바로 알린다.\n문을 열기 전에 홀 바닥을 한 번 밀고, 화장실 휴지를 채운다.'}
              placeholderTextColor={InkColors.ink3}
              style={styles.area}
              accessibilityLabel="노하우 원문"
              testID="hq-editor-raw"
            />
            <View style={styles.rowBtns}>
              <HqSegment
                items={CATS}
                value={draft?.category ?? 'Routine'}
                onChange={(k) => setDraft((d) => (d ? { ...d, category: k } : { title: '', category: k, situation: '', steps: [], dont: '', section: '' }))}
              />
              <HqButton
                label={phase === 'structuring' ? 'AI가 정리하는 중…' : 'AI로 정리'}
                icon="sparkles-outline"
                variant="dark"
                disabled={phase !== 'idle' || !raw.trim()}
                onPress={() => void runStructure()}
                testID="hq-editor-structure"
              />
            </View>
            <Text style={styles.hint}>정리는 매장 앱과 같은 AI 경로를 써요. 결과는 저장 전에 얼마든지 고칠 수 있어요.</Text>
          </HqCard>
        </View>

        {/* ── 오른쪽: 카드 편집 ──────────────────────────────────── */}
        <View style={styles.col}>
          {!draft ? (
            <HqCard title="정리된 카드" sub="왼쪽에 원문을 넣고 [AI로 정리]를 누르면 여기에 카드가 만들어져요.">
              <View style={styles.blank}>
                <Text style={styles.blankText}>아직 카드가 없어요.</Text>
              </View>
            </HqCard>
          ) : (
            <HqCard title="카드 편집" sub="이 내용이 매장에 그대로 갑니다.">
              <HqRow first k="제목" v={<TextInput value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} style={styles.input} accessibilityLabel="제목" testID="hq-editor-title" />} />
              <HqRow k="분류" v={<HqSegment items={CATS} value={draft.category} onChange={(k) => setDraft({ ...draft, category: k })} />} />
              <HqRow k="섹션" v={<TextInput value={draft.section} onChangeText={(t) => setDraft({ ...draft, section: t })} placeholder="오픈 · 마감 · 레시피 …" placeholderTextColor={InkColors.ink3} style={styles.input} accessibilityLabel="섹션" />} />
              <HqRow k="어떤 상황에서" v={<TextInput value={draft.situation} onChangeText={(t) => setDraft({ ...draft, situation: t })} multiline style={[styles.input, styles.inputTall]} accessibilityLabel="상황" />} />
              <HqRow
                k="무엇을 한다"
                v={
                  <View style={{ gap: 6 }}>
                    {draft.steps.map((s, i) => (
                      <View key={i} style={styles.stepRow}>
                        <Text style={styles.stepNo}>{i + 1}</Text>
                        <TextInput
                          value={s}
                          onChangeText={(t) => setDraft({ ...draft, steps: draft.steps.map((x, j) => (j === i ? t : x)) })}
                          style={[styles.input, { flex: 1 }]}
                          accessibilityLabel={`${i + 1}번째 단계`}
                        />
                        <Pressable
                          onPress={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                          accessibilityRole="button"
                          accessibilityLabel={`${i + 1}번째 단계 지우기`}
                          style={({ pressed }) => [styles.stepX, pressed && { opacity: 0.6 }]}
                        >
                          <Text style={styles.stepXText}>지우기</Text>
                        </Pressable>
                      </View>
                    ))}
                    <HqButton label="단계 추가" icon="add" onPress={() => setDraft({ ...draft, steps: [...draft.steps, ''] })} />
                  </View>
                }
              />
              <HqRow k="하지 말 것" v={<TextInput value={draft.dont} onChangeText={(t) => setDraft({ ...draft, dont: t })} multiline style={[styles.input, styles.inputTall]} accessibilityLabel="하지 말 것" />} />
              <View style={styles.saveBar}>
                <HqButton
                  label={phase === 'saving' ? '저장하는 중…' : existing ? '저장' : '발행'}
                  variant="pri"
                  disabled={phase !== 'idle'}
                  onPress={() => void save()}
                  testID="hq-editor-save"
                />
                {existing?.brand_entry_id ? <HqPill tone="i" label="사본" /> : null}
              </View>
            </HqCard>
          )}
        </View>
      </View>
    </HqPage>
  );
}

const styles = StyleSheet.create({
  // 2단 — 넓은 화면 전용이라 폭 캡이 없다. 좁아지면 아래로 쌓인다(flexWrap).
  two: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 420 },

  area: {
    minHeight: 320,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    padding: 14,
    fontSize: 15,
    lineHeight: 24,
    color: InkColors.ink,
    backgroundColor: InkColors.bg,
    textAlignVertical: 'top',
  },
  rowBtns: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: 12, flexWrap: 'wrap' },
  hint: { fontSize: 13, color: InkColors.ink3, marginTop: 9, lineHeight: 19 },

  input: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 11,
    fontSize: 14.5,
    color: InkColors.ink,
    backgroundColor: InkColors.bg,
    // 넘치는 글은 잘리지 않고 늘어난다(메모리 feedback_fixed_height_text_overflow).
    minHeight: 40,
  },
  inputTall: { minHeight: 76, textAlignVertical: 'top' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNo: { width: 18, fontSize: 13.5, fontWeight: '700', color: InkColors.ink3, textAlign: 'center' },
  stepX: { paddingVertical: 8, paddingHorizontal: 8, minHeight: 40, justifyContent: 'center' },
  stepXText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },

  saveBar: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: 18 },
  blank: { paddingVertical: 60, alignItems: 'center' },
  blankText: { fontSize: 14.5, color: InkColors.ink3 },
});
