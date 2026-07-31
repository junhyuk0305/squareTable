import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  useWorkStore,
  trainingOf,
  isRegularDue,
  FIRST_DAY_MIN_ITEMS,
  FIRST_DAY_MAX_ITEMS,
  REGULAR_MAX_ITEMS,
  REGULAR_DUE_DAYS,
  knowhowIdsForTask,
  type TrainingCourse,
} from '@/lib/store/useWorkStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { showToast } from '@/lib/store/useToastStore';
import { buildDirectUq, buildPlaybookEntryFromSquare } from '@/lib/utils/buildEntry';
import { BottomSheet } from '@/components/BottomSheet';
import { EntryDetailModal } from '@/components/EntryDetailModal';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry, SquareBlock } from '@/types';

/** 하는 법 최소 길이 — 이 밑이면 노하우가 draft 로 떨어져 훈련 문제를 못 만든다. */
const MIN_HOW_LEN = 10;

const COURSE_META: Record<TrainingCourse, { label: string; max: number }> = {
  first_day: { label: '첫 훈련', max: FIRST_DAY_MAX_ITEMS },
  regular: { label: '정기 훈련', max: REGULAR_MAX_ITEMS },
};

/**
 * 훈련 관리(0099) — 첫 훈련(신입 첫날 3~5개)·정기 훈련(30일 주기 재확인, 최대 10개) 2코스.
 * 항목 = 노하우가 붙은 업무. 추가 경로 2개(새 문답 / 기존 노하우 선택), 항목별 수정·순서·빼기.
 * 직원 쪽 노출·문제 출제·통과 기록은 기존 체인(0069 링크 → quiz → 0072) 재사용.
 */
export default function OwnerTrainingScreen() {
  const router = useRouter();
  const training = useWorkStore((s) => s.training);
  const templates = useWorkStore((s) => s.templates);
  const knowhowLinks = useWorkStore((s) => s.knowhowLinks);
  const understanding = useWorkStore((s) => s.understanding);
  const addTrainingTask = useWorkStore((s) => s.addTrainingTask);
  const removeTrainingItem = useWorkStore((s) => s.removeTrainingItem);
  const moveTrainingItem = useWorkStore((s) => s.moveTrainingItem);
  const entries = usePlaybookStore((s) => s.entries);
  const addEntry = usePlaybookStore((s) => s.add);

  useEffect(() => {
    void useWorkStore.getState().hydrate();
    void usePlaybookStore.getState().hydrate();
  }, []);

  const [course, setCourse] = useState<TrainingCourse>('first_day');
  const meta = COURSE_META[course];

  // ── 코스 항목(순서대로) — 업무명·첨부 노하우·확인 인원까지 풀어서 든다 ──
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // "최근 30일 확인" 판정 기준 시각 — 렌더 중 Date.now() 금지(컴파일러 순수성), 마운트 시 1회로 충분.
  const [now] = useState(() => Date.now());
  const items = useMemo(
    () =>
      trainingOf(training, course)
        .map((f) => {
          const t = templates.find((x) => x.id === f.templateId);
          if (!t) return null;
          const entryId = knowhowIdsForTask(knowhowLinks, t.id)[0];
          const rows = understanding.filter((u) => u.templateId === t.id);
          const passedNames =
            course === 'regular'
              ? rows.filter((u) => !isRegularDue(u.verifiedAt, now)).map((u) => u.staffName)
              : rows.map((u) => u.staffName);
          return { templateId: t.id, text: t.text, entryId, passedNames };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [training, course, templates, knowhowLinks, understanding, now],
  );
  const full = items.length >= meta.max;
  const firstDayReady = course !== 'first_day' || items.length >= FIRST_DAY_MIN_ITEMS;

  // 코스에 이미 쓰인 노하우(중복 추가 방지용) — 두 코스 전체 기준.
  const usedEntryIds = useMemo(() => {
    const ids = new Set<string>();
    training.forEach((f) => knowhowIdsForTask(knowhowLinks, f.templateId).forEach((id) => ids.add(id)));
    return ids;
  }, [training, knowhowLinks]);

  // ── 추가 흐름 상태: 문답 폼 / 기존 노하우 선택 시트 / 항목 액션 시트 / 노하우 열람 ──
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [how, setHow] = useState('');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [actionItem, setActionItem] = useState<(typeof items)[number] | null>(null);
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);

  const canSave = !saving && !full && name.trim().length > 0 && how.trim().length >= MIN_HOW_LEN;

  const saveNew = async () => {
    if (!canSave) return;
    setSaving(true);
    const taskName = name.trim();
    const howText = how.trim();
    // 완료 캡처(S1 ②)와 같은 직접 발행 경로 — 사장의 말이 곧 노하우(situation), 업무명이 제목.
    const square: SquareBlock = {
      situation: howText,
      quagmire: '', uncover: '',
      action: { steps: [], scripts: [] },
      result: { before: '', after: '', metric: '' },
      extract: { do: '', dont: '' },
    };
    const entry = buildPlaybookEntryFromSquare(buildDirectUq('Know-how', howText), square, { title: taskName });
    const okEntry = await addEntry(entry);
    const ok = okEntry && (await addTrainingTask(taskName, entry.id, course));
    setSaving(false);
    if (ok) {
      setName('');
      setHow('');
      showToast(`${meta.label}에 추가했어요`, 'good');
    }
  };

  const addFromEntry = async (e: PlaybookEntry) => {
    setPickerOpen(false);
    setPickerQuery('');
    const ok = await addTrainingTask(e.title, e.id, course);
    if (ok) showToast(`${meta.label}에 추가했어요`, 'good');
  };

  // 검색(제목·키워드) + 발행본만 + 이미 코스에 쓰인 노하우 제외.
  const pickerEntries = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return entries
      .filter((e) => e.status === 'published' && !usedEntryIds.has(e.id))
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.search_keywords.some((k) => k.toLowerCase().includes(q)))
      .slice(0, 30);
  }, [entries, usedEntryIds, pickerQuery]);

  const closeForm = () => {
    setFormOpen(false);
    setName('');
    setHow('');
  };

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '훈련' }} />
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* ── 코스 선택 ── */}
        <Appear delay={0}>
          <View style={st.segRow}>
            {(Object.keys(COURSE_META) as TrainingCourse[]).map((c) => {
              const on = course === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => { setCourse(c); closeForm(); }}
                  style={[st.segBtn, on && st.segBtnOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[st.segText, on && st.segTextOn]}>{COURSE_META[c].label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Appear>

        {/* ── 코스 안내 — 핵심 숫자·상태를 강조해서(줄글 금지) ── */}
        <Appear delay={30}>
          <View style={st.guideCard}>
            {course === 'first_day' ? (
              <>
                <GuideLine icon="footsteps-outline" strong="새 직원이 첫날" rest="순서대로 배우는 훈련이에요" />
                <GuideLine icon="list-outline" strong={`${FIRST_DAY_MIN_ITEMS}~${FIRST_DAY_MAX_ITEMS}개`} rest="핵심 업무만 담아요 · 문제는 노하우로 자동 출제" />
                {firstDayReady ? (
                  <View style={st.statusRow}>
                    <View style={[st.statusDot, { backgroundColor: BrandColors.good }]} />
                    <Text style={[st.statusText, { color: BrandColors.good }]}>준비됨 · 직원 업무 채팅에 보여요</Text>
                  </View>
                ) : (
                  <View style={st.statusRow}>
                    <View style={[st.statusDot, { backgroundColor: '#8a5a12' }]} />
                    <Text style={[st.statusText, { color: '#8a5a12' }]}>
                      {items.length === 0
                        ? `아직 없어요 · ${FIRST_DAY_MIN_ITEMS}개부터 직원에게 보여요`
                        : `${FIRST_DAY_MIN_ITEMS - items.length}개 더 채우면 직원에게 보여요`}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <GuideLine icon="refresh-outline" strong={`${REGULAR_DUE_DAYS}일마다`} rest="다 배운 업무도 다시 이해 확인해요" />
                <GuideLine icon="list-outline" strong={`최대 ${REGULAR_MAX_ITEMS}개`} rest="틀리면 안 되는 업무만 담아요 · 실수 예방이 목적" />
                <View style={st.statusRow}>
                  <View style={[st.statusDot, { backgroundColor: items.length > 0 ? BrandColors.good : InkColors.ink3 }]} />
                  <Text style={[st.statusText, { color: items.length > 0 ? BrandColors.good : InkColors.ink3 }]}>
                    {items.length > 0 ? '운영 중 · 확인할 때가 되면 직원에게 보여요' : '아직 없어요'}
                  </Text>
                </View>
              </>
            )}
          </View>
        </Appear>

        {/* ── 항목 목록 ── */}
        <Appear delay={60}>
          <SectionLabel title={`${meta.label} 업무`} hint={`${items.length}/${meta.max}`} />
          <View style={st.card}>
            {items.length === 0 ? (
              <Text style={st.emptyText}>아래에서 업무를 추가해 주세요</Text>
            ) : (
              items.map((it, i) => (
                <Pressable
                  key={it.templateId}
                  onPress={() => setActionItem(it)}
                  style={({ pressed }) => [st.itemRow, i > 0 && st.itemRowTop, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.text} 관리`}
                >
                  <View style={st.itemNum}><Text style={st.itemNumText}>{i + 1}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.itemText} numberOfLines={1}>{it.text}</Text>
                    <Text style={st.itemMeta} numberOfLines={1}>
                      {!it.entryId
                        ? '노하우 없음 · 문제를 못 만들어요'
                        : it.passedNames.length > 0
                          ? `${course === 'regular' ? `최근 ${REGULAR_DUE_DAYS}일 확인` : '이해 확인'} · ${it.passedNames.join(', ')}`
                          : course === 'regular' ? '확인한 직원이 아직 없어요' : '통과한 직원이 아직 없어요'}
                    </Text>
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={17} color={InkColors.ink3} />
                </Pressable>
              ))
            )}
          </View>
        </Appear>

        {/* ── 추가 — 경로 2개: 새 문답 / 기존 노하우 선택 ── */}
        {!full && (
          <Appear delay={90}>
            <View style={st.addRow}>
              <Pressable
                onPress={() => setFormOpen((v) => !v)}
                style={({ pressed }) => [st.addBtn, formOpen && st.addBtnOn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Ionicons name="create-outline" size={16} color={formOpen ? '#FFFFFF' : InkColors.ink} />
                <Text style={[st.addBtnText, formOpen && { color: '#FFFFFF' }]}>새로 만들기</Text>
              </Pressable>
              <Pressable
                onPress={() => { setPickerOpen(true); closeForm(); }}
                style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Ionicons name="albums-outline" size={16} color={InkColors.ink} />
                <Text style={st.addBtnText}>기존 노하우로 추가</Text>
              </Pressable>
            </View>

            {formOpen && (
              <View style={st.formCard}>
                <Text style={st.qLabel}>맡길 업무는 무엇인가요?</Text>
                <TextInput
                  style={st.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="예) 오픈 청소"
                  placeholderTextColor={InkColors.ink3}
                  maxLength={40}
                />
                <Text style={st.qLabel}>그 업무, 어떻게 하는지 말씀해 주세요</Text>
                <TextInput
                  style={[st.input, st.inputMulti]}
                  value={how}
                  onChangeText={setHow}
                  placeholder="예) 문 열고 포스 켜기, 시재 확인, 머신 예열 순서예요. 시재가 안 맞으면 만지지 말고 바로 알려 주세요."
                  placeholderTextColor={InkColors.ink3}
                  multiline
                />
                {/* 최소 글자수는 숨은 조건으로 두지 않는다 — 짧으면 남은 글자수를 그대로 보여준다. */}
                <Text style={[st.howHint, how.trim().length > 0 && how.trim().length < MIN_HOW_LEN && st.howHintShort]}>
                  {how.trim().length >= MIN_HOW_LEN
                    ? '자세할수록 이해 확인 문제가 좋아져요'
                    : `${MIN_HOW_LEN}자 이상 적어 주세요${how.trim().length > 0 ? ` · 지금 ${how.trim().length}자` : ''}`}
                </Text>
                <Pressable
                  onPress={saveNew}
                  disabled={!canSave}
                  style={({ pressed }) => [st.cta, !canSave && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel="훈련에 추가"
                >
                  <Text style={st.ctaText}>{saving ? '저장하는 중...' : '훈련에 추가'}</Text>
                </Pressable>
              </View>
            )}
          </Appear>
        )}
        {full && (
          <Appear delay={90}>
            <Text style={st.fullNote}>{meta.label}은 {meta.max}개까지예요. 항목을 눌러 빼면 새로 넣을 수 있어요.</Text>
          </Appear>
        )}
      </ScrollView>

      {/* ── 항목 액션 시트: 노하우 보기·수정 / 순서 / 빼기 ── */}
      {actionItem && (
        <BottomSheet visible={true} onClose={() => setActionItem(null)}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle} numberOfLines={1}>{actionItem.text}</Text>
            <Pressable onPress={() => setActionItem(null)} hitSlop={8}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          <SheetAction
            icon="book-outline"
            label="노하우 보기"
            disabled={!actionItem.entryId}
            onPress={() => {
              const e = actionItem.entryId ? entryById.get(actionItem.entryId) : undefined;
              setActionItem(null);
              if (e) setDetailEntry(e);
            }}
          />
          <SheetAction
            icon="create-outline"
            label="노하우 수정"
            disabled={!actionItem.entryId}
            onPress={() => {
              const id = actionItem.entryId;
              setActionItem(null);
              if (id) router.push(`/owner/edit/${id}`);
            }}
          />
          <SheetAction
            icon="arrow-up-outline"
            label="위로 이동"
            disabled={items[0]?.templateId === actionItem.templateId}
            onPress={() => { void moveTrainingItem(actionItem.templateId, 'up'); setActionItem(null); }}
          />
          <SheetAction
            icon="arrow-down-outline"
            label="아래로 이동"
            disabled={items[items.length - 1]?.templateId === actionItem.templateId}
            onPress={() => { void moveTrainingItem(actionItem.templateId, 'down'); setActionItem(null); }}
          />
          <SheetAction
            icon="remove-circle-outline"
            label="훈련에서 빼기"
            danger
            onPress={() => {
              void removeTrainingItem(actionItem.templateId);
              setActionItem(null);
              showToast('훈련에서 뺐어요 · 업무와 노하우는 남아요', 'good');
            }}
          />
        </BottomSheet>
      )}

      {/* ── 기존 노하우 선택 시트(높이 고정 + 내부 스크롤) ── */}
      {pickerOpen && (
        <BottomSheet visible={true} onClose={() => setPickerOpen(false)} sheetStyle={{ height: '78%' }}>
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>기존 노하우로 추가</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={InkColors.ink2} />
            </Pressable>
          </View>
          <View style={st.searchWrap}>
            <Ionicons name="search-outline" size={16} color={InkColors.ink3} />
            <TextInput
              style={st.searchInput}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="예) 마감, 발주"
              placeholderTextColor={InkColors.ink3}
            />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
            {pickerEntries.length === 0 ? (
              <Text style={st.emptyText}>
                {pickerQuery ? '검색된 노하우가 없어요' : '추가할 수 있는 노하우가 없어요. 새로 만들기로 시작해 보세요.'}
              </Text>
            ) : (
              pickerEntries.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => void addFromEntry(e)}
                  style={({ pressed }) => [st.pickRow, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title} 훈련에 추가`}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.itemText} numberOfLines={1}>{e.title}</Text>
                    <Text style={st.itemMeta} numberOfLines={1}>{e.square?.situation || '내용 없음'}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={20} color={InkColors.ink} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </BottomSheet>
      )}

      <EntryDetailModal entry={detailEntry} visible={!!detailEntry} onClose={() => setDetailEntry(null)} />
    </SafeAreaView>
  );
}

/** 안내 카드 한 줄 — 아이콘 + 강조(굵게) + 나머지 설명. */
function GuideLine({ icon, strong, rest }: { icon: keyof typeof Ionicons.glyphMap; strong: string; rest: string }) {
  return (
    <View style={st.guideLine}>
      <Ionicons name={icon} size={15} color={InkColors.ink2} />
      <Text style={st.guideText}>
        <Text style={st.guideStrong}>{strong}</Text> {rest}
      </Text>
    </View>
  );
}

function SheetAction({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const color = danger ? BrandColors.bad : InkColors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.sheetAction, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[st.sheetActionText, danger && { color: BrandColors.bad }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl * 2, gap: Space.md },

  segRow: { flexDirection: 'row', gap: Space.sm },
  segBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  segBtnOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  segTextOn: { color: '#FFFFFF' },

  guideCard: {
    backgroundColor: InkColors.cream, borderRadius: Radius.lg, paddingHorizontal: Space.lg, paddingVertical: Space.md, gap: Space.xs,
  },
  guideLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  guideText: { flex: 1, fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 22 },
  guideStrong: { fontWeight: '900', color: InkColors.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs + 2, marginTop: Space.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '800' },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.xs, marginTop: Space.sm, ...Elevation.e2,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm + 2, minHeight: 56 },
  itemRowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  itemNum: { width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  itemNumText: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  itemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  itemMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 1 },
  emptyText: { fontSize: 15, color: InkColors.ink3, textAlign: 'center', paddingVertical: Space.md },

  addRow: { flexDirection: 'row', gap: Space.sm },
  addBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  addBtnOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  addBtnText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  fullNote: { fontSize: 12.5, color: InkColors.ink3, textAlign: 'center', fontWeight: '600' },

  formCard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.lg, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg, paddingVertical: Space.lg, gap: Space.sm, marginTop: Space.sm, ...Elevation.e2,
  },
  qLabel: { fontSize: 15, fontWeight: '800', color: InkColors.ink, marginTop: Space.xs },
  input: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md, paddingVertical: Space.sm + 2, fontSize: 15, color: InkColors.ink,
  },
  inputMulti: { minHeight: 120, textAlignVertical: 'top' },
  howHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  howHintShort: { color: '#8a5a12' },
  cta: { marginTop: Space.sm, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 15, alignItems: 'center', minHeight: 48 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink },
  sheetAction: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: 16, minHeight: 52 },
  sheetActionText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: Space.sm,
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md, minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, paddingVertical: 8 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: 16, paddingVertical: Space.sm + 2,
    borderTopWidth: 1, borderTopColor: InkColors.line, minHeight: 56,
  },
});
