import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { uploadPhoto } from '@/lib/db';
import { HAS_SUPABASE } from '@/lib/supabase';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useWorkStore, findDuplicateTask, type NewTask } from '@/lib/store/useWorkStore';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { RoleTabBar } from '@/components/RoleTabBar';
import { useRoomStore } from '@/lib/store/useRoomStore';
import { WorkChat } from '@/components/work/WorkChat';
import { RoomBar } from '@/components/work/RoomBar';
import { NoticePanel } from '@/components/work/NoticePanel';
import { TodoScreen } from '@/components/work/TodoScreen';
import { TaskComposerModal } from '@/components/work/TaskComposerModal';
import { type Member } from '@/components/work/MentionInput';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER } from '@/lib/theme/layout';
import { todayStr } from '@/lib/utils/attendance';

type ViewKey = 'chat' | 'notice' | 'todo';

/** 웹 파일 선택 → File 반환(네이티브는 추후 image-picker). */
function pickImageFile(onPick: (file: File) => void) {
  if (Platform.OS !== 'web') return;
  const g = globalThis as unknown as { document?: Document };
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

/**
 * WorkBoard — 업무 탭. 단일 스트림 채팅(기본) + 우상단 nav로 공지/할일 전환.
 *  - 채팅(WorkChat): 대화 + 완료알림 + @멘션 + ＋메뉴
 *  - 공지(NoticePanel): 작성·고정·수정·삭제(사장) / 읽기·댓글(공통)
 *  - 할일(TodoScreen): 접이식 캘린더 + 데이파트 그룹 + 개인/가게 색
 *  - 할일 추가(TaskComposerModal): 시트 고정 + 내부 스크롤
 */
export function WorkBoard({ role }: { role: 'owner' | 'junior' }) {
  const userId = useSessionStore((s) => s.userId);
  const userName = useSessionStore((s) => s.userName);
  const isOwner = role === 'owner';

  const owner = useStaffStore((s) => s.owner);
  const staff = useStaffStore((s) => s.staff);

  const templates = useWorkStore((s) => s.templates);
  const done = useWorkStore((s) => s.done);
  const feed = useWorkStore((s) => s.feed);
  const toggleTask = useWorkStore((s) => s.toggleTask);
  const addTask = useWorkStore((s) => s.addTask);
  const removeTemplate = useWorkStore((s) => s.removeTemplate);
  const postNotice = useWorkStore((s) => s.postNotice);
  const postMessage = useWorkStore((s) => s.postMessage);
  const postComment = useWorkStore((s) => s.postComment);
  const editFeedText = useWorkStore((s) => s.editFeedText);
  const deleteFeedItem = useWorkStore((s) => s.deleteFeedItem);
  const toggleReaction = useWorkStore((s) => s.toggleReaction);
  const togglePin = useWorkStore((s) => s.togglePin);
  const markNoticeRead = useWorkStore((s) => s.markNoticeRead);
  const noteError = useSyncStore((s) => s.noteError);

  // 채팅방('전부 방 단위') — 활성 방 기준으로 대화·공지·할일을 거른다.
  const currentRoomId = useRoomStore((s) => s.currentRoomId);
  const rooms = useRoomStore((s) => s.rooms);
  useEffect(() => {
    useRoomStore.getState().hydrate();
    const off = useRoomStore.getState().subscribe();
    // mock 신규 매장: 사장이 들어오면 기본방을 보장(Supabase는 hydrate가 자가치유).
    if (!HAS_SUPABASE && isOwner) useRoomStore.getState().ensureDefaultRoom();
    return off;
  }, [isOwner]);
  const isDefaultRoom = useMemo(() => !!rooms.find((r) => r.id === currentRoomId)?.isDefault, [rooms, currentRoomId]);
  // 방이 없으면(레거시/신규 degraded) 전부 통과 = 단일 스트림. 기본방이면 미지정(레거시) 항목도 포함.
  const inRoom = useCallback(
    (rid?: string) => (!currentRoomId ? true : (rid ?? (isDefaultRoom ? currentRoomId : '__none')) === currentRoomId),
    [currentRoomId, isDefaultRoom],
  );

  // 다른 화면(홈 '오늘 할일'·'안 읽은 공지' 등)에서 ?view=todo|notice 로 들어오면 해당 패널을 연다.
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const initialView: ViewKey = viewParam === 'todo' || viewParam === 'notice' ? viewParam : 'chat';

  const today = todayStr();
  const [view, setView] = useState<ViewKey>(initialView);
  useEffect(() => {
    if (viewParam === 'todo' || viewParam === 'notice') setView(viewParam);
  }, [viewParam]);
  const [composer, setComposer] = useState<{ open: boolean; date?: string; text?: string; assigneeId?: string }>({ open: false });
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // 멤버(멘션·이름) — 사장 + 직원 + 본인.
  const members: Member[] = useMemo(() => {
    const m: Member[] = [];
    if (owner) m.push({ id: owner.id, name: owner.name, role: 'owner' });
    staff.forEach((s) => m.push({ id: s.id, name: s.name, role: 'junior' }));
    if (userId && !m.some((x) => x.id === userId)) m.push({ id: userId, name: userName, role });
    return m;
  }, [owner, staff, userId, userName, role]);

  const nameOf = useMemo(() => {
    const map: Record<string, string> = {};
    members.forEach((m) => (map[m.id] = m.name));
    return (id: string) => map[id] ?? '직원';
  }, [members]);

  const memberCount = Math.max(1, (owner ? 1 : 0) + staff.length);

  const stream = useMemo(
    () => feed.filter((f) => (f.kind === 'message' || f.kind === 'task_done') && inRoom(f.roomId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [feed, inRoom],
  );
  const notices = useMemo(
    () =>
      feed
        .filter((f) => f.kind === 'notice' && inRoom(f.roomId))
        .sort((a, b) => {
          if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
    [feed, inRoom],
  );
  const comments = useMemo(() => feed.filter((f) => f.kind === 'comment'), [feed]);
  // 현재 방의 할일 — TodoScreen·중복검사 모두 방 단위로.
  const roomTemplates = useMemo(() => templates.filter((t) => inRoom(t.roomId)), [templates, inRoom]);
  const pinnedNotice = useMemo(() => notices.find((n) => n.pinned), [notices]);
  const unreadNotices = isOwner ? 0 : notices.filter((n) => !(n.read_by ?? []).includes(userId)).length;

  // 메시지를 할일로 — 멘션된 직원이 있으면(나 제외) 그 직원에게 배정한 채 컴포저를 연다.
  // (사장만 배정 가능. 알바는 본인 개인 할일로.)
  function messageToTask(text: string, mentions?: string[]) {
    const v = text.trim();
    if (!v) return;
    const assigneeId = isOwner
      ? (mentions ?? []).find((id) => id !== userId && members.some((m) => m.id === id && m.id !== owner?.id))
      : undefined;
    setComposer({ open: true, date: today, text: v, assigneeId });
  }

  function attachPhoto(templateId: string, date: string) {
    if (uploadingId) return;
    pickImageFile(async (file) => {
      setUploadingId(templateId);
      try {
        const url = await uploadPhoto(file);
        if (url) {
          if (!(done[date] ?? {})[templateId]) toggleTask(date, templateId, userId, userName, role, url);
        } else {
          noteError('사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
        }
      } catch {
        noteError('사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      } finally {
        setUploadingId(null);
      }
    });
  }

  const headerOptions =
    view === 'chat'
      ? {
          // 탭 루트(뒤로가기 없음) — 네이티브 타이틀 앵커(~17px)를 콘텐츠 거터(20)로 맞춰
          // 우측 액션(공지/할일, 20)과 좌우 대칭. paddingLeft 3 = 20-17.
          headerTitleAlign: 'left' as const,
          headerTitle: () => <Text style={st.headerTitle}>업무</Text>,
          headerRight: () => (
            <View style={st.nav}>
              <Pressable onPress={() => setView('notice')} style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="megaphone-outline" size={15} color={InkColors.ink} />
                <Text style={st.navText}>공지</Text>
                {unreadNotices > 0 && <View style={st.dot} />}
              </Pressable>
              <Pressable onPress={() => setView('todo')} style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="checkbox-outline" size={15} color={InkColors.ink} />
                <Text style={st.navText}>할일</Text>
              </Pressable>
            </View>
          ),
        }
      : {
          title: view === 'notice' ? '공지' : '할일',
          headerLeft: () => (
            <Pressable onPress={() => setView('chat')} hitSlop={8} style={({ pressed }) => [{ paddingLeft: HEADER_EDGE_GUTTER, paddingRight: 14, paddingVertical: 4 }, pressed && { opacity: 0.6 }]}>
              <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
            </Pressable>
          ),
        };

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={headerOptions} />

      {view === 'chat' && <RoomBar role={role} me={userId} />}

      {view === 'chat' && (
        <WorkChat
          stream={stream}
          today={today}
          me={userId}
          nameOf={nameOf}
          members={members}
          isOwner={isOwner}
          pinnedNotice={pinnedNotice}
          onOpenNotice={() => setView('notice')}
          onSend={(text, mentions) => postMessage(today, text, userId, userName, role, mentions)}
          onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
          onMessageToTask={messageToTask}
          onAddTask={() => setComposer({ open: true, date: today })}
          onAssignTask={(id) => setComposer({ open: true, date: today, assigneeId: id })}
          onWriteNotice={() => setView('notice')}
        />
      )}

      {view === 'notice' && (
        <NoticePanel
          notices={notices}
          comments={comments}
          isOwner={isOwner}
          me={userId}
          memberCount={memberCount}
          nameOf={nameOf}
          members={members}
          onBack={() => setView('chat')}
          onPost={(text) => postNotice(today, text, userId, userName, false)}
          onTogglePin={togglePin}
          onEdit={editFeedText}
          onDelete={deleteFeedItem}
          onReact={(id, emoji) => toggleReaction(id, userId, emoji)}
          onRead={(id) => markNoticeRead(id, userId)}
          onComment={(noticeId, text, mentions) => postComment(noticeId, today, text, userId, userName, role, mentions)}
          onDeleteComment={deleteFeedItem}
        />
      )}

      {view === 'todo' && (
        <TodoScreen
          templates={roomTemplates}
          done={done}
          today={today}
          isOwner={isOwner}
          me={userId}
          nameOf={nameOf}
          uploadingId={uploadingId}
          onToggle={(templateId, date) => toggleTask(date, templateId, userId, userName, role)}
          onAttachPhoto={(templateId, date) => attachPhoto(templateId, date)}
          onAddForDate={(date) => setComposer({ open: true, date })}
          onRemove={removeTemplate}
        />
      )}

      {composer.open && (
        <TaskComposerModal
          onClose={() => setComposer({ open: false })}
          onSubmit={(input: NewTask) => {
            addTask(input);
            showToast('할일에 추가했어요', 'good');
          }}
          isDuplicate={(input: NewTask) => !!findDuplicateTask(roomTemplates, input)}
          isOwner={isOwner}
          me={userId}
          today={today}
          initialDate={composer.date}
          initialText={composer.text}
          initialAssigneeId={composer.assigneeId}
          members={members}
        />
      )}

      <RoleTabBar role={role} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  headerTitle: { paddingLeft: 3, fontSize: 16, fontWeight: '800', color: InkColors.ink },
  nav: { flexDirection: 'row', gap: 6, paddingRight: HEADER_EDGE_GUTTER },
  // 헤더 액션 칩 — 클린 헤더(벨·뒤로가기)와 같은 계열로 가볍게(무거운 보더 제거, 서브틀 필).
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 11, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },
  navText: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink },
  dot: { position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: 99, backgroundColor: BrandColors.bad },
});
