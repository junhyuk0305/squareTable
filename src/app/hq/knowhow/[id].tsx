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
// ★PDF 올리기·템플릿(P7 이월분)도 **매장 앱의 것을 그대로 부른다** — 신규 로직 0:
//   PDF  = `pickPdf()` → `extractDocText()`(엣지 doc_extract) → 추출 글자를 왼쪽 입력창에 **이어붙인다**.
//          자동으로 AI 정리에 넣지 않는다(매장 앱 HandoverImport 와 같은 이유 — 스캔 오인식이 그대로 노하우가 된다).
//   템플릿 = `KNOWHOW_TEMPLATES`(compile:packs 산출물) → 고르면 **오른쪽 카드**를 바로 채운다.
//          템플릿은 이미 정리된 카드라 AI 를 한 번 더 태우지 않는다. `forkTemplate` 은 매장 발행용이라 쓰지 않는다.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { HqPage, HqButton, HqCard, HqNotice, HqRow, HqSegment, HqPill, HqEmpty } from '@/components/hq/HqKit';
import { HqModal } from '@/components/hq/HqModal';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { structureSquare, extractDocText, embedEntry } from '@/lib/ai';
import { pickPdf, PDF_PICK_SUPPORTED } from '@/lib/import/pickPdf';
import { MAX_IMPORT_CHARS } from '@/lib/import/chunk';
import { KNOWHOW_TEMPLATES, type PlaybookTemplate } from '@/data/knowhowPacks';
import { getCategoryGuide } from '@/lib/ai/categoryGuide';
import { CATEGORY_LABELS } from '@/lib/ai/embedText';
import { buildDirectUq, buildPlaybookEntryFromSquare, isSquarePublishable } from '@/lib/utils/buildEntry';
import { insertEntry, updateEntry } from '@/lib/db';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock, Category } from '@/types';

const CATS = (Object.keys(CATEGORY_LABELS) as Category[]).map((k) => ({ key: k, label: CATEGORY_LABELS[k] }));

/** 매장 앱(HandoverImport)과 같은 클라 상한 — 엣지 하드캡(14MB)보다 먼저 사람 말로 막는다. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

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
  const [phase, setPhase] = useState<'idle' | 'structuring' | 'saving' | 'extracting'>('idle');
  const [tplOpen, setTplOpen] = useState(false);
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

  /**
   * PDF 올리기 — 매장 앱(HandoverImport)과 **같은 경로·같은 상한**이다.
   * 추출 글자는 입력창을 덮지 않고 **이어붙인다**: 큰 문서를 나눠 올리면 같은 칸에 쌓인다.
   * AI 정리로 자동 연결하지 않는다 — 담당자가 눈으로 본 뒤 [AI로 정리]를 누른다.
   */
  const importPdf = async () => {
    if (phase !== 'idle') return;
    const picked = await pickPdf(); // 선택창을 닫으면 null — 로딩은 고른 뒤에만 켠다
    if (!picked) return;
    if (picked.size > MAX_PDF_BYTES) {
      setErr('PDF가 너무 커요 (최대 10MB). 페이지를 나눠 저장한 뒤 한 부분씩 올려 주세요.');
      return;
    }
    setErr(null);
    setNote(null);
    setPhase('extracting');
    const out = await extractDocText({ docBase64: picked.base64, mimeType: 'application/pdf' });
    setPhase('idle');
    if (out.empty) {
      setErr(
        out.error === 'quota'
          ? '이번 달 AI 사용량을 다 썼어요. 내용을 직접 붙여넣을 수도 있어요.'
          : out.error === 'doc_too_large'
            ? 'PDF가 너무 커요 (최대 10MB). 페이지를 나눠 저장한 뒤 한 부분씩 올려 주세요.'
            : out.error === 'failed' || out.error === 'mock_mode'
              ? 'PDF를 읽는 중 연결 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
              : 'PDF에서 글자를 읽지 못했어요. 스캔이 흐리면 다시 찍거나, 내용을 직접 붙여넣어 주세요.',
      );
      return;
    }
    const base = raw.trim() ? `${raw.trimEnd()}\n\n` : '';
    const clipped = out.text.slice(0, Math.max(0, MAX_IMPORT_CHARS - base.length));
    setRaw(base + clipped);
    // 조용히 안 자른다 — 상한에 걸린 사실과 다음 행동을 말한다(매장 앱과 같은 규칙).
    if (clipped.length < out.text.length) setNote('입력 상한에 맞춰 앞부분만 담았어요. 먼저 정리한 뒤 나머지를 이어서 올려 주세요.');
  };

  /** 템플릿은 이미 정리된 카드다 — AI 를 한 번 더 태우지 않고 오른쪽 카드를 바로 채운다. */
  const applyTemplate = (t: PlaybookTemplate) => {
    setTplOpen(false);
    setErr(null);
    setNote('템플릿으로 카드를 채웠어요. 우리 브랜드 말로 고친 뒤 발행해 주세요.');
    setSquare(t.square);
    setDraft(draftOf(t));
  };

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
            {/* 시작하는 두 경로 — 파일에서 뽑아 오거나, 이미 정리된 템플릿에서 출발한다(P7 이월분). */}
            <View style={styles.rowBtns}>
              {PDF_PICK_SUPPORTED ? (
                <HqButton
                  label={phase === 'extracting' ? 'PDF를 읽는 중…' : 'PDF 올리기'}
                  icon="document-text-outline"
                  disabled={phase !== 'idle'}
                  onPress={() => void importPdf()}
                  testID="hq-editor-pdf"
                />
              ) : null}
              <HqButton
                label="템플릿에서 시작"
                icon="albums-outline"
                disabled={phase !== 'idle'}
                onPress={() => setTplOpen(true)}
                testID="hq-editor-template"
              />
            </View>
            <Text style={styles.hint}>
              정리는 매장 앱과 같은 AI 경로를 써요. 결과는 저장 전에 얼마든지 고칠 수 있어요.
              PDF 는 글자만 뽑아 위 칸에 이어붙여요 — 확인한 뒤 [AI로 정리]를 눌러 주세요.
            </Text>
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

      {/* 템플릿 고르기 — 업종팩(compile:packs 산출물) 그대로. 작업실은 업종이 없으므로 전 업종을 보여 준다. */}
      <HqModal
        open={tplOpen}
        title="템플릿에서 시작"
        sub="이미 정리된 카드예요. 고르면 오른쪽 카드가 채워져요 — 우리 브랜드 말로 고쳐서 발행해 주세요."
        onClose={() => setTplOpen(false)}
        width={560}
      >
        {KNOWHOW_TEMPLATES.length === 0 ? (
          <HqEmpty text="템플릿이 없어요. `npm run compile:packs` 로 업종팩을 먼저 만들어 주세요." />
        ) : (
          <View style={styles.tplList}>
            {KNOWHOW_TEMPLATES.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => applyTemplate(t)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.tplRow, pressed && { opacity: 0.85 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.tplTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.tplSub} numberOfLines={1}>
                    {CATEGORY_LABELS[(t.category as Category) ?? 'Routine']}
                    {t.square?.situation ? ` · ${t.square.situation}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </HqModal>
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
  tplList: { gap: Space.sm, maxHeight: 420 },
  tplRow: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, padding: 12, backgroundColor: InkColors.paper },
  tplTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  tplSub: { fontSize: 13, color: InkColors.ink3, marginTop: 2 },

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
