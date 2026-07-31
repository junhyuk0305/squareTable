import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useDayparts, useDaypartLabels, type NewTask, type TaskSection, type TaskTemplate, type Recurrence } from '@/lib/store/useWorkStore';
import { type Member } from '@/components/work/MentionInput';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { searchPlaybook } from '@/lib/rag';
import type { PlaybookEntry } from '@/types';

type When = 'today' | 'date' | 'weekly';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * TaskComposerModal — 할일 추가. 시트 높이 고정 + 내부 스크롤(펼침은 아래로, 위로 안 몰림).
 * 언제: 오늘 / 날짜 지정 / 매주 반복(요일 선택). 데이파트 '기타'는 직접 입력. 공유범위(주니어=나만 고정).
 */
/**
 * 부모는 열릴 때만 마운트한다(`{open && <TaskComposerModal .../>}`) → 매번 깨끗한 초기값으로
 * 시작하므로 setState-in-effect 리셋이 필요 없다.
 */
export function TaskComposerModal({
  onClose,
  onSubmit,
  onEdit,
  onDelete,
  editTemplate,
  isDuplicate,
  isOwner,
  me,
  today,
  initialDate,
  initialText,
  initialAssigneeId,
  members = [],
  knowhowEntries = [],
  initialKnowhowIds,
}: {
  onClose: () => void;
  /** 신규 등록 — 다중 배정이면 담당자 수만큼 NewTask 배열로 넘어온다. */
  onSubmit: (inputs: NewTask[]) => void;
  /** 수정 저장(editTemplate 있을 때). */
  onEdit?: (id: string, patch: NewTask) => void;
  /** 삭제(수정 모드에서 노출). */
  onDelete?: (id: string) => void;
  /** 있으면 '수정' 모드 — 기존 할일을 프리필하고 저장 시 onEdit 호출. */
  editTemplate?: TaskTemplate;
  /** 같은 할일이 이미 등록돼 있는지 검사(있으면 등록을 막고 경고를 띄운다). */
  isDuplicate?: (input: NewTask) => boolean;
  isOwner: boolean;
  me: string;
  today: string;
  initialDate?: string;
  /** 메시지→할일 전환 시 미리 채울 본문. */
  initialText?: string;
  /** 멘션에서 넘어온 담당자(그 직원의 개인 할일로 배정). */
  initialAssigneeId?: string;
  members?: Member[];
  /** 노하우 첨부 검색 대상 = 활성 매장의 로드된 노하우(전체). 검색은 발행분만 노출. */
  knowhowEntries?: PlaybookEntry[];
  /** 수정 모드 프리필 — 이 업무에 이미 붙어 있는 노하우 id들. */
  initialKnowhowIds?: string[];
}) {
  const isEdit = !!editTemplate;
  const dayparts = useDayparts();
  const DL = useDaypartLabels();
  // 배정 후보 = 나 + 다른 멤버(사장 기준). scope 'private' + ownerId → 그 사람과 사장만 보인다(기존 RLS 재사용).
  const others = useMemo(() => members.filter((m) => m.id !== me), [members, me]);
  const nameById = useMemo(() => {
    const map: Record<string, string> = { [me]: '나' };
    others.forEach((o) => (map[o.id] = o.name));
    return map;
  }, [others, me]);

  const [text, setText] = useState(initialText ?? editTemplate?.text ?? '');
  const initWhen: When = editTemplate
    ? (editTemplate.recurrence && editTemplate.recurrence !== 'once' ? 'weekly' : editTemplate.date && editTemplate.date !== today ? 'date' : 'today')
    : (initialDate && initialDate !== today ? 'date' : 'today');
  const [when, setWhen] = useState<When>(initWhen);
  const [pickedDate, setPickedDate] = useState(editTemplate?.date ?? initialDate ?? today);
  const [dows, setDows] = useState<number[]>(
    editTemplate?.recurrence && editTemplate.recurrence !== 'once' ? editTemplate.recurrence.weekly : [1, 2, 3, 4, 5],
  );
  const [section, setSection] = useState<TaskSection>(editTemplate?.section ?? dayparts[0]?.id ?? 'open');

  // 담당: sharedMode(가게 전체) 또는 picked(개인 담당자 여러 명). 신규=다중 토글, 수정=단일 교체.
  const deriveShared = isOwner && (editTemplate ? (editTemplate.scope ?? 'shared') === 'shared' : !(initialAssigneeId && others.some((o) => o.id === initialAssigneeId)));
  const [sharedMode, setSharedMode] = useState(deriveShared);
  const [picked, setPicked] = useState<string[]>(() => {
    if (!isOwner) return [me];
    if (editTemplate) return (editTemplate.scope ?? 'shared') === 'shared' ? [] : editTemplate.ownerId ? [editTemplate.ownerId] : [me];
    if (initialAssigneeId && others.some((o) => o.id === initialAssigneeId)) return [initialAssigneeId];
    return [];
  });
  const scrollRef = useRef<ScrollView>(null);

  // 노하우 첨부(사장만) — 검색은 발행 노하우 대상, 선택은 id 집합. 수정 모드는 기존 첨부로 프리필.
  const [knowhowIds, setKnowhowIds] = useState<string[]>(initialKnowhowIds ?? []);
  const [khQuery, setKhQuery] = useState('');
  const publishedEntries = useMemo(() => knowhowEntries.filter((e) => e.status === 'published'), [knowhowEntries]);
  const entryById = useMemo(() => new Map(knowhowEntries.map((e) => [e.id, e])), [knowhowEntries]);
  // 선택된 노하우(제목 표시용) — 발행 취소된 것도 프리필로 남을 수 있어 전체 맵에서 해석, 없으면 스킵.
  const selectedEntries = useMemo(
    () => knowhowIds.map((id) => entryById.get(id)).filter((e): e is PlaybookEntry => !!e),
    [knowhowIds, entryById],
  );
  const khResults = useMemo(() => {
    const q = khQuery.trim();
    if (!q) return [] as PlaybookEntry[];
    return searchPlaybook(q, publishedEntries, { topK: 6, threshold: 0 }).candidates.map((c) => c.entry);
  }, [khQuery, publishedEntries]);
  // 직접 검색은 기본 접힘 — '+ 노하우 검색해서 첨부'를 눌러 연다(제목 기반 자동 추천이 1차 경로).
  const [khOpen, setKhOpen] = useState(false);
  // 할일 제목으로 자동 추천 — 제목을 적으면 비슷한 기존 노하우가 바로 뜬다(이미 선택한 건 제외).
  const recommended = useMemo(() => {
    const q = text.trim();
    if (q.length < 2) return [] as PlaybookEntry[];
    return searchPlaybook(q, publishedEntries, { topK: 3, threshold: 0 })
      .candidates.filter((c) => c.score >= 0.25)
      .map((c) => c.entry)
      .filter((e) => !knowhowIds.includes(e.id));
  }, [text, publishedEntries, knowhowIds]);
  const toggleKnowhow = (id: string) =>
    setKnowhowIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 담당자 칩 토글 — 신규는 여러 명(토글), 수정은 한 명(교체). '가게 전체'와는 상호배타.
  const pickAssignee = (id: string) => {
    setSharedMode(false);
    setPicked((prev) => {
      if (isEdit) return [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };
  const pickShared = () => { setSharedMode(true); setPicked([]); };

  // 매주 반복인데 요일 0개면 유령 할일 → 막는다. 사장은 담당(전체/개인 1명 이상)도 정해야 한다.
  const assigneeChosen = !isOwner || sharedMode || picked.length > 0;
  const canSubmit = text.trim().length > 0 && !(when === 'weekly' && dows.length === 0) && assigneeChosen;

  const scheduleParts = () => {
    let recurrence: Recurrence | undefined;
    let date: string | undefined;
    if (when === 'weekly') recurrence = { weekly: dows.slice().sort() };
    else if (when === 'date') { recurrence = 'once'; date = pickedDate; }
    else { recurrence = 'once'; date = today; }
    return { recurrence, date };
  };

  const baseInput = (v: string): Omit<NewTask, 'scope' | 'ownerId'> => {
    const { recurrence, date } = scheduleParts();
    return {
      section,
      text: v,
      createdBy: me,
      recurrence,
      ...(date ? { date } : null),
      // 노하우 링크는 사장이 붙이는 것만 반영. 알바 경로엔 필드를 안 실어 링크를 건드리지 않는다(수정 시 무접촉).
      ...(isOwner ? { knowhowIds } : null),
    };
  };

  // 신규 등록 입력(다중 배정이면 담당자 수만큼).
  function buildInputs(): NewTask[] {
    const v = text.trim();
    if (!v || (when === 'weekly' && dows.length === 0) || !assigneeChosen) return [];
    const base = baseInput(v);
    if (!isOwner) return [{ ...base, scope: 'private', ownerId: me }];
    if (sharedMode) return [{ ...base, scope: 'shared' }];
    return picked.map((id) => ({ ...base, scope: 'private', ownerId: id }));
  }

  // 수정 입력(단일).
  function buildEditInput(): NewTask | null {
    const v = text.trim();
    if (!v || (when === 'weekly' && dows.length === 0) || !assigneeChosen) return null;
    const base = baseInput(v);
    if (!isOwner) return { ...base, scope: 'private', ownerId: me };
    if (sharedMode) return { ...base, scope: 'shared' };
    return { ...base, scope: 'private', ownerId: picked[0] };
  }

  // 등록 대상 한 줄 요약 — "어디(언제·데이파트·범위) 할일로 들어가는지" 항상 보이게.
  const destLabel = useMemo(() => {
    const secL = DL[section] ?? '카테고리';
    const scopeL = !isOwner
      ? '나만 보기'
      : sharedMode
        ? '매장 전체'
        : picked.length === 0
          ? '담당자 선택'
          : `담당: ${picked.map((id) => nameById[id] ?? '직원').join('·')}`;
    let whenL: string;
    if (when === 'weekly') whenL = dows.length ? `매주 ${dows.slice().sort().map((d) => DOW[d]).join('·')}` : '매주(요일 미선택)';
    else if (when === 'date') whenL = fmtDate(pickedDate);
    else whenL = `오늘 (${fmtDate(today)})`;
    return `${whenL} · ${secL} · ${scopeL}`;
  }, [when, pickedDate, dows, section, sharedMode, picked, nameById, isOwner, today, DL]);

  // 중복 검사 — 신규 등록에서만(수정은 자기 자신과 겹칠 수 있어 제외). 배정 대상 중 하나라도 중복이면 경고.
  const isDup = useMemo(() => {
    if (isEdit) return false;
    return buildInputs().some((input) => !!isDuplicate?.(input));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, when, pickedDate, dows, section, sharedMode, picked, isOwner, me, today, isDuplicate, isEdit]);

  function submit() {
    if (!canSubmit) return;
    if (isEdit && editTemplate && onEdit) {
      const input = buildEditInput();
      if (!input) return;
      onEdit(editTemplate.id, input);
      onClose();
      return;
    }
    const inputs = buildInputs();
    if (inputs.length === 0 || isDup) return; // 중복이면 등록 막음(경고는 화면에 이미 떠 있다)
    onSubmit(inputs);
    onClose();
  }

  function revealScroll() {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
  }

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '86%' }}>
          <Text style={s.title}>{isEdit ? '할일 수정' : '할일 추가'}</Text>

          <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            <Field label="할 일">
              <TextInput value={text} onChangeText={setText} placeholder="예) 우유 재고 확인" placeholderTextColor={InkColors.ink3} style={s.inp} autoFocus />
            </Field>

            <Field label="언제">
              <Seg
                options={[{ k: 'today', l: '오늘' }, { k: 'date', l: '날짜 지정' }, { k: 'weekly', l: '매주 반복' }]}
                value={when}
                onChange={(k) => { setWhen(k as When); if (k === 'weekly') revealScroll(); }}
              />
              {when === 'date' && (
                <View style={s.reveal}>
                  <Text style={s.revealLabel}>예정 날짜 — 달력에서 고르세요</Text>
                  <MiniCalendar value={pickedDate} today={today} onChange={(d) => { setPickedDate(d); revealScroll(); }} />
                  <Text style={s.dateText}>{fmtDate(pickedDate)}</Text>
                </View>
              )}
              {when === 'weekly' && (
                <View style={s.reveal}>
                  <Text style={s.revealLabel}>반복 요일 (여러 개 선택)</Text>
                  <View style={s.dowRow}>
                    {DOW.map((w, i) => {
                      const on = dows.includes(i);
                      return (
                        <Pressable key={w} onPress={() => setDows((p) => (on ? p.filter((x) => x !== i) : [...p, i]))} style={[s.dow, on && (i === 0 ? s.dowSun : s.dowOn)]}>
                          <Text style={[s.dowText, on && { color: '#fff' }]}>{w}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {dows.length === 0 && <Text style={s.dowWarn}>요일을 하나 이상 선택해 주세요.</Text>}
                </View>
              )}
            </Field>

            <Field label="업무 카테고리">
              <Seg
                options={dayparts.map((d) => ({ k: d.id, l: d.label }))}
                value={section}
                onChange={(k) => setSection(k as TaskSection)}
              />
            </Field>

            <Field label={isOwner && !isEdit ? '누구 할 일인가요? (여러 명 선택 가능)' : '누구 할 일인가요?'}>
              {isOwner ? (
                <>
                  <View style={s.seg}>
                    <Pressable onPress={pickShared} style={[s.segO, sharedMode && s.segOn]}>
                      <Text style={[s.segText, sharedMode && { color: '#fff' }]}>매장 전체</Text>
                    </Pressable>
                    {[{ id: me, name: '나' }, ...others].map((m) => {
                      const on = !sharedMode && picked.includes(m.id);
                      return (
                        <Pressable key={m.id} onPress={() => pickAssignee(m.id)} style={[s.segO, on && s.segOn]}>
                          {on && !isEdit && <Ionicons name="checkmark" size={13} color="#fff" style={{ marginRight: 3 }} />}
                          <Text style={[s.segText, on && { color: '#fff' }]}>{m.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!sharedMode && picked.length > 0 && (
                    <Text style={s.assignHint}>
                      ‘{picked.map((id) => nameById[id] ?? '직원').join('·')}’{picked.length > 1 ? ' 각자에게 배정' : '에게 배정'} — 그 직원과 사장님만 볼 수 있어요
                    </Text>
                  )}
                  {!assigneeChosen && <Text style={s.dowWarn}>담당을 하나 이상 골라 주세요.</Text>}
                </>
              ) : (
                <View style={s.lockedScope}>
                  <Text style={s.lockedScopeText}>나만 보기</Text>
                  <Text style={s.lockedScopeHint}>직원이 등록한 할일은 본인에게만 보여요</Text>
                </View>
              )}
            </Field>

            {isOwner && (
              <Field label="관련 노하우 (선택)">
                {selectedEntries.length > 0 && (
                  <View style={s.khChips}>
                    {selectedEntries.map((e) => (
                      <Pressable key={e.id} onPress={() => toggleKnowhow(e.id)} style={s.khChip} accessibilityRole="button" accessibilityLabel={`${e.title} 첨부 해제`}>
                        <Ionicons name="document-text" size={12} color={InkColors.ink} />
                        <Text style={s.khChipText} numberOfLines={1}>{e.title}</Text>
                        <Ionicons name="close" size={13} color={InkColors.ink2} />
                      </Pressable>
                    ))}
                  </View>
                )}
                {recommended.length > 0 && (
                  <View style={s.khResults}>
                    <Text style={s.khRecoLabel}>제목과 비슷한 우리 매장 노하우</Text>
                    {recommended.map((e) => (
                      <Pressable
                        key={e.id}
                        onPress={() => toggleKnowhow(e.id)}
                        style={({ pressed }) => [s.khRow, pressed && { backgroundColor: InkColors.paper }]}
                        accessibilityRole="button"
                        accessibilityLabel={`${e.title} 첨부`}
                      >
                        <Ionicons name="add-circle-outline" size={17} color={InkColors.ink3} />
                        <Text style={s.khRowText} numberOfLines={1}>{e.title}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {!khOpen && (
                  <Pressable
                    onPress={() => { setKhOpen(true); revealScroll(); }}
                    style={({ pressed }) => [s.khOpenBtn, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="노하우 검색해서 첨부"
                  >
                    <Ionicons name="add" size={16} color={InkColors.ink2} />
                    <Text style={s.khOpenText}>노하우 검색해서 첨부</Text>
                  </Pressable>
                )}
                {khOpen && (
                <TextInput
                  value={khQuery}
                  onChangeText={setKhQuery}
                  onFocus={revealScroll}
                  placeholder="노하우 검색해서 첨부"
                  placeholderTextColor={InkColors.ink3}
                  style={s.inp}
                  autoFocus
                />
                )}
                {khOpen && khQuery.trim().length > 0 && (
                  <View style={s.khResults}>
                    {publishedEntries.length === 0 ? (
                      // 노하우 0개 매장(콜드스타트) — "매치 없음"이 아니라 "아직 등록 안 됨"으로 정직하게 구분.
                      <Text style={s.khEmpty}>아직 등록된 노하우가 없어요. 노하우 탭에서 먼저 추가해 주세요.</Text>
                    ) : khResults.length === 0 ? (
                      <Text style={s.khEmpty}>맞는 노하우가 없어요</Text>
                    ) : (
                      khResults.map((e) => {
                        const on = knowhowIds.includes(e.id);
                        return (
                          <Pressable
                            key={e.id}
                            onPress={() => toggleKnowhow(e.id)}
                            style={({ pressed }) => [s.khRow, pressed && { backgroundColor: InkColors.paper }]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={`${e.title}${on ? ' 첨부 해제' : ' 첨부'}`}
                          >
                            <Ionicons name={on ? 'checkmark-circle' : 'add-circle-outline'} size={17} color={on ? BrandColors.good : InkColors.ink3} />
                            <Text style={s.khRowText} numberOfLines={1}>{e.title}</Text>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                )}
              </Field>
            )}
          </ScrollView>

          <View style={s.foot}>
            {isDup ? (
              <View style={s.dupBar}>
                <Ionicons name="alert-circle" size={15} color={BrandColors.warn} />
                <Text style={s.dupText} numberOfLines={2}>이미 등록된 할일이에요. 같은 조건으로는 다시 추가할 수 없어요.</Text>
              </View>
            ) : (
              <View style={s.destBar}>
                <Ionicons name="arrow-forward-circle" size={15} color={InkColors.ink2} />
                <Text style={s.destText} numberOfLines={1}>{isEdit ? '이렇게 바뀌어요' : '여기에 등록돼요'} · <Text style={s.destStrong}>{destLabel}</Text></Text>
              </View>
            )}
            <View style={s.footBtns}>
              {isEdit && onDelete && editTemplate && (
                <Pressable
                  onPress={() => { onDelete(editTemplate.id); onClose(); }}
                  style={({ pressed }) => [s.delBtn, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel="이 할일 삭제"
                >
                  <Ionicons name="trash-outline" size={16} color={BrandColors.bad} />
                  <Text style={s.delText}>삭제</Text>
                </Pressable>
              )}
              <Pressable onPress={submit} disabled={!canSubmit || isDup} style={({ pressed }) => [s.cta, { flex: 1 }, (!canSubmit || isDup) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
                <Text style={s.ctaText}>{isEdit ? '수정 저장' : isDup ? '이미 등록됨' : '할일 등록'}</Text>
              </Pressable>
            </View>
          </View>
    </BottomSheet>
  );
}

/** 모달 내장 미니 월 달력 — 날짜 지정용. 가벼운 그리드 + 월 이동. */
function MiniCalendar({ value, today, onChange }: { value: string; today: string; onChange: (d: string) => void }) {
  const [cursor, setCursor] = useState(() => new Date(`${value}T00:00:00`));
  const grid = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const lead = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { date: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < lead; i++) {
      const d = new Date(y, m, 1 - (lead - i));
      cells.push({ date: ymd(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: ymd(new Date(y, m, d)), day: d, inMonth: true });
    while (cells.length % 7 !== 0) {
      const last = new Date(`${cells[cells.length - 1].date}T00:00:00`);
      last.setDate(last.getDate() + 1);
      cells.push({ date: ymd(last), day: last.getDate(), inMonth: false });
    }
    return cells;
  }, [cursor]);
  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
  const shift = (delta: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  return (
    <View style={s.cal}>
      <View style={s.calBar}>
        <Pressable onPress={() => shift(-1)} hitSlop={8}><Ionicons name="chevron-back" size={18} color={InkColors.ink2} /></Pressable>
        <Text style={s.calMonth}>{monthLabel}</Text>
        <Pressable onPress={() => shift(1)} hitSlop={8}><Ionicons name="chevron-forward" size={18} color={InkColors.ink2} /></Pressable>
      </View>
      <View style={s.weekRow}>
        {DOW.map((w, i) => (
          <Text key={w} style={[s.weekCell, i === 0 && { color: BrandColors.bad }]}>{w}</Text>
        ))}
      </View>
      <View style={s.daysWrap}>
        {grid.map((c) => {
          const isSel = c.date === value;
          const isToday = c.date === today;
          return (
            <Pressable key={c.date} onPress={() => onChange(c.date)} style={[s.cell, isToday && !isSel && s.cellToday, isSel && s.cellSel]}>
              <Text style={[s.cellNum, !c.inMonth && s.cellMute, isSel && { color: '#fff' }]}>{c.day}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.fld}>
      <Text style={s.fldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Seg({ options, value, onChange }: { options: { k: string; l: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.k === value;
        return (
          <Pressable key={o.k} onPress={() => onChange(o.k)} style={[s.segO, on && s.segOn]}>
            <Text style={[s.segText, on && { color: '#fff' }]}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function fmtDate(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DOW[dt.getDay()]})`;
}

const s = StyleSheet.create({
  title: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 12 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  fld: { marginBottom: 13 },
  fldLabel: { fontSize: 11.5, lineHeight: 17, fontWeight: '800', color: InkColors.ink2, marginBottom: 6 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.cream },

  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // 칩 내부는 반드시 가로 정렬 — 담당자 칩은 선택 시 체크마크 아이콘+이름을 나란히 둔다.
  // (RN 기본 flexDirection=column이라 이 줄이 없으면 체크마크가 이름 위로 쌓여 칩이 깨진다.)
  segO: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: InkColors.bg },
  segOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  reveal: { marginTop: 9, padding: 11, backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md },
  revealLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink2, marginBottom: 8 },
  dateText: { fontSize: 14, fontWeight: '700', color: InkColors.ink, marginTop: 8, textAlign: 'center' },

  // 미니 달력
  cal: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 8 },
  calBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 6 },
  calMonth: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  weekRow: { flexDirection: 'row' },
  weekCell: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '800', color: InkColors.ink3, paddingVertical: 3 },
  daysWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.sm },
  cellToday: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line },
  cellSel: { backgroundColor: InkColors.ink },
  cellNum: { fontSize: 13, fontWeight: '600', color: InkColors.ink },
  cellMute: { color: InkColors.ink3, opacity: 0.45 },
  dowRow: { flexDirection: 'row', gap: 5 },
  dow: { width: 34, height: 34, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  dowSun: { backgroundColor: BrandColors.bad, borderColor: BrandColors.bad },
  dowText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  dowWarn: { fontSize: 11, color: BrandColors.bad, fontWeight: '700', marginTop: 8 },

  lockedScope: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 10 },
  lockedScopeText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  lockedScopeHint: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
  assignHint: { fontSize: 11.5, color: InkColors.ink2, fontWeight: '600', marginTop: 8, paddingHorizontal: 2 },


  // 노하우 첨부
  khChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  khChip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: InkColors.cream },
  khChipText: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: InkColors.ink },
  khResults: { marginTop: 6, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden' },
  khRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: InkColors.paper },
  khRowText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink },
  khEmpty: { fontSize: 12.5, color: InkColors.ink3, paddingHorizontal: 12, paddingVertical: 12 },
  khRecoLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink3, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 },
  khOpenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 6, paddingVertical: 10, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, borderStyle: 'dashed', backgroundColor: InkColors.bg },
  khOpenText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  destBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  destText: { flex: 1, fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  destStrong: { color: InkColors.ink, fontWeight: '800' },
  dupBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: '#FBF3E3', borderWidth: 1, borderColor: BrandColors.warn, borderRadius: Radius.sm },
  dupText: { flex: 1, fontSize: 12, color: '#8A5A12', fontWeight: '700', lineHeight: 16 },
  footBtns: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  delBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 16, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.bad, backgroundColor: InkColors.bg },
  delText: { color: BrandColors.bad, fontSize: 14, fontWeight: '800' },
});
