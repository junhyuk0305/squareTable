import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { SECTION_LABEL, type NewTask, type TaskSection, type Recurrence } from '@/lib/store/useWorkStore';
import { type Member } from '@/components/work/MentionInput';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

type When = 'today' | 'date' | 'weekly';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const DAYPARTS: TaskSection[] = ['open', 'mid', 'close', 'etc'];

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
  isDuplicate,
  isOwner,
  me,
  today,
  initialDate,
  initialText,
  initialAssigneeId,
  members = [],
}: {
  onClose: () => void;
  onSubmit: (input: NewTask) => void;
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
}) {
  // 담당 대상: 'shared'(가게 전체) | 'me'(나만) | memberId(특정 직원에게 배정).
  // 배정 = scope 'private' + ownerId=그 직원 → 그 직원과 사장만 보인다(기존 RLS 재사용).
  type Target = 'shared' | 'me' | (string & {});
  const others = useMemo(() => members.filter((m) => m.id !== me), [members, me]);
  const validInitial = initialAssigneeId && others.some((o) => o.id === initialAssigneeId);
  const [text, setText] = useState(initialText ?? '');
  const [when, setWhen] = useState<When>(initialDate && initialDate !== today ? 'date' : 'today');
  // 날짜 지정 시 실제 고를 수 있는 날(이전엔 initialDate에 고정돼 변경 불가 버그). 미니 캘린더로 선택.
  const [pickedDate, setPickedDate] = useState(initialDate ?? today);
  const [dows, setDows] = useState<number[]>([1, 2, 3, 4, 5]);
  const [section, setSection] = useState<TaskSection>('open');
  const [sectionNote, setSectionNote] = useState('');
  const [target, setTarget] = useState<Target>(
    isOwner ? (validInitial ? (initialAssigneeId as string) : 'shared') : 'me',
  );
  const scrollRef = useRef<ScrollView>(null);
  const assigneeName = others.find((o) => o.id === target)?.name;

  // 매주 반복인데 요일 0개면 어느 날에도 안 뜨는 유령 할일 → 등록 막는다.
  const canSubmit = text.trim().length > 0 && !(when === 'weekly' && dows.length === 0);

  // 등록 대상 한 줄 요약 — "어디(언제·데이파트·범위) 할일로 들어가는지" 항상 보이게.
  const destLabel = useMemo(() => {
    const secL = section === 'etc' ? (sectionNote.trim() || '기타') : SECTION_LABEL[section];
    const scopeL = !isOwner ? '나만 보기' : target === 'shared' ? '가게 전체' : target === 'me' ? '나만 보기' : `담당: ${assigneeName ?? '직원'}`;
    let whenL: string;
    if (when === 'weekly') whenL = dows.length ? `매주 ${dows.slice().sort().map((d) => DOW[d]).join('·')}` : '매주(요일 미선택)';
    else if (when === 'date') whenL = fmtDate(pickedDate);
    else whenL = `오늘 (${fmtDate(today)})`;
    return `${whenL} · ${secL} · ${scopeL}`;
  }, [when, pickedDate, dows, section, sectionNote, target, assigneeName, isOwner, today]);

  function buildInput(): NewTask | null {
    const v = text.trim();
    if (!v || (when === 'weekly' && dows.length === 0)) return null;
    let recurrence: Recurrence | undefined;
    let date: string | undefined;
    if (when === 'weekly') recurrence = { weekly: dows.slice().sort() };
    else if (when === 'date') { recurrence = 'once'; date = pickedDate; }
    else { recurrence = 'once'; date = today; }
    // 담당 대상 → scope/ownerId 결정. 'shared'=가게 전체 / 'me'=내 개인 / memberId=그 직원에게 배정.
    const scope: 'shared' | 'private' = !isOwner ? 'private' : target === 'shared' ? 'shared' : 'private';
    const ownerId = !isOwner ? me : target === 'shared' ? undefined : target === 'me' ? me : target;
    return {
      section,
      text: v,
      scope,
      ...(ownerId ? { ownerId } : null),
      // 작성자=등록하는 본인. private 가시성(owner_id OR created_by = 본인) 판정에 쓴다.
      createdBy: me,
      ...(section === 'etc' && sectionNote.trim() ? { sectionNote: sectionNote.trim() } : null),
      recurrence,
      ...(date ? { date } : null),
    };
  }

  // 같은 할일이 이미 있는지 실시간 검사 — 조건을 바꾸면 경고가 자동으로 사라진다.
  const isDup = useMemo(() => {
    const input = buildInput();
    return !!input && !!isDuplicate?.(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, when, pickedDate, dows, section, sectionNote, target, isOwner, me, today, isDuplicate]);

  function submit() {
    const input = buildInput();
    if (!input || isDup) return; // 중복이면 등록 막음(경고는 화면에 이미 떠 있다)
    onSubmit(input);
    onClose();
  }

  function revealScroll() {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
  }

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '86%' }}>
          <Text style={s.title}>할일 추가</Text>

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

            <Field label="시간대 (데이파트)">
              <Seg
                options={DAYPARTS.map((d) => ({ k: d, l: d === 'etc' ? '기타 ✎' : SECTION_LABEL[d] }))}
                value={section}
                onChange={(k) => { setSection(k as TaskSection); if (k === 'etc') revealScroll(); }}
              />
              {section === 'etc' && (
                <View style={s.reveal}>
                  <Text style={s.revealLabel}>기타 — 직접 입력</Text>
                  <TextInput value={sectionNote} onChangeText={setSectionNote} placeholder="예) 14시 브레이크 / 마감 후" placeholderTextColor={InkColors.ink3} style={[s.inp, { backgroundColor: '#fff' }]} />
                </View>
              )}
            </Field>

            <Field label="누구 할 일인가요?">
              {isOwner ? (
                <>
                  <Seg
                    options={[{ k: 'shared', l: '가게 전체' }, { k: 'me', l: '나만' }, ...others.map((o) => ({ k: o.id, l: o.name }))]}
                    value={target}
                    onChange={(k) => setTarget(k as Target)}
                  />
                  {target !== 'shared' && target !== 'me' && (
                    <Text style={s.assignHint}>‘{assigneeName ?? '직원'}’에게 배정 — 그 직원과 사장님만 볼 수 있어요</Text>
                  )}
                </>
              ) : (
                <View style={s.lockedScope}>
                  <Text style={s.lockedScopeText}>나만 보기</Text>
                  <Text style={s.lockedScopeHint}>알바가 등록한 할일은 본인에게만 보여요</Text>
                </View>
              )}
            </Field>

            <Text style={s.note}>‘매주 반복’=선택 요일마다 자동 노출 · ‘기타 ✎’=직접 입력</Text>
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
                <Text style={s.destText} numberOfLines={1}>여기에 등록돼요 · <Text style={s.destStrong}>{destLabel}</Text></Text>
              </View>
            )}
            <Pressable onPress={submit} disabled={!canSubmit || isDup} style={({ pressed }) => [s.cta, (!canSubmit || isDup) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
              <Text style={s.ctaText}>{isDup ? '이미 등록됨' : '할일 등록'}</Text>
            </Pressable>
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
  title: { fontSize: 16, fontWeight: '800', color: InkColors.ink, paddingHorizontal: 16, paddingBottom: 12 },
  scroll: { flex: 1, paddingHorizontal: 16 },
  fld: { marginBottom: 13 },
  fldLabel: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 6 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, color: InkColors.ink, backgroundColor: InkColors.cream },

  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segO: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: InkColors.bg },
  segOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  segText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },

  reveal: { marginTop: 9, padding: 11, backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: 12 },
  revealLabel: { fontSize: 11, fontWeight: '800', color: InkColors.ink2, marginBottom: 8 },
  dateText: { fontSize: 14, fontWeight: '700', color: InkColors.ink, marginTop: 8, textAlign: 'center' },

  // 미니 달력
  cal: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 8 },
  calBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingBottom: 6 },
  calMonth: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  weekRow: { flexDirection: 'row' },
  weekCell: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '800', color: InkColors.ink3, paddingVertical: 3 },
  daysWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  cellToday: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line },
  cellSel: { backgroundColor: InkColors.ink },
  cellNum: { fontSize: 13, fontWeight: '600', color: InkColors.ink },
  cellMute: { color: InkColors.ink3, opacity: 0.45 },
  dowRow: { flexDirection: 'row', gap: 5 },
  dow: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  dowSun: { backgroundColor: BrandColors.bad, borderColor: BrandColors.bad },
  dowText: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink2 },
  dowWarn: { fontSize: 11, color: BrandColors.bad, fontWeight: '700', marginTop: 8 },

  lockedScope: { backgroundColor: InkColors.cream, borderWidth: 1, borderColor: InkColors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 10 },
  lockedScopeText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  lockedScopeHint: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
  assignHint: { fontSize: 11.5, color: InkColors.ink2, fontWeight: '600', marginTop: 8, paddingHorizontal: 2 },

  note: { fontSize: 11, color: InkColors.ink3, textAlign: 'center', marginTop: 4, marginBottom: 8 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderTopColor: InkColors.line },
  destBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  destText: { flex: 1, fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  destStrong: { color: InkColors.ink, fontWeight: '800' },
  dupBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: '#FBF3E3', borderWidth: 1, borderColor: BrandColors.warn, borderRadius: 11 },
  dupText: { flex: 1, fontSize: 12, color: '#8A5A12', fontWeight: '700', lineHeight: 16 },
  cta: { backgroundColor: InkColors.ink, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
