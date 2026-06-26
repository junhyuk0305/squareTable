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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { logout } from '@/lib/auth';
import { uploadPhoto } from '@/lib/db';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import {
  useWorkStore,
  REACTIONS,
  SECTION_LABEL,
  type TaskSection,
  type TaskTemplate,
  type DoneMark,
  type FeedItem,
} from '@/lib/store/useWorkStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { WorkSegment } from '@/components/WorkSegment';
import { DaypartChecklist } from '@/components/DaypartChecklist';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { todayStr, hhmm } from '@/lib/utils/attendance';

/** 웹 파일 선택 → File 반환. 업로드는 호출부에서(uploadPhoto). 네이티브는 추후 image-picker. */
function pickImageFile(onPick: (file: File) => void) {
  if (Platform.OS !== 'web') return;
  const g = globalThis as unknown as { document?: Document; URL?: typeof URL };
  const doc = g.document;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}

/**
 * WorkBoard — 업무 탭 컨테이너. [채팅 | 공지 | 할일] 세그먼트(WorkSegment).
 *
 * 데이터 골격은 useWorkStore 그대로 재사용한다(낙관적 쓰기·롤백 보존).
 *  - 채팅 슬롯: feed의 message(+task_done 알림) 스트림 + 메시지 입력(postMessage). 카톡식 말풍선.
 *    메시지를 길게(웹 우클릭)/＋버튼으로 '할일'로 변환 → addTemplate('etc', text).
 *  - 공지 슬롯: feed의 notice. 사장=작성(postNotice)/고정(togglePin). 읽음추적: 주니어가 보면
 *    markNoticeRead, 사장은 "N명 읽음" 노출.
 *  - 할일 슬롯: 오늘 templates+done을 DaypartChecklist로. onToggle=toggleTask(today,...),
 *    사진인증 onAttachPhoto=파일선택→uploadPhoto→toggleTask(...,url). 사장은 항목 추가/삭제.
 *
 * 출퇴근은 별도 탭(/junior/attendance, /owner/attendance)으로 분리됨 — 여기서 다루지 않는다.
 */
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
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);

  const today = todayStr();

  // id → 이름 (체크/리액션 누른 사람 표시용)
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    if (owner) m[owner.id] = owner.name;
    staff.forEach((s) => (m[s.id] = s.name));
    if (userId) m[userId] = userName;
    return (id: string) => m[id] ?? '직원';
  }, [owner, staff, userId, userName]);

  // 매장 인원 수(읽음추적 분모) — 사장 + 직원. 데모/오프라인이면 staff만 보일 수 있어 최소 1.
  const memberCount = Math.max(1, (owner ? 1 : 0) + staff.length);

  // ── 파생 데이터 ──────────────────────────────────────────
  // 오늘 할일 = 매일 루틴(dueDate 없음) + 오늘 예정(dueDate === today)
  const todaysTemplates = useMemo(
    () => templates.filter((t) => !t.dueDate || t.dueDate === today),
    [templates, today],
  );
  const todayDone = done[today] ?? {};
  const undoneCount = todaysTemplates.filter((t) => !todayDone[t.id]).length;

  // 공지(최신순). 핀 우선.
  const notices = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'notice')
        .sort((a, b) => {
          if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [feed],
  );
  // 주니어 안읽은 공지 수(세그먼트 배지).
  const unreadNotices = useMemo(
    () => (isOwner ? 0 : notices.filter((n) => !(n.read_by ?? []).includes(userId)).length),
    [notices, isOwner, userId],
  );

  // 채팅 스트림 — 메시지 + 완료 알림을 시간순으로.
  const stream = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'message' || f.kind === 'task_done')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [feed],
  );

  // 사진 첨부 진행 중인 templateId(중복 탭 방지 + 시각 피드백).
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  function onAttachPhoto(templateId: string) {
    if (uploadingId) return;
    pickImageFile(async (file) => {
      setUploadingId(templateId);
      try {
        const url = await uploadPhoto(file);
        // 사진이 업로드되면 그 URL과 함께 완료 처리(미완료였을 때만 토글).
        if (url && !todayDone[templateId]) toggleTask(today, templateId, userId, userName, role, url);
      } finally {
        setUploadingId(null);
      }
    });
  }

  // 채팅 메시지를 할일로 변환 — 02 계약 tasks.fromMessage. '기타'로 올린다.
  function messageToTask(text: string) {
    const v = text.trim();
    if (!v) return;
    addTemplate('etc', v);
  }

  // ── 슬롯들 ──────────────────────────────────────────────
  const chatSlot = (
    <ChatSlot
      stream={stream}
      today={today}
      me={userId}
      nameOf={nameOf}
      onSend={(text) => postMessage(today, text, userId, userName, role)}
      onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
      onMessageToTask={messageToTask}
    />
  );

  const noticeSlot = (
    <NoticeSlot
      notices={notices}
      isOwner={isOwner}
      me={userId}
      memberCount={memberCount}
      nameOf={nameOf}
      onPost={(text) => postNotice(today, text, userId, userName, false)}
      onTogglePin={togglePin}
      onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
      onRead={(id) => markNoticeRead(id, userId)}
    />
  );

  const todoSlot = (
    <TodoSlot
      templates={todaysTemplates}
      doneMap={todayDone}
      isOwner={isOwner}
      uploadingId={uploadingId}
      onToggle={(templateId) => toggleTask(today, templateId, userId, userName, role)}
      onAttachPhoto={onAttachPhoto}
      onAdd={(section, text) => addTemplate(section, text)}
      onRemove={removeTemplate}
      emptyName={userName}
    />
  );

  // 읽음추적은 NoticeSlot의 각 공지 카드가 렌더될 때(=공지 세그먼트 진입 시) 처리한다.
  // WorkSegment는 활성 슬롯만 렌더하므로, 주니어가 공지 탭을 열어야만 카드가 마운트→읽음.
  const body = (
    <WorkSegment
      chat={chatSlot}
      notice={noticeSlot}
      todo={todoSlot}
      counts={{ todo: undoneCount }}
      dots={{ notice: unreadNotices > 0 }}
      initial="chat"
    />
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

// ── 채팅 슬롯 ────────────────────────────────────────────────
function ChatSlot({
  stream,
  today,
  me,
  nameOf,
  onSend,
  onReact,
  onMessageToTask,
}: {
  stream: FeedItem[];
  today: string;
  me: string;
  nameOf: (id: string) => string;
  onSend: (text: string) => void;
  onReact: (id: string, emoji: string) => void;
  onMessageToTask: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
  }, [stream.length]);

  function send() {
    const v = draft.trim();
    if (!v) return;
    onSend(v);
    setDraft('');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.chatScroll} showsVerticalScrollIndicator={false}>
        {stream.length === 0 && <Text style={styles.streamEmpty}>아직 대화가 없어요. 첫 메시지를 남겨보세요.</Text>}
        {stream.map((f, i) => {
          const prev = stream[i - 1];
          const showDivider = !prev || prev.date !== f.date;
          return (
            <View key={f.id}>
              {showDivider && (
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{dateLabel(f.date, today)}</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}
              <FeedRow
                item={f}
                me={me}
                nameOf={nameOf}
                onReact={(emoji) => onReact(f.id, emoji)}
                onToTask={f.kind === 'message' ? () => onMessageToTask(f.text) : undefined}
              />
            </View>
          );
        })}
        <View style={{ height: 8 }} />
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="메시지 보내기"
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
    </KeyboardAvoidingView>
  );
}

function FeedRow({
  item,
  me,
  nameOf,
  onReact,
  onToTask,
}: {
  item: FeedItem;
  me: string;
  nameOf: (id: string) => string;
  onReact: (emoji: string) => void;
  onToTask?: () => void;
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
      <View style={styles.msgBubbleWrap}>
        <Pressable
          onLongPress={onToTask}
          delayLongPress={350}
          style={[styles.msgBubble, mine && styles.msgBubbleMine]}
        >
          <Text style={[styles.msgText, mine && { color: '#FFFFFF' }]}>{item.text}</Text>
        </Pressable>
        {onToTask && (
          <Pressable onPress={onToTask} hitSlop={6} style={({ pressed }) => [styles.toTaskBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="add-circle-outline" size={13} color={InkColors.ink3} />
            <Text style={styles.toTaskText}>할일로</Text>
          </Pressable>
        )}
      </View>
      <View style={[mine && { alignItems: 'flex-end' }]}>
        <ReactionBar reactions={item.reactions} me={me} nameOf={nameOf} onReact={onReact} />
      </View>
      <Text style={styles.msgTime}>{hhmm(item.createdAt)}</Text>
    </View>
  );
}

// ── 공지 슬롯 ────────────────────────────────────────────────
function NoticeSlot({
  notices,
  isOwner,
  me,
  memberCount,
  nameOf,
  onPost,
  onTogglePin,
  onReact,
  onRead,
}: {
  notices: FeedItem[];
  isOwner: boolean;
  me: string;
  memberCount: number;
  nameOf: (id: string) => string;
  onPost: (text: string) => void;
  onTogglePin: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onRead: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');

  function post() {
    const v = draft.trim();
    if (!v) return;
    onPost(v);
    setDraft('');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.noticeScroll} showsVerticalScrollIndicator={false}>
        {notices.length === 0 && (
          <Text style={styles.streamEmpty}>
            {isOwner ? '아직 공지가 없어요. 아래에 첫 공지를 적어보세요.' : '아직 공지가 없어요.'}
          </Text>
        )}
        {notices.map((n) => {
          const readBy = n.read_by ?? [];
          const readCount = Math.min(readBy.length, memberCount);
          return (
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

              {/* 읽음추적 — 사장은 "N명 읽음", 주니어는 본인 읽음 표시 */}
              {isOwner ? (
                <View style={styles.readRow}>
                  <Ionicons name="checkmark-done" size={13} color={InkColors.ink3} />
                  <Text style={styles.readText}>
                    {readCount}/{memberCount}명 읽음
                  </Text>
                </View>
              ) : (
                readBy.includes(me) && (
                  <View style={styles.readRow}>
                    <Ionicons name="checkmark-done" size={13} color={BrandColors.good} />
                    <Text style={[styles.readText, { color: BrandColors.good }]}>읽음</Text>
                  </View>
                )
              )}

              <ReactionBar reactions={n.reactions} me={me} nameOf={nameOf} onReact={(e) => onReact(n.id, e)} />

              {/* 주니어가 카드를 보면(렌더 시) 읽음 처리 — onChange effect가 못 잡은 경우 보강 */}
              {!isOwner && !readBy.includes(me) && (
                <MarkRead id={n.id} onRead={onRead} />
              )}
            </View>
          );
        })}
        <View style={{ height: 8 }} />
      </ScrollView>

      {isOwner && (
        <View style={styles.inputBar}>
          <Ionicons name="megaphone-outline" size={18} color={BrandColors.accent} style={{ marginLeft: 4 }} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="공지를 입력하세요"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            onSubmitEditing={post}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable onPress={post} disabled={!draft.trim()} style={({ pressed }) => [styles.sendBtn, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** 마운트 시 한 번 읽음 처리(주니어). 보이는 공지는 본 것으로 간주. */
function MarkRead({ id, onRead }: { id: string; onRead: (id: string) => void }) {
  useEffect(() => {
    onRead(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}

// ── 할일 슬롯 ────────────────────────────────────────────────
const SECTIONS: TaskSection[] = ['open', 'mid', 'close', 'etc'];

function TodoSlot({
  templates,
  doneMap,
  isOwner,
  uploadingId,
  onToggle,
  onAttachPhoto,
  onAdd,
  onRemove,
  emptyName,
}: {
  templates: TaskTemplate[];
  doneMap: Record<string, DoneMark>;
  isOwner: boolean;
  uploadingId: string | null;
  onToggle: (templateId: string) => void;
  onAttachPhoto: (templateId: string) => void;
  onAdd: (section: TaskSection, text: string) => void;
  onRemove: (templateId: string) => void;
  emptyName?: string;
}) {
  return (
    <ScrollView contentContainerStyle={styles.todoScroll} showsVerticalScrollIndicator={false}>
      <DaypartChecklist
        templates={templates}
        doneMap={doneMap}
        onToggle={onToggle}
        onAttachPhoto={onAttachPhoto}
        role={isOwner ? 'owner' : 'junior'}
        emptyName={emptyName}
      />
      {uploadingId && (
        <View style={styles.uploadingRow}>
          <Ionicons name="cloud-upload-outline" size={15} color={InkColors.ink3} />
          <Text style={styles.uploadingText}>사진 올리는 중…</Text>
        </View>
      )}

      {/* 사장 — 데이파트별 항목 추가/삭제 */}
      {isOwner && (
        <View style={styles.manageWrap}>
          <Text style={styles.manageTitle}>할일 관리</Text>
          {SECTIONS.map((sec) => (
            <OwnerSectionEditor
              key={sec}
              section={sec}
              templates={templates.filter((t) => t.section === sec)}
              onAdd={(text) => onAdd(sec, text)}
              onRemove={onRemove}
            />
          ))}
        </View>
      )}
      <View style={{ height: 8 }} />
    </ScrollView>
  );
}

function OwnerSectionEditor({
  section,
  templates,
  onAdd,
  onRemove,
}: {
  section: TaskSection;
  templates: TaskTemplate[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const label = SECTION_LABEL[section];

  function add() {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText('');
  }

  return (
    <View style={styles.editorGroup}>
      <Text style={styles.editorLabel}>{label}</Text>
      {templates.map((t) => (
        <View key={t.id} style={styles.editorRow}>
          <Text style={styles.editorText} numberOfLines={1}>
            {t.text}
          </Text>
          <Pressable onPress={() => onRemove(t.id)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.5 }]}>
            <Ionicons name="close" size={18} color={InkColors.ink3} />
          </Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <Ionicons name="add" size={18} color={InkColors.ink3} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={`${label} 항목 추가`}
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
    </View>
  );
}

// ── 공용: 이모지 리액션 바 ───────────────────────────────────
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
      {chips.map(([emoji, who]) => (
        <Text key={`who-${emoji}`} style={styles.reactWho}>
          {emoji} {who.map((id) => (id === me ? '나' : nameOf(id))).join(', ')}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },

  chatScroll: { padding: 16, gap: 12 },
  noticeScroll: { padding: 16, gap: 12 },
  todoScroll: { padding: 16, gap: 14 },

  streamEmpty: { fontSize: 13, color: InkColors.ink3, textAlign: 'center', paddingVertical: 20 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: InkColors.line },
  dividerText: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { fontSize: 13, color: InkColors.ink3, fontWeight: '500' },

  // 메시지 말풍선
  msgRow: { gap: 3, alignItems: 'flex-start' },
  msgAuthor: { fontSize: 11, color: InkColors.ink3, fontWeight: '600', marginLeft: 2 },
  msgBubbleWrap: { maxWidth: '82%', gap: 3 },
  msgBubble: {
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
  toTaskBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', paddingVertical: 2 },
  toTaskText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },

  // 입력바 (채팅·공지 공용)
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

  // 공지 카드
  notice: {
    backgroundColor: BrandColors.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBD3CD',
    padding: 14,
    gap: 8,
  },
  noticePinned: { borderColor: BrandColors.accent, borderWidth: 1.5 },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noticeAuthor: { fontSize: 12, fontWeight: '800', color: BrandColors.accent },
  noticeTime: { fontSize: 11, color: InkColors.ink3, marginLeft: 'auto' },
  noticeText: { fontSize: 15, color: InkColors.ink, lineHeight: 21 },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readText: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },

  // 할일 관리(사장)
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  uploadingText: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  manageWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
    gap: 12,
  },
  manageTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  editorGroup: { gap: 4 },
  editorLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  editorText: { flex: 1, fontSize: 14, color: InkColors.ink },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  addInput: { flex: 1, fontSize: 14, color: InkColors.ink, paddingVertical: 2 },
  addBtn: { fontSize: 14, fontWeight: '800', color: BrandColors.brand },

  // 리액션
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
});
