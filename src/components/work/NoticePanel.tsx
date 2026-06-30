import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { type FeedItem } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { mdHHmm } from '@/lib/utils/attendance';
import { ReactionBar } from './ReactionBar';
import { MentionInput, extractMentions, type Member } from './MentionInput';
import { Appear } from '@/components/Appear';

/**
 * NoticePanel — 우상단 [공지]로 진입하는 전용 화면.
 *  사장: 작성(하단 고정)·고정/해제·수정·삭제 + 누가 읽었는지 확인 + 댓글
 *  알바: 읽기 + 읽음(자동) + 반응 + 댓글(내 댓글만 삭제)
 */
export function NoticePanel({
  notices,
  comments,
  isOwner,
  me,
  memberCount,
  nameOf,
  members,
  onBack,
  onPost,
  onTogglePin,
  onEdit,
  onDelete,
  onReact,
  onRead,
  onComment,
  onDeleteComment,
}: {
  notices: FeedItem[];
  comments: FeedItem[];
  isOwner: boolean;
  me: string;
  memberCount: number;
  nameOf: (id: string) => string;
  members: Member[];
  onBack: () => void;
  onPost: (text: string) => void;
  onTogglePin: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onRead: (id: string) => void;
  onComment: (noticeId: string, text: string, mentions: string[]) => void;
  onDeleteComment: (id: string) => void;
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
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {notices.length === 0 && (
          <Text style={s.empty}>{isOwner ? '아직 공지가 없어요. 아래에 첫 공지를 적어보세요.' : '아직 공지가 없어요.'}</Text>
        )}
        {notices.map((n, i) => (
          <Appear key={n.id} delay={Math.min(i * 60, 240)}>
          <NoticeCard
            notice={n}
            comments={comments.filter((c) => c.refId === n.id)}
            isOwner={isOwner}
            me={me}
            memberCount={memberCount}
            nameOf={nameOf}
            members={members}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onDelete={onDelete}
            onReact={onReact}
            onRead={onRead}
            onComment={onComment}
            onDeleteComment={onDeleteComment}
          />
          </Appear>
        ))}
        <View style={{ height: 8 }} />
      </ScrollView>

      {isOwner && (
        <View style={s.foot}>
          <Ionicons name="megaphone-outline" size={18} color={InkColors.ink2} style={{ marginLeft: 4 }} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="새 공지 작성…"
            placeholderTextColor={InkColors.ink3}
            style={s.footInput}
            onSubmitEditing={post}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable onPress={post} disabled={!draft.trim()} style={({ pressed }) => [s.footBtn, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Text style={s.footBtnText}>등록</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function NoticeCard({
  notice: n,
  comments,
  isOwner,
  me,
  memberCount,
  nameOf,
  members,
  onTogglePin,
  onEdit,
  onDelete,
  onReact,
  onRead,
  onComment,
  onDeleteComment,
}: {
  notice: FeedItem;
  comments: FeedItem[];
  isOwner: boolean;
  me: string;
  memberCount: number;
  nameOf: (id: string) => string;
  members: Member[];
  onTogglePin: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onRead: (id: string) => void;
  onComment: (noticeId: string, text: string, mentions: string[]) => void;
  onDeleteComment: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(n.text);
  const [cDraft, setCDraft] = useState('');
  const readBy = n.read_by ?? [];
  const readCount = Math.min(readBy.length, memberCount);
  const read = readBy.includes(me);

  // 알바가 카드를 보면 읽음 처리(한 번).
  useEffect(() => {
    if (!isOwner && !read) onRead(n.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id]);

  function saveEdit() {
    const v = editText.trim();
    if (v && v !== n.text) onEdit(n.id, v);
    setEditing(false);
  }
  function postComment() {
    const v = cDraft.trim();
    if (!v) return;
    onComment(n.id, v, extractMentions(v, members));
    setCDraft('');
  }

  return (
    <View style={[s.card, n.pinned && s.cardPinned]}>
      <View style={s.head}>
        <Text style={s.tag}>공지</Text>
        {n.pinned && <Text style={s.pinlab}>📌 고정됨</Text>}
        <Text style={s.who}>{n.authorName}</Text>
        <Text style={s.time}>{mdHHmm(n.createdAt)}</Text>
      </View>

      {editing ? (
        <View>
          <TextInput value={editText} onChangeText={setEditText} style={s.editInput} multiline />
          <View style={s.editActions}>
            <Pressable onPress={() => setEditing(false)}><Text style={s.editCancel}>취소</Text></Pressable>
            <Pressable onPress={saveEdit}><Text style={s.editSave}>저장</Text></Pressable>
          </View>
        </View>
      ) : (
        <Text style={s.body}>{n.text}</Text>
      )}

      <View style={s.foot2}>
        {isOwner ? (
          <View style={s.readRow}>
            <Ionicons name="checkmark-done" size={13} color={InkColors.ink3} />
            <Text style={s.readText}>{readCount}/{memberCount}명 읽음</Text>
          </View>
        ) : read ? (
          <View style={s.readRow}>
            <Ionicons name="checkmark-done" size={13} color={BrandColors.good} />
            <Text style={[s.readText, { color: BrandColors.good }]}>읽음</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        {isOwner && (
          <View style={s.acts}>
            <Pressable onPress={() => onTogglePin(n.id)} style={({ pressed }) => [s.act, n.pinned && s.actOn, pressed && { opacity: 0.6 }]}>
              <Text style={[s.actText, n.pinned && { color: '#fff' }]}>{n.pinned ? '고정해제' : '고정'}</Text>
            </Pressable>
            <Pressable onPress={() => { setEditText(n.text); setEditing(true); }} style={({ pressed }) => [s.act, pressed && { opacity: 0.6 }]}>
              <Text style={s.actText}>수정</Text>
            </Pressable>
            <Pressable onPress={() => onDelete(n.id)} style={({ pressed }) => [s.act, pressed && { opacity: 0.6 }]}>
              <Text style={[s.actText, { color: BrandColors.bad }]}>삭제</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ReactionBar reactions={n.reactions} me={me} nameOf={nameOf} onReact={(e) => onReact(n.id, e)} />

      {/* 댓글 */}
      <View style={s.comments}>
        <Text style={s.cLabel}>댓글 {comments.length}</Text>
        {comments.map((c) => {
          const canDelete = c.authorId === me || isOwner;
          return (
            <View key={c.id} style={s.cmt}>
              <View style={s.cAv}><Text style={s.cAvTx}>{c.authorName.slice(-2)}</Text></View>
              <View style={s.cBubble}>
                <Text style={s.cName}>{c.authorName}{c.authorId === me ? ' (나)' : ''}</Text>
                <Text style={s.cText}>{c.text}</Text>
              </View>
              {canDelete && (
                <Pressable onPress={() => onDeleteComment(c.id)} hitSlop={6}>
                  <Text style={s.cDel}>삭제</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        <View style={s.cInputRow}>
          <View style={{ flex: 1 }}>
            <MentionInput value={cDraft} onChangeText={setCDraft} onSubmit={postComment} members={members} placeholder="댓글 달기…" style={s.cInput} />
          </View>
          <Pressable onPress={postComment} disabled={!cDraft.trim()} style={({ pressed }) => [s.cPost, !cDraft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
            <Text style={s.cPostText}>등록</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 13, gap: 11 },
  empty: { textAlign: 'center', color: InkColors.ink3, fontSize: 13, marginTop: 40 },

  card: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 12, ...Elevation.e1 },
  cardPinned: { borderColor: InkColors.ink3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  tag: { backgroundColor: InkColors.paper, color: InkColors.ink2, fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  pinlab: { fontSize: 10, color: InkColors.ink3, fontWeight: '700' },
  who: { fontSize: 11, color: InkColors.ink2, fontWeight: '700', marginLeft: 'auto' },
  time: { fontSize: 10, color: InkColors.ink3 },
  body: { fontSize: 14, fontWeight: '600', color: InkColors.ink, lineHeight: 21 },

  editInput: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, padding: 10, fontSize: 14, color: InkColors.ink, backgroundColor: InkColors.cream, minHeight: 60 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 },
  editCancel: { fontSize: 13, fontWeight: '700', color: InkColors.ink3 },
  editSave: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  foot2: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: InkColors.line },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readText: { fontSize: 11, color: InkColors.ink2, fontWeight: '700' },
  acts: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  act: { borderWidth: 1, borderColor: InkColors.line, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: InkColors.bg },
  actOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  actText: { fontSize: 11, fontWeight: '700', color: InkColors.ink2 },

  comments: { marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: InkColors.line, gap: 8 },
  cLabel: { fontSize: 10.5, fontWeight: '800', color: InkColors.ink3 },
  cmt: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  cAv: { width: 23, height: 23, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  cAvTx: { fontSize: 9, fontWeight: '800', color: InkColors.ink2 },
  cBubble: { flex: 1, backgroundColor: InkColors.paper, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 7 },
  cName: { fontSize: 10.5, fontWeight: '800', color: InkColors.ink2, marginBottom: 2 },
  cText: { fontSize: 12.5, color: InkColors.ink },
  cDel: { fontSize: 11, color: BrandColors.bad, fontWeight: '700', padding: 3 },
  cInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cInput: { paddingVertical: 8, fontSize: 12 },
  cPost: { backgroundColor: InkColors.ink, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  cPostText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: InkColors.cream, borderTopWidth: 1, borderTopColor: InkColors.line },
  footInput: { flex: 1, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 15, paddingVertical: 11, fontSize: 13, color: InkColors.ink },
  footBtn: { backgroundColor: InkColors.ink, borderRadius: Radius.pill, paddingHorizontal: 18, paddingVertical: 11 },
  footBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
