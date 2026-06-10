import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { logout } from '@/lib/auth';
import { useSessionStore } from '@/lib/store/useSessionStore';
import {
  useWorkStore,
  SECTION_LABEL,
  REACTIONS,
  type TaskSection,
  type FeedItem,
} from '@/lib/store/useWorkStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { todayStr, hhmm } from '@/lib/utils/attendance';

function shiftDate(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return todayStr(d);
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}

const SECTIONS: TaskSection[] = ['open', 'mid', 'close', 'etc'];

export function WorkBoard({ role }: { role: 'owner' | 'junior' }) {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const isOwner = role === 'owner';
  const router = useRouter();

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

  const today = todayStr();
  const [offset, setOffset] = useState(0);
  const date = shiftDate(today, offset);
  const isPast = offset < 0; // 지난 날짜는 읽기 전용

  const dayDone = done[date] ?? {};
  const [draft, setDraft] = useState('');
  const [asNotice, setAsNotice] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({}); // 섹션 접기/펼치기

  // 할일 섹션 (사장은 빈 섹션도 추가용으로 노출, 알바는 항목 있는 것만)
  const sections = useMemo(
    () => SECTIONS.filter((sec) => isOwner || templates.some((t) => t.section === sec)),
    [isOwner, templates],
  );

  // 고정 공지를 맨 위로, 나머지는 시간순(카톡식 상단 고정).
  const dayFeed = useMemo(
    () =>
      feed
        .filter((f) => f.date === date)
        .sort((a, b) => {
          const ap = a.pinned ? 1 : 0;
          const bp = b.pinned ? 1 : 0;
          if (ap !== bp) return bp - ap; // pinned 먼저
          return a.createdAt.localeCompare(b.createdAt);
        }),
    [feed, date],
  );

  // 진행률은 실제로 보이는 섹션의 할일만 집계(알바에게 숨겨진 섹션 제외).
  const visibleTemplates = useMemo(
    () => templates.filter((t) => sections.includes(t.section)),
    [templates, sections],
  );
  const totalTasks = visibleTemplates.length;
  const doneCount = visibleTemplates.filter((t) => dayDone[t.id]).length;

  function send() {
    const v = draft.trim();
    if (!v || isPast) return;
    if (isOwner && asNotice) postNotice(date, v, userId, userName, false);
    else postMessage(date, v, userId, userName, role);
    setDraft('');
  }

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

      {/* 날짜 네비 */}
      <View style={styles.dateBar}>
        <Pressable onPress={() => setOffset((o) => o - 1)} hitSlop={8} style={styles.dateArrow}>
          <Ionicons name="chevron-back" size={20} color={InkColors.ink2} />
        </Pressable>
        <Text style={styles.dateLabel}>{dateLabel(date, today)}</Text>
        <Pressable
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
          hitSlop={8}
          style={[styles.dateArrow, offset >= 0 && { opacity: 0.3 }]}
          disabled={offset >= 0}
        >
          <Ionicons name="chevron-forward" size={20} color={InkColors.ink2} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={styles.progressPill}>
          할일 {doneCount}/{totalTasks}
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* 할일 */}
          {sections.map((sec) => {
            const list = templates.filter((t) => t.section === sec);
            if (!isOwner && list.length === 0) return null;
            return (
              <View key={sec} style={styles.section}>
                <Pressable onPress={() => setCollapsed((c) => ({ ...c, [sec]: !c[sec] }))} style={styles.sectionHead}>
                  <Ionicons name={collapsed[sec] ? 'chevron-forward' : 'chevron-down'} size={16} color={InkColors.ink3} />
                  <Text style={styles.sectionTitle}>{SECTION_LABEL[sec]}</Text>
                  <Text style={styles.sectionCount}>{list.filter((t) => dayDone[t.id]).length}/{list.length}</Text>
                </Pressable>
                {!collapsed[sec] && (
                <View style={styles.card}>
                  {list.length === 0 && <Text style={styles.sectionEmpty}>항목 없음</Text>}
                  {list.map((t) => {
                    const mark = dayDone[t.id];
                    const on = !!mark;
                    return (
                      <View key={t.id} style={styles.taskRow}>
                        <Pressable
                          onPress={() => toggleTask(date, t.id, userId, userName, role)}
                          style={({ pressed }) => [styles.taskMain, pressed && { opacity: 0.7 }]}
                        >
                          <View style={[styles.box, on && styles.boxOn]}>
                            {on && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.taskText, on && styles.taskTextOn]}>{t.text}</Text>
                            {on && (
                              <Text style={styles.taskBy}>
                                {mark.byName} · {hhmm(mark.at)}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                        {isOwner && (
                          <Pressable onPress={() => removeTemplate(t.id)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
                            <Ionicons name="close" size={18} color={InkColors.ink3} />
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                  {isOwner && <AddTask section={sec} onAdd={(text) => addTemplate(sec, text)} />}
                </View>
                )}
              </View>
            );
          })}

          {/* 피드 */}
          <Text style={styles.feedTitle}>피드</Text>
          <View style={styles.feed}>
            {dayFeed.length === 0 && <Text style={styles.sectionEmpty}>아직 공지·메시지가 없어요</Text>}
            {dayFeed.map((f) => (
              <FeedRow
                key={f.id}
                item={f}
                me={userId}
                isOwner={isOwner}
                onReact={(emoji) => toggleReaction(f.id, userId, emoji)}
                onTogglePin={() => togglePin(f.id)}
              />
            ))}
          </View>
          <View style={{ height: 8 }} />
        </ScrollView>

        {/* 입력바 */}
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
            editable={!isPast}
            placeholder={isPast ? '지난 날짜에는 보낼 수 없어요' : isOwner && asNotice ? '공지를 입력하세요' : '메시지 보내기'}
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            onSubmitEditing={send}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable onPress={send} disabled={isPast || !draft.trim()} style={({ pressed }) => [styles.sendBtn, (isPast || !draft.trim()) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <RoleTabBar role={role} />
    </SafeAreaView>
  );
}

function AddTask({ section, onAdd }: { section: TaskSection; onAdd: (text: string) => void }) {
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
        placeholder={`${SECTION_LABEL[section]} 항목 추가`}
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

/** 이모지 리액션 바 — 누른 칩(개수) + ＋로 5종 토글. 확인✅도 여기 포함. */
function ReactionBar({ reactions, me, onReact }: { reactions?: Record<string, string[]>; me: string; onReact: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const active = reactions ?? {};
  const chips = Object.entries(active).filter(([, who]) => who.length > 0);
  return (
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
  );
}

function FeedRow({
  item,
  me,
  isOwner,
  onReact,
  onTogglePin,
}: {
  item: FeedItem;
  me: string;
  isOwner: boolean;
  onReact: (emoji: string) => void;
  onTogglePin: () => void;
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
  if (item.kind === 'notice') {
    return (
      <View style={[styles.notice, item.pinned && styles.noticePinned]}>
        <View style={styles.noticeHead}>
          <Ionicons name={item.pinned ? 'pin' : 'megaphone'} size={14} color={BrandColors.accent} />
          <Text style={styles.noticeAuthor}>{item.pinned ? '고정 공지' : '공지'} · {item.authorName}</Text>
          <Text style={styles.noticeTime}>{hhmm(item.createdAt)}</Text>
          {isOwner && (
            <Pressable onPress={onTogglePin} hitSlop={8} style={({ pressed }) => [{ marginLeft: 6 }, pressed && { opacity: 0.5 }]}>
              <Ionicons name={item.pinned ? 'pin' : 'pin-outline'} size={16} color={item.pinned ? BrandColors.accent : InkColors.ink3} />
            </Pressable>
          )}
        </View>
        <Text style={styles.noticeText}>{item.text}</Text>
        <ReactionBar reactions={item.reactions} me={me} onReact={onReact} />
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
        <ReactionBar reactions={item.reactions} me={me} onReact={onReact} />
      </View>
      <Text style={styles.msgTime}>{hhmm(item.createdAt)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
    backgroundColor: '#FFFFFF',
  },
  dateArrow: { padding: 2 },
  dateLabel: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  progressPill: {
    fontSize: 12,
    fontWeight: '700',
    color: InkColors.ink2,
    backgroundColor: InkColors.bgSoft,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    overflow: 'hidden',
  },

  scroll: { padding: 16, gap: 16 },

  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  sectionCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink3, marginLeft: 'auto' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
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
  },
  boxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  taskText: { fontSize: 15, color: InkColors.ink, fontWeight: '500' },
  taskTextOn: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  taskBy: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 },
  addInput: { flex: 1, fontSize: 14, color: InkColors.ink, paddingVertical: 2 },
  addBtn: { fontSize: 14, fontWeight: '800', color: BrandColors.brand },

  feedTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  feed: { gap: 12 },

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
});
