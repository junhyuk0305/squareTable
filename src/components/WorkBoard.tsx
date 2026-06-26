import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { logout } from '@/lib/auth';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import {
  useWorkStore,
  SECTION_LABEL,
  REACTIONS,
  type TaskSection,
  type FeedItem,
} from '@/lib/store/useWorkStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { FRAME_MAX_WIDTH, modalFrameStyle } from '@/lib/theme/layout';
import { todayStr, hhmm, shiftMonth, daysInMonth } from '@/lib/utils/attendance';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}
/** YYYY-MM-DD 를 delta일 이동 */
function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return todayStr(d);
}
/** 날짜 바에 쓰는 풀 라벨 — "6월 24일 (수) · 오늘/내일/어제/N일 후" */
function fullDateLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00`);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  const diff = Math.round((d.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  if (diff === 0) return `${base} · 오늘`;
  if (diff === 1) return `${base} · 내일`;
  if (diff === -1) return `${base} · 어제`;
  if (diff > 1) return `${base} · ${diff}일 후`;
  return base;
}

const SECTIONS: TaskSection[] = ['open', 'mid', 'close', 'etc'];

export function WorkBoard({ role, embedded = false }: { role: 'owner' | 'junior'; embedded?: boolean }) {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const isOwner = role === 'owner';

  const owner = useStaffStore((s) => s.owner);
  const staff = useStaffStore((s) => s.staff);

  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const feed = useWorkStore((s) => s.feed);
  const toggleTask = useWorkStore((s) => s.toggleTask);
  const addTemplate = useWorkStore((s) => s.addTemplate);
  const removeTemplate = useWorkStore((s) => s.removeTemplate);
  const postNotice = useWorkStore((s) => s.postNotice);
  const postMessage = useWorkStore((s) => s.postMessage);
  const toggleReaction = useWorkStore((s) => s.toggleReaction);
  const togglePin = useWorkStore((s) => s.togglePin);

  // 채팅은 카톡식으로 쭉 이어지되, 화면은 '선택한 날짜(selectedDate)' 기준으로 본다(날짜=한 페이지).
  const today = todayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const isToday = selectedDate === today;
  const isFuture = selectedDate > today;

  const dayDone = done[selectedDate] ?? {};
  const [draft, setDraft] = useState('');
  const [asNotice, setAsNotice] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({}); // 섹션 접기/펼치기 (기본 접힘)
  const [routineOpen, setRoutineOpen] = useState(true); // 오늘 할일 전체 토글 — 기본 펼침(P2: '오늘 뭐 하지'가 채팅보다 먼저 보이게). 섹션별 N/M은 항상 노출
  const [noticeSheet, setNoticeSheet] = useState(false);
  const [calOpen, setCalOpen] = useState(false); // 달력 점프 시트
  const [oldestShown, setOldestShown] = useState(today); // 채팅 페이지네이션: 이 날짜부터 렌더
  const tasksExpanded = isToday ? routineOpen : true; // 과거/미래엔 할일 패널 항상 펼침

  const scrollRef = useRef<ScrollView>(null);
  const dateY = useRef<Record<string, number>>({}); // 날짜 → 채팅 구분선 y (달력 점프용)
  const pendingJump = useRef<string | null>(null); // 윈도 확장 뒤 스크롤할 목표 날짜

  // id → 이름 (체크/리액션 누른 사람 표시용)
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    if (owner) m[owner.id] = owner.name;
    staff.forEach((s) => (m[s.id] = s.name));
    if (userId) m[userId] = userName;
    return (id: string) => m[id] ?? '직원';
  }, [owner, staff, userId, userName]);

  // 선택 날짜의 할일 = 매일 루틴(dueDate 없음) + 그 날짜 예정(dueDate === selectedDate)
  const tasksOf = (sec: TaskSection) =>
    templates.filter((t) => t.section === sec && (!t.dueDate || t.dueDate === selectedDate));
  // 할일 섹션 (사장은 빈 섹션도 추가용으로 노출, 알바는 항목 있는 것만)
  const sections = useMemo(
    () => SECTIONS.filter((sec) => isOwner || tasksOf(sec).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOwner, templates, selectedDate],
  );

  // 공지는 채팅 흐름과 분리 — 상단 고정 배너 + 모아보기로만 관리.
  const notices = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'notice')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [feed],
  );
  const bannerNotice = useMemo(
    () => notices.find((n) => n.pinned) ?? notices[0],
    [notices],
  );

  // 채팅 스트림 — 메시지 + 완료 알림을 시간순으로 쭉(공지는 제외).
  const stream = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'message' || f.kind === 'task_done')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [feed],
  );
  // 채팅에 존재하는 날짜들(오름차순) + 현재 렌더 윈도(oldestShown 이후만).
  const streamDates = useMemo(() => [...new Set(stream.map((f) => f.date))].sort(), [stream]);
  const shownStream = useMemo(() => stream.filter((f) => f.date >= oldestShown), [stream, oldestShown]);
  const hasOlder = streamDates.some((d) => d < oldestShown);

  // 진행률은 실제로 보이는 섹션의 할일만 집계(알바에게 숨겨진 섹션 제외).
  const visibleTemplates = useMemo(
    () => sections.flatMap((sec) => tasksOf(sec)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, templates, selectedDate],
  );
  const totalTasks = visibleTemplates.length;
  const doneCount = visibleTemplates.filter((t) => dayDone[t.id]).length;

  function scrollToDate(date: string) {
    const y = dateY.current[date];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }

  // 날짜 선택 시: 과거/오늘이면 그 날짜 채팅으로 점프(미래는 채팅 없음).
  useEffect(() => {
    if (isFuture) return;
    if (isToday) {
      pendingJump.current = null;
      const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 60);
      return () => clearTimeout(t);
    }
    if (selectedDate < oldestShown) {
      // 아직 렌더 안 된 과거 → 윈도 확장 후 아래 effect가 스크롤을 마저 처리.
      pendingJump.current = selectedDate;
      setOldestShown(selectedDate);
      return;
    }
    const t = setTimeout(() => scrollToDate(selectedDate), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // 윈도가 확장돼 목표 날짜가 렌더된 뒤 스크롤을 마저 처리.
  useEffect(() => {
    const target = pendingJump.current;
    if (!target || target < oldestShown) return;
    pendingJump.current = null;
    const t = setTimeout(() => scrollToDate(target), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldestShown, shownStream.length]);

  // 오늘 보기 중 새 메시지가 오면 맨 아래로.
  useEffect(() => {
    if (!isToday) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.length]);

  function loadOlder() {
    const prev = streamDates.filter((d) => d < oldestShown).pop();
    if (prev) setOldestShown(prev);
  }

  function send() {
    const v = draft.trim();
    if (!v) return;
    if (isOwner && asNotice) {
      postNotice(today, v, userId, userName, false);
      setNoticeSheet(true); // 공지는 따로 — 등록 후 모아보기를 열어 확인
    } else {
      postMessage(today, v, userId, userName, role);
    }
    setDraft('');
    if (!isToday) setSelectedDate(today); // 과거 보던 중 전송하면 오늘로 복귀
  }

  const body = (
    <>
      {/* 공지 고정 배너 (카톡식) — 탭하면 공지 모아보기 */}
      {bannerNotice && (
        <Pressable onPress={() => setNoticeSheet(true)} style={({ pressed }) => [styles.banner, pressed && { opacity: 0.9 }]}>
          <Ionicons name="megaphone" size={16} color={BrandColors.accent} />
          <Text style={styles.bannerText} numberOfLines={1}>
            {bannerNotice.text}
          </Text>
          {notices.length > 1 && <Text style={styles.bannerCount}>+{notices.length - 1}</Text>}
          <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
        </Pressable>
      )}

      {/* 날짜 바 — ‹ 날짜 › + 달력 점프(카톡식 날짜 이동). 날짜=한 페이지. */}
      <View style={styles.dateBar}>
        <Pressable onPress={() => setSelectedDate((d) => shiftDay(d, -1))} hitSlop={8} style={({ pressed }) => [styles.dateArrow, pressed && { opacity: 0.4 }]}>
          <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
        </Pressable>
        <Pressable onPress={() => setCalOpen(true)} style={({ pressed }) => [styles.dateCenter, pressed && { opacity: 0.6 }]}>
          <Ionicons name="calendar-outline" size={15} color={InkColors.ink2} />
          <Text style={styles.dateCenterText} numberOfLines={1}>
            {fullDateLabel(selectedDate, today)}
          </Text>
          <Ionicons name="chevron-down" size={14} color={InkColors.ink3} />
        </Pressable>
        <Pressable onPress={() => setSelectedDate((d) => shiftDay(d, 1))} hitSlop={8} style={({ pressed }) => [styles.dateArrow, pressed && { opacity: 0.4 }]}>
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
        </Pressable>
        {!isToday && (
          <Pressable onPress={() => setSelectedDate(today)} hitSlop={6} style={({ pressed }) => [styles.todayChip, pressed && { opacity: 0.8 }]}>
            <Text style={styles.todayChipText}>오늘</Text>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* 할일 — 선택 날짜 기준. 오늘=체크 가능, 과거=기록, 미래=예정 미리 적기 */}
          <View style={styles.routineWrap}>
            <Pressable onPress={() => isToday && setRoutineOpen((v) => !v)} style={styles.routineHead}>
              <Ionicons name={isFuture ? 'calendar-outline' : 'checkbox-outline'} size={17} color={InkColors.ink2} />
              <Text style={styles.routineTitle}>{isToday ? '오늘 할일' : isFuture ? '예정 할일' : '그날 할일'}</Text>
              <Text style={styles.progressPill}>
                {doneCount}/{totalTasks}
              </Text>
              {isToday && <Ionicons name={routineOpen ? 'chevron-up' : 'chevron-down'} size={18} color={InkColors.ink3} />}
            </Pressable>

            {isFuture && (
              <Text style={styles.planNote}>미리 적어둔 할일이에요. 그날이 되면 그대로 체크리스트가 돼요.</Text>
            )}

            {tasksExpanded &&
              sections.map((sec) => {
                const list = tasksOf(sec);
                if (!isOwner && list.length === 0) return null;
                // 기본 접힘. 단, 미래(예정) 보기에선 항목 있는 섹션을 펼쳐 바로 보이게.
                const secCollapsed = collapsed[sec] ?? (isFuture ? list.length === 0 : true);
                return (
                  <View key={sec} style={styles.section}>
                    <Pressable onPress={() => setCollapsed((c) => ({ ...c, [sec]: !secCollapsed }))} style={styles.sectionHead}>
                      <Ionicons name={secCollapsed ? 'chevron-forward' : 'chevron-down'} size={16} color={InkColors.ink3} />
                      <Text style={styles.sectionTitle}>{SECTION_LABEL[sec]}</Text>
                      <Text style={styles.sectionCount}>
                        {list.filter((t) => dayDone[t.id]).length}/{list.length}
                      </Text>
                    </Pressable>
                    {!secCollapsed && (
                      <View style={styles.card}>
                        {list.length === 0 && <Text style={styles.sectionEmpty}>항목 없음</Text>}
                        {list.map((t) => {
                          const mark = dayDone[t.id];
                          const on = !!mark;
                          const planned = !!t.dueDate; // 일회성 예정 할일
                          return (
                            <View key={t.id} style={styles.taskRow}>
                              <Pressable
                                onPress={isToday ? () => toggleTask(selectedDate, t.id, userId, userName, role) : undefined}
                                style={({ pressed }) => [styles.taskMain, pressed && isToday && { opacity: 0.7 }]}
                              >
                                <View style={[styles.box, on && styles.boxOn, !isToday && !on && styles.boxMuted]}>
                                  {on && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.taskText, on && styles.taskTextOn]}>{t.text}</Text>
                                  {on ? (
                                    <Text style={styles.taskBy}>
                                      {mark.byName} 완료 · {hhmm(mark.at)}
                                    </Text>
                                  ) : planned ? (
                                    <Text style={styles.taskPlanned}>예정</Text>
                                  ) : null}
                                </View>
                              </Pressable>
                              {isOwner && (isToday || isFuture) && (
                                <Pressable onPress={() => removeTemplate(t.id)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
                                  <Ionicons name="close" size={18} color={InkColors.ink3} />
                                </Pressable>
                              )}
                            </View>
                          );
                        })}
                        {isOwner && (isToday || isFuture) && (
                          <AddTask
                            section={sec}
                            suffix={isFuture ? '예정 추가' : '항목 추가'}
                            onAdd={(text) => addTemplate(sec, text, isFuture ? selectedDate : undefined)}
                          />
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
          </View>

          {/* 채팅 — 미래면 플래닝 안내, 과거/오늘이면 날짜 구분선과 함께 페이지네이션 */}
          {isFuture ? (
            <View style={styles.futureChat}>
              <Ionicons name="time-outline" size={22} color={InkColors.ink3} />
              <Text style={styles.futureChatText}>아직 오지 않은 날이에요.{'\n'}위에 예정 할일을 미리 적어둘 수 있어요.</Text>
            </View>
          ) : (
            <>
              {hasOlder && (
                <Pressable onPress={loadOlder} style={({ pressed }) => [styles.loadOlder, pressed && { opacity: 0.7 }]}>
                  <Ionicons name="arrow-up" size={14} color={InkColors.ink2} />
                  <Text style={styles.loadOlderText}>이전 날짜 대화 더 보기</Text>
                </Pressable>
              )}
              {shownStream.length === 0 && <Text style={styles.streamEmpty}>아직 대화가 없어요. 첫 메시지를 남겨보세요.</Text>}
              {shownStream.map((f, i) => {
                const prev = shownStream[i - 1];
                const showDivider = !prev || prev.date !== f.date;
                return (
                  <View
                    key={f.id}
                    onLayout={showDivider ? (e) => { dateY.current[f.date] = e.nativeEvent.layout.y; } : undefined}
                  >
                    {showDivider && (
                      <View style={styles.divider}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.dividerText}>{dateLabel(f.date, today)}</Text>
                        <View style={styles.dividerLine} />
                      </View>
                    )}
                    <FeedRow
                      item={f}
                      me={userId}
                      nameOf={nameOf}
                      onReact={(emoji) => toggleReaction(f.id, userId, emoji)}
                    />
                  </View>
                );
              })}
              <View style={{ height: 8 }} />
            </>
          )}
        </ScrollView>

        {/* 입력바 — 미래 날짜엔 채팅 불가(예정 할일만 적음) */}
        {!isFuture && (
          <View style={styles.inputBar}>
            {isOwner && (
              <Pressable
                onPress={() => setAsNotice((v) => !v)}
                style={[styles.noticeToggle, asNotice && styles.noticeToggleOn]}
              >
                <Ionicons name="megaphone-outline" size={16} color={asNotice ? '#FFFFFF' : InkColors.ink3} />
                <Text style={[styles.noticeToggleText, asNotice && { color: '#FFFFFF' }]}>공지</Text>
              </Pressable>
            )}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={isOwner && asNotice ? '공지를 입력하세요' : '메시지 보내기'}
              placeholderTextColor={InkColors.ink3}
              style={styles.input}
              onSubmitEditing={send}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <Pressable onPress={send} disabled={!draft.trim()} style={({ pressed }) => [styles.sendBtn, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 공지 모아보기 */}
      <NoticeSheet
        visible={noticeSheet}
        notices={notices}
        isOwner={isOwner}
        me={userId}
        nameOf={nameOf}
        onClose={() => setNoticeSheet(false)}
        onTogglePin={togglePin}
        onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
      />

      {/* 달력 점프 */}
      <DatePickerSheet
        visible={calOpen}
        selected={selectedDate}
        today={today}
        onPick={setSelectedDate}
        onClose={() => setCalOpen(false)}
      />
    </>
  );

  if (embedded) return body;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '업무',
          headerRight: isOwner
            ? undefined
            : () => (
                <Pressable onPress={() => void logout()} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: BrandColors.brand }}>로그아웃</Text>
                </Pressable>
              ),
        }}
      />
      {body}
      <RoleTabBar role={role} />
    </SafeAreaView>
  );
}

function AddTask({ section, onAdd, suffix = '항목 추가' }: { section: TaskSection; onAdd: (text: string) => void; suffix?: string }) {
  const [text, setText] = useState('');
  function add() {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText('');
  }
  return (
    <View style={styles.addRow}>
      <Ionicons name="add" size={18} color={InkColors.ink3} />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={`${SECTION_LABEL[section]} ${suffix}`}
        placeholderTextColor={InkColors.ink3}
        style={styles.addInput}
        onSubmitEditing={add}
        returnKeyType="done"
      />
      {text.trim().length > 0 && (
        <Pressable onPress={add} hitSlop={6}>
          <Text style={styles.addBtn}>추가</Text>
        </Pressable>
      )}
    </View>
  );
}

/** 달력 점프 시트 — 월 그리드에서 날짜 선택. 웹에선 프레임 폭으로 가둠(sheetDockStyle). */
function DatePickerSheet({
  visible,
  selected,
  today,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: string;
  today: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const [ym, setYm] = useState(selected.slice(0, 7));
  useEffect(() => {
    if (visible) setYm(selected.slice(0, 7));
  }, [visible, selected]);

  const [y, m] = ym.split('-').map(Number);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const total = daysInMonth(ym);
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  const pick = (date: string) => {
    onPick(date);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalFrameStyle}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.calHead}>
            <Pressable onPress={() => setYm((v) => shiftMonth(v, -1))} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
              <Ionicons name="chevron-back" size={22} color={InkColors.ink2} />
            </Pressable>
            <Text style={styles.calMonth}>{`${y}년 ${m}월`}</Text>
            <Pressable onPress={() => setYm((v) => shiftMonth(v, 1))} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
              <Ionicons name="chevron-forward" size={22} color={InkColors.ink2} />
            </Pressable>
          </View>
          <View style={styles.calWeekRow}>
            {WD.map((w, i) => (
              <Text key={w} style={[styles.calWeekday, i === 0 && { color: BrandColors.accent }]}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {cells.map((c, i) => {
              if (c == null) return <View key={`e${i}`} style={styles.calCell} />;
              const ds = `${ym}-${String(c).padStart(2, '0')}`;
              const sel = ds === selected;
              const isT = ds === today;
              return (
                <Pressable key={ds} onPress={() => pick(ds)} style={styles.calCell}>
                  <View style={[styles.calDay, sel && styles.calDaySel, !sel && isT && styles.calDayToday]}>
                    <Text style={[styles.calDayText, sel && { color: '#FFFFFF', fontWeight: '800' }]}>{c}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => pick(today)} style={({ pressed }) => [styles.calTodayBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="today-outline" size={15} color={InkColors.ink} />
            <Text style={styles.calTodayBtnText}>오늘로</Text>
          </Pressable>
          <View style={{ height: 8 }} />
        </View>
      </View>
    </Modal>
  );
}

/** 이모지 리액션 바 — 누른 칩(개수) + ＋로 5종 토글. 칩 아래에 '누가 눌렀는지' 이름까지 표시. */
function ReactionBar({
  reactions,
  me,
  nameOf,
  onReact,
}: {
  reactions?: Record<string, string[]>;
  me: string;
  nameOf: (id: string) => string;
  onReact: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = reactions ?? {};
  const chips = Object.entries(active).filter(([, who]) => who.length > 0);
  return (
    <View style={{ gap: 3 }}>
      <View style={styles.reactWrap}>
        {chips.map(([emoji, who]) => {
          const mine = who.includes(me);
          return (
            <Pressable key={emoji} onPress={() => onReact(emoji)} style={[styles.reactChip, mine && styles.reactChipMine]}>
              <Text style={styles.reactEmoji}>{emoji}</Text>
              <Text style={[styles.reactCount, mine && { color: BrandColors.brand }]}>{who.length}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setOpen((v) => !v)} style={styles.reactAdd}>
          <Ionicons name={open ? 'close' : 'happy-outline'} size={15} color={InkColors.ink3} />
        </Pressable>
        {open &&
          REACTIONS.map((e) => (
            <Pressable
              key={e}
              onPress={() => {
                onReact(e);
                setOpen(false);
              }}
              style={styles.reactPick}
            >
              <Text style={styles.reactEmoji}>{e}</Text>
            </Pressable>
          ))}
      </View>
      {/* 누가 무엇을 눌렀는지 */}
      {chips.map(([emoji, who]) => (
        <Text key={`who-${emoji}`} style={styles.reactWho}>
          {emoji} {who.map((id) => (id === me ? '나' : nameOf(id))).join(', ')}
        </Text>
      ))}
    </View>
  );
}

function FeedRow({
  item,
  me,
  nameOf,
  onReact,
}: {
  item: FeedItem;
  me: string;
  nameOf: (id: string) => string;
  onReact: (emoji: string) => void;
}) {
  if (item.kind === 'task_done') {
    return (
      <View style={styles.doneRow}>
        <Ionicons name="checkmark-circle" size={15} color={BrandColors.good} />
        <Text style={styles.doneText}>
          {item.text} · {hhmm(item.createdAt)}
        </Text>
      </View>
    );
  }
  // message
  const mine = item.authorId === me;
  return (
    <View style={[styles.msgRow, mine && { alignItems: 'flex-end' }]}>
      <Text style={styles.msgAuthor}>{item.authorName}</Text>
      <View style={[styles.msgBubble, mine && styles.msgBubbleMine]}>
        <Text style={[styles.msgText, mine && { color: '#FFFFFF' }]}>{item.text}</Text>
      </View>
      <View style={[mine && { alignItems: 'flex-end' }]}>
        <ReactionBar reactions={item.reactions} me={me} nameOf={nameOf} onReact={onReact} />
      </View>
      <Text style={styles.msgTime}>{hhmm(item.createdAt)}</Text>
    </View>
  );
}

/** 공지 모아보기 — 카톡 공지함처럼 공지만 따로. 사장은 고정/해제 가능. */
function NoticeSheet({
  visible,
  notices,
  isOwner,
  me,
  nameOf,
  onClose,
  onTogglePin,
  onReact,
}: {
  visible: boolean;
  notices: FeedItem[];
  isOwner: boolean;
  me: string;
  nameOf: (id: string) => string;
  onClose: () => void;
  onTogglePin: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* 웹: Modal은 프레임 밖(body)으로 portal 되므로 딤+시트 전체를 프레임 폭으로 가둔다. */}
      <View style={modalFrameStyle}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
        <View style={styles.sheetHead}>
          <Ionicons name="megaphone" size={18} color={BrandColors.accent} />
          <Text style={styles.sheetTitle}>공지</Text>
          <Pressable onPress={onClose} hitSlop={8} style={{ marginLeft: 'auto' }}>
            <Ionicons name="close" size={22} color={InkColors.ink3} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
          {notices.length === 0 && <Text style={styles.sectionEmpty}>등록된 공지가 없어요</Text>}
          {notices.map((n) => (
            <View key={n.id} style={[styles.notice, n.pinned && styles.noticePinned]}>
              <View style={styles.noticeHead}>
                <Ionicons name={n.pinned ? 'pin' : 'megaphone'} size={14} color={BrandColors.accent} />
                <Text style={styles.noticeAuthor}>
                  {n.pinned ? '고정 공지' : '공지'} · {n.authorName}
                </Text>
                <Text style={styles.noticeTime}>{hhmm(n.createdAt)}</Text>
                {isOwner && (
                  <Pressable onPress={() => onTogglePin(n.id)} hitSlop={8} style={({ pressed }) => [{ marginLeft: 6 }, pressed && { opacity: 0.5 }]}>
                    <Ionicons name={n.pinned ? 'pin' : 'pin-outline'} size={16} color={n.pinned ? BrandColors.accent : InkColors.ink3} />
                  </Pressable>
                )}
              </View>
              <Text style={styles.noticeText}>{n.text}</Text>
              <ReactionBar reactions={n.reactions} me={me} nameOf={nameOf} onReact={(e) => onReact(n.id, e)} />
            </View>
          ))}
          <View style={{ height: 16 }} />
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: BrandColors.accentSoft,
    borderBottomWidth: 1,
    borderBottomColor: '#EBD3CD',
  },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '700', color: InkColors.ink },
  bannerCount: { fontSize: 12, fontWeight: '800', color: BrandColors.accent },

  // 날짜 바
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  dateArrow: { padding: 4 },
  dateCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dateCenterText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  todayChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: BrandColors.brandSoft,
  },
  todayChipText: { fontSize: 12, fontWeight: '800', color: BrandColors.brand },

  planNote: { fontSize: 12, color: BrandColors.accent, fontWeight: '600', marginTop: 2 },
  taskPlanned: { fontSize: 11, color: BrandColors.accent, fontWeight: '700', marginTop: 2 },
  boxMuted: { borderStyle: 'dashed', backgroundColor: InkColors.bgSoft },

  futureChat: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  futureChatText: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', lineHeight: 20 },

  loadOlder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  loadOlderText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },

  // 달력 시트
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4 },
  calMonth: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  calWeekRow: { flexDirection: 'row', paddingVertical: 6 },
  calWeekday: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  calDay: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  calDaySel: { backgroundColor: BrandColors.brand },
  calDayToday: { borderWidth: 1.5, borderColor: BrandColors.brand },
  calDayText: { fontSize: 14, color: InkColors.ink, fontWeight: '600' },
  calTodayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: InkColors.bgSoft,
  },
  calTodayBtnText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },

  scroll: { padding: 16, gap: 12 },

  routineWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 12,
    gap: 8,
  },
  routineHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routineTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  progressPill: {
    fontSize: 12,
    fontWeight: '700',
    color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    marginLeft: 'auto',
  },

  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  sectionCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3, marginLeft: 'auto' },
  card: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  sectionEmpty: { fontSize: 13, color: InkColors.ink3, paddingVertical: 14 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  taskMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  boxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  taskText: { fontSize: 15, color: InkColors.ink, fontWeight: '500' },
  taskTextOn: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  taskBy: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 },
  addInput: { flex: 1, fontSize: 14, color: InkColors.ink, paddingVertical: 2 },
  addBtn: { fontSize: 14, fontWeight: '800', color: BrandColors.brand },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: InkColors.line },
  dividerText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  streamEmpty: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', paddingVertical: 20 },

  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { fontSize: 13, color: InkColors.ink3, fontWeight: '500' },

  notice: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBD3CD',
    padding: 14,
    gap: 8,
  },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noticeAuthor: { fontSize: 12, fontWeight: '800', color: BrandColors.accent },
  noticeTime: { fontSize: 11, color: InkColors.ink3, marginLeft: 'auto' },
  noticeText: { fontSize: 15, color: InkColors.ink, lineHeight: 21 },
  noticePinned: { borderColor: BrandColors.accent, borderWidth: 1.5 },

  reactWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  reactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: InkColors.bgSoft,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reactChipMine: { borderColor: BrandColors.brand, backgroundColor: '#FFFFFF' },
  reactEmoji: { fontSize: 14 },
  reactCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  reactWho: { fontSize: 11, color: InkColors.ink3 },
  reactAdd: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: InkColors.bgSoft,
  },
  reactPick: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
  },

  msgRow: { gap: 3, alignItems: 'flex-start' },
  msgAuthor: { fontSize: 11, color: InkColors.ink3, fontWeight: '600', marginLeft: 2 },
  msgBubble: {
    maxWidth: '82%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  msgBubbleMine: { backgroundColor: BrandColors.brand, borderColor: BrandColors.brand },
  msgText: { fontSize: 15, color: InkColors.ink, lineHeight: 20 },
  msgTime: { fontSize: 10, color: InkColors.ink3, marginHorizontal: 2 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: InkColors.line,
  },
  noticeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: InkColors.bgSoft,
  },
  noticeToggleOn: { backgroundColor: BrandColors.accent },
  noticeToggleText: { fontSize: 12, fontWeight: '800', color: InkColors.ink3 },
  input: {
    flex: 1,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: InkColors.bgSoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: BrandColors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'transparent' },
  sheet: {
    // 위치는 sheetDockStyle(도크)이 잡고, 시트는 프레임 폭으로만 제한한다.
    width: '100%',
    maxWidth: FRAME_MAX_WIDTH,
    maxHeight: '80%',
    backgroundColor: InkColors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: InkColors.line,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink },
  sheetScroll: { gap: 12, paddingTop: 4 },
});
