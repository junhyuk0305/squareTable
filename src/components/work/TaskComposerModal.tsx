import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useDayparts, useDaypartLabels, type NewTask, type TaskSection, type TaskTemplate, type Recurrence } from '@/lib/store/useWorkStore';
import { type Member } from '@/components/work/MentionInput';
import { maskHHMM } from '@/lib/utils/attendance';
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
  routineMode,
  routineSectionLabel,
  onSubmitRoutine,
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
  /**
   * 루틴 업무 모드 — 매장 설정(schedule_config.dayparts)의 루틴을 **할일 추가와 같은 형태**로 짓는다.
   * 루틴에 없는 칸(언제·업무 카테고리·관련 노하우)은 감추고 제목·설명·업무 시간·담당만 남긴다.
   * 저장은 onSubmitRoutine 으로 나간다(할일 행을 만들지 않는다 — 루틴은 테이블 행이 아니라 매장 설정이다).
   * 프리필은 editTemplate 을 그대로 쓴다(루틴을 TaskTemplate 모양으로 싸서 넘기면 된다).
   */
  routineMode?: boolean;
  /** 루틴 모드의 요약 줄에 쓸 카테고리 이름(이 루틴이 속한 시간대). */
  routineSectionLabel?: string;
  /** 루틴 모드 저장 — 담당 없음이면 assigneeId 는 undefined. */
  onSubmitRoutine?: (d: { text: string; description?: string; remindAt?: string; assigneeId?: string }) => void;
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
  const [description, setDescription] = useState(editTemplate?.description ?? '');
  const initWhen: When = editTemplate
    ? editTemplate.recurrence && editTemplate.recurrence !== 'once'
      ? 'weekly'
      : editTemplate.date && editTemplate.date !== today
        ? 'date'
        // 루틴을 '그날만 수정'할 때 — 루틴 자체는 일정 정보가 없고(매일), 어느 날 얘기인지는
        // initialDate 가 들고 온다. 이걸 안 보면 내일 것을 고쳐도 요약 줄이 '오늘'이라고 말한다.
        : !editTemplate.date && initialDate && initialDate !== today
          ? 'date'
          : 'today'
    : initialDate && initialDate !== today
      ? 'date'
      : 'today';
  const [when, setWhen] = useState<When>(initWhen);
  const [pickedDate, setPickedDate] = useState(editTemplate?.date ?? initialDate ?? today);
  const [dows, setDows] = useState<number[]>(
    editTemplate?.recurrence && editTemplate.recurrence !== 'once' ? editTemplate.recurrence.weekly : [1, 2, 3, 4, 5],
  );
  const [section, setSection] = useState<TaskSection>(editTemplate?.section ?? dayparts[0]?.id ?? 'open');

  // 업무 시간(선택, 0118) — 정하면 그 시간에 서버 크론이 알림을 쏜다. 수신자 판정은 서버가 한다.
  // 화면 어휘는 '업무 시간', 코드·DB 이름은 remindAt/remind_at 유지(워딩 규칙: 개명 대상은 보이는 문자열뿐).
  const [remindOn, setRemindOn] = useState(!!editTemplate?.remindAt);
  const [remindAt, setRemindAt] = useState(editTemplate?.remindAt ?? '');
  const [remindInfo, setRemindInfo] = useState(false); // ⓘ 인라인 펼침
  const remindValid = !remindOn || /^([01]\d|2[0-3]):[0-5]\d$/.test(remindAt);

  // ★2026-08-19: **배정과 공개는 다른 축이다.**
  //   · taskScope = 누가 볼 수 있나 — 'shared'(매장 전체 · 담당자를 정해도 전원이 본다) / 'private'(나만)
  //   · picked    = 누가 맡나 — 담당자. 비어 있으면 '담당 없음'
  //   전에는 담당자를 고르는 순간 scope 가 private 로 바뀌어, "매장 전체 할일에 담당자"를 표현할 수가 없었다.
  //   개인 할일은 본인 것만 만든다(ownerId=me, createdBy=me) — 0017 RLS 가 지켜준다.
  const [taskScope, setTaskScope] = useState<'shared' | 'private'>(
    editTemplate ? ((editTemplate.scope ?? 'shared') === 'private' ? 'private' : 'shared') : 'shared',
  );
  const personalMode = taskScope === 'private';
  const [picked, setPicked] = useState<string[]>(() => {
    if (editTemplate) return editTemplate.ownerId ? [editTemplate.ownerId] : [];
    // 직원은 본인 또는 담당 없음만 고를 수 있다 — 프리필도 그 범위 안에서만.
    if (initialAssigneeId && (isOwner || initialAssigneeId === me) && [...others, { id: me }].some((o) => o.id === initialAssigneeId)) {
      return [initialAssigneeId];
    }
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

  // 담당자 칩 토글 — 신규는 여러 명(토글), 수정은 한 명(교체). '담당 없음'과는 상호배타.
  // ★2026-08-19: 방 멤버십으로 담당자를 막지 않는다 — 할일에는 방 개념이 없다(판정 ⑩·0152).
  const pickAssignee = (id: string) => {
    setPicked((prev) => {
      // 루틴 담당은 '이 일을 맡은 사람' 꼬리표 하나라 여러 명이라는 개념이 없다 — 단일 교체.
      if (routineMode) return [id];
      if (isEdit) return [id];
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };
  const pickNoAssignee = () => setPicked([]);

  // 매주 반복인데 요일 0개면 유령 할일 → 막는다.
  // ★담당자는 이제 필수가 아니다 — '담당 없음'이 매장 전체 할일의 정상 상태다(전에는 사장이 반드시 골라야 했다).
  // 루틴은 매일 도는 매장 공통 일이라 '언제'가 없다 — 요일 미선택 같은 조건도 성립하지 않는다.
  const canSubmit = routineMode
    ? text.trim().length > 0 && remindValid
    : text.trim().length > 0 && !(when === 'weekly' && dows.length === 0) && remindValid;

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
      description: description.trim() || undefined,
      createdBy: me,
      recurrence,
      ...(date ? { date } : null),
      ...(remindOn && remindValid ? { remindAt } : null),
      // 노하우 링크는 사장이 붙이는 것만 반영. 알바 경로엔 필드를 안 실어 링크를 건드리지 않는다(수정 시 무접촉).
      ...(isOwner ? { knowhowIds } : null),
    };
  };

  // 신규 등록 입력(다중 배정이면 담당자 수만큼).
  // ★배정 ≠ 비공개(2026-08-19): 담당자를 정해도 scope 는 'shared' 그대로다 — 매장 전원이 본다.
  //   개인 할일만 'private' 이고 그건 항상 본인 것이다.
  function buildInputs(): NewTask[] {
    const v = text.trim();
    if (!v || (when === 'weekly' && dows.length === 0) || !remindValid) return [];
    const base = baseInput(v);
    if (personalMode) return [{ ...base, scope: 'private', ownerId: me }];
    if (picked.length === 0) return [{ ...base, scope: 'shared' }];
    return picked.map((id) => ({ ...base, scope: 'shared', ownerId: id }));
  }

  // 수정 입력(단일).
  function buildEditInput(): NewTask | null {
    const v = text.trim();
    if (!v || (when === 'weekly' && dows.length === 0) || !remindValid) return null;
    const base = baseInput(v);
    if (personalMode) return { ...base, scope: 'private', ownerId: me };
    return { ...base, scope: 'shared', ...(picked[0] ? { ownerId: picked[0] } : null) };
  }

  // 등록 대상 한 줄 요약 — "어디(언제·데이파트·범위) 할일로 들어가는지" 항상 보이게.
  const destLabel = useMemo(() => {
    if (routineMode) {
      const who = picked.length === 0 ? '담당 없음' : `담당: ${nameById[picked[0]] ?? '직원'}`;
      const remindL = remindOn && remindValid && remindAt ? ` · ${remindAt}` : '';
      return `매일 · ${routineSectionLabel ?? '이 카테고리'} · ${who}${remindL}`;
    }
    const secL = DL[section] ?? '카테고리';
    // 공개 범위와 담당을 **둘 다** 말한다 — 담당자가 있어도 매장 전체 할일은 전원이 본다.
    const scopeL = personalMode
      ? '나만 보기'
      : picked.length === 0
        ? '매장 전체'
        : `매장 전체 · 담당 ${picked.map((id) => nameById[id] ?? '직원').join('·')}`;
    let whenL: string;
    if (when === 'weekly') whenL = dows.length ? `매주 ${dows.slice().sort().map((d) => DOW[d]).join('·')}` : '매주(요일 미선택)';
    else if (when === 'date') whenL = fmtDate(pickedDate);
    else whenL = `오늘 (${fmtDate(today)})`;
    const remindL = remindOn && remindValid ? ` · ${remindAt}` : '';
    return `${whenL} · ${secL} · ${scopeL}${remindL}`;
  }, [when, pickedDate, dows, section, personalMode, picked, nameById, today, DL, remindOn, remindValid, remindAt, routineMode, routineSectionLabel]);

  // 중복 검사 — 신규 등록에서만(수정은 자기 자신과 겹칠 수 있어 제외). 배정 대상 중 하나라도 중복이면 경고.
  const isDup = useMemo(() => {
    if (isEdit) return false;
    return buildInputs().some((input) => !!isDuplicate?.(input));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, when, pickedDate, dows, section, personalMode, picked, isOwner, me, today, isDuplicate, isEdit]);

  function submit() {
    if (!canSubmit) return;
    if (routineMode) {
      onSubmitRoutine?.({
        text: text.trim(),
        description: description.trim() || undefined,
        ...(remindOn && remindValid && remindAt ? { remindAt } : null),
        // 담당은 한 명만 — 루틴은 '이 일을 맡은 사람' 꼬리표라 여러 명이라는 개념이 없다.
        ...(picked[0] ? { assigneeId: picked[0] } : null),
      });
      onClose();
      return;
    }
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
          <Text style={s.title}>
            {routineMode ? (isEdit ? '루틴 업무 수정' : '루틴 업무 추가') : isEdit ? '할일 수정' : '할일 추가'}
          </Text>

          <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {/* ★추가되는 칸은 이것 하나다 — 배정과 공개를 가르는 축. 큰 카드 버튼을 만들지 않는다.
                루틴은 매장 공통 일이라 이 선택 자체가 없다. */}
            {!routineMode && (
              <Field label="어떤 할일인가요?">
                <Seg
                  options={[{ k: 'shared', l: '매장 전체' }, { k: 'private', l: '개인 할일' }]}
                  value={taskScope}
                  onChange={(k) => { setTaskScope(k as 'shared' | 'private'); if (k === 'private') setPicked([]); }}
                />
                <Text style={s.revealLabel}>
                  {taskScope === 'shared'
                    ? '모두가 봐요. 담당자를 정해도 다른 사람에게 보여요.'
                    : '나만 봐요. 사장님도 볼 수 없어요.'}
                </Text>
              </Field>
            )}

            <Field label={routineMode ? '루틴 업무' : '할 일'}>
              <TextInput value={text} onChangeText={setText} placeholder="예) 우유 재고 확인" placeholderTextColor={InkColors.ink3} style={s.inp} autoFocus />
            </Field>

            <Field label="설명 (선택)">
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="예) 오전 9시 전에 냉장고를 점검하고 초코를 깔아 두세요."
                placeholderTextColor={InkColors.ink3}
                style={[s.inp, s.textarea]}
                multiline
                numberOfLines={3}
              />
            </Field>
 
            {/* 루틴은 매일 도는 일이라 '언제'와 '업무 카테고리'가 없다 — 카테고리는 지금 열어둔 시간대로 이미 정해져 있다. */}
            {!routineMode && (
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
            )}

            <Field
              label="업무 시간 (선택)"
              info={
                // 공용 InfoDot 은 안 쓴다 — 이 화면 자체가 바텀시트(Modal)라 그 위에 모달을 또 여는 꼴이 된다.
                // 인라인 펼침이 규칙에도 맞고, 시간을 고르는 동안 설명이 가려지지 않는다.
                <Pressable
                  onPress={() => { setRemindInfo((v) => !v); if (!remindInfo) revealScroll(); }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="업무 시간 설명 보기"
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  <Ionicons name="information-circle-outline" size={15} color={InkColors.ink3} />
                </Pressable>
              }
            >
              {remindInfo && (
                <View style={s.infoNote}>
                  <Text style={s.infoText}>
                    정한 시간이 되면 앱이 꺼져 있어도 알림이 가요.{'\n'}
                    ‘매장 전체’ 할일이면 그 시간에 근무 중인 직원에게 가요.{'\n'}
                    담당자를 정했으면 그 담당자에게 가요.{'\n'}
                    근무표에 그 시간 근무자가 없으면 매장 전원에게 가요.
                  </Text>
                </View>
              )}
              <Seg
                options={[{ k: 'off', l: '안 정함' }, { k: 'on', l: '시간 정하기' }]}
                value={remindOn ? 'on' : 'off'}
                onChange={(k) => { setRemindOn(k === 'on'); if (k === 'on') revealScroll(); }}
              />
              {remindOn && (
                <View style={s.reveal}>
                  <Text style={s.revealLabel}>이 시간에 알림이 가요</Text>
                  <TextInput
                    value={remindAt}
                    onChangeText={(t) => setRemindAt(maskHHMM(t))}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="14:00"
                    placeholderTextColor={InkColors.ink3}
                    style={[s.inp, s.timeInp]}
                  />
                  {!remindValid && <Text style={s.dowWarn}>시간을 HH:MM 형식으로 적어 주세요. 예) 14:00</Text>}
                </View>
              )}
            </Field>

            {!routineMode && (
            <Field label="업무 카테고리">
              <Seg
                options={dayparts.map((d) => ({ k: d.id, l: d.label }))}
                value={section}
                onChange={(k) => setSection(k as TaskSection)}
              />
            </Field>
            )}

            {/* 개인 할일이면 담당은 늘 나라서 고를 게 없다 — 칸 자체를 감춘다. */}
            {!personalMode && (
            <Field label={routineMode ? '누가 맡나요?' : isOwner && !isEdit ? '누가 맡나요? (여러 명 선택 가능)' : '누가 맡나요?'}>
              <View style={s.seg}>
                <Pressable onPress={pickNoAssignee} style={[s.segO, picked.length === 0 && s.segOn]}>
                  <Text style={[s.segText, picked.length === 0 && { color: '#fff' }]}>담당 없음</Text>
                </Pressable>
                {/* 배정 범위: 사장·매니저 = 전원 / 직원 = 나 하나(서버도 같은 결과가 되게 화면에서 좁힌다). */}
                {(isOwner ? [{ id: me, name: '나' }, ...others] : [{ id: me, name: '나' }]).map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => pickAssignee(m.id)}
                      style={[s.segO, on && s.segOn]}
                      accessibilityRole="button"
                      accessibilityLabel={m.name}
                    >
                      {on && !isEdit && !routineMode && <Ionicons name="checkmark" size={13} color="#fff" style={{ marginRight: 3 }} />}
                      <Text style={[s.segText, on && { color: '#fff' }]}>{m.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {picked.length > 0 && (
                <Text style={s.assignHint}>
                  ‘{picked.map((id) => nameById[id] ?? '직원').join('·')}’ 담당으로 표시돼요 — 매장 전원에게 보여요
                </Text>
              )}
            </Field>
            )}

            {isOwner && !routineMode && (
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
              {/* 루틴 삭제는 여기서 하지 않는다 — 루틴을 지우는 자리는 업무 설정 한 곳이다(지우는 문을 둘로 만들지 않는다). */}
              {isEdit && !routineMode && onDelete && editTemplate && (
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
                <Text style={s.ctaText}>
                  {routineMode ? (isEdit ? '수정 저장' : '루틴 업무 추가') : isEdit ? '수정 저장' : isDup ? '이미 등록됨' : '할일 등록'}
                </Text>
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
          <Text key={w} style={[s.weekCell, i === 0 && { color: BrandColors.badText }]}>{w}</Text>
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

function Field({ label, info, children }: { label: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={s.fld}>
      {info ? (
        <View style={s.fldLabelRow}>
          <Text style={[s.fldLabel, s.fldLabelInRow]}>{label}</Text>
          {info}
        </View>
      ) : (
        <Text style={s.fldLabel}>{label}</Text>
      )}
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
  fldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  fldLabelInRow: { marginBottom: 0 },
  timeInp: { alignSelf: 'flex-start', minWidth: 96, textAlign: 'center' },
  infoNote: { marginBottom: 6, padding: 11, backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md },
  infoText: { fontSize: 15, lineHeight: 22, color: InkColors.ink2 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.cream },
  textarea: { minHeight: 76, textAlignVertical: 'top' },

  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // 칩 내부는 반드시 가로 정렬 — 담당자 칩은 선택 시 체크마크 아이콘+이름을 나란히 둔다.
  // (RN 기본 flexDirection=column이라 이 줄이 없으면 체크마크가 이름 위로 쌓여 칩이 깨진다.)
  segO: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: InkColors.bg },
  segOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  // 이 방에 없는 직원 — 지우지 않고 흐리게. 옆의 '불가' 알약이 색 없이도 상태를 말한다.
  segBlocked: { opacity: 0.45 },
  segPill: { marginLeft: 6 },
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
  dowSun: { backgroundColor: BrandColors.badSolid, borderColor: BrandColors.bad },
  dowText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  dowWarn: { fontSize: 11, color: BrandColors.badText, fontWeight: '700', marginTop: 8 },

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
  delText: { color: BrandColors.badText, fontSize: 14, fontWeight: '800' },
});
