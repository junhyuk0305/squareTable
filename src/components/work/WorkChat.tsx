import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { type FeedItem } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { hhmm } from '@/lib/utils/attendance';
import { ReactionBar } from './ReactionBar';
import { MentionInput, extractMentions, type Member } from './MentionInput';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}

/** @멘션 토큰을 강조 렌더. mine이면 검정 말풍선이라 노랑으로. */
function MentionText({ text, members, mine }: { text: string; members: Member[]; mine: boolean }) {
  const names = useMemo(() => [...members.map((m) => m.name), '전체'].sort((a, b) => b.length - a.length), [members]);
  const parts = useMemo(() => {
    if (names.length === 0) return [{ t: text, m: false }];
    const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${esc.join('|')})`, 'g');
    const out: { t: string; m: boolean }[] = [];
    let last = 0;
    let mt: RegExpExecArray | null;
    while ((mt = re.exec(text))) {
      if (mt.index > last) out.push({ t: text.slice(last, mt.index), m: false });
      out.push({ t: mt[0], m: true });
      last = mt.index + mt[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last), m: false });
    return out;
  }, [text, names]);

  return (
    <Text style={[s.msgText, mine && { color: '#FFFFFF' }]}>
      {parts.map((p, i) =>
        p.m ? (
          <Text key={i} style={[s.mention, mine && s.mentionMine]}>
            {p.t}
          </Text>
        ) : (
          <Text key={i}>{p.t}</Text>
        ),
      )}
    </Text>
  );
}

/**
 * WorkChat — 업무 탭 단일 스트림(슬랙식). 대화(message)+완료알림(task_done)만 흐른다.
 * 공지/할일은 우상단 nav로 분리(WorkBoard). 상단 슬림 핀 공지 1줄, + 메뉴, @멘션.
 */
export function WorkChat({
  stream,
  today,
  me,
  nameOf,
  members,
  isOwner,
  pinnedNotice,
  onOpenNotice,
  onSend,
  onReact,
  onMessageToTask,
  onAddTask,
  onWriteNotice,
}: {
  stream: FeedItem[];
  today: string;
  me: string;
  nameOf: (id: string) => string;
  members: Member[];
  isOwner: boolean;
  pinnedNotice?: FeedItem;
  onOpenNotice: () => void;
  onSend: (text: string, mentions: string[]) => void;
  onReact: (id: string, emoji: string) => void;
  onMessageToTask: (text: string, mentions?: string[]) => void;
  onAddTask: () => void;
  onWriteNotice: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
  }, [stream.length]);

  function send() {
    const v = draft.trim();
    if (!v) return;
    onSend(v, extractMentions(v, members));
    setDraft('');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 슬림 고정 공지 1줄 */}
      {pinnedNotice && (
        <Pressable onPress={onOpenNotice} style={({ pressed }) => [s.pinbar, pressed && { opacity: 0.7 }]}>
          <Ionicons name="pin" size={13} color={InkColors.ink2} />
          <Text style={s.pinTag}>공지</Text>
          <Text style={s.pinTxt} numberOfLines={1}>
            {pinnedNotice.text}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} />
        </Pressable>
      )}

      <ScrollView ref={scrollRef} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {stream.length === 0 && <Text style={s.empty}>아직 대화가 없어요. 첫 메시지를 남겨보세요.</Text>}
        {stream.map((f, i) => {
          const prev = stream[i - 1];
          const showDivider = !prev || prev.date !== f.date;
          return (
            <View key={f.id}>
              {showDivider && (
                <View style={s.divider}>
                  <Text style={s.dividerText}>{dateLabel(f.date, today)}</Text>
                </View>
              )}
              <FeedRow item={f} me={me} nameOf={nameOf} members={members} onReact={(e) => onReact(f.id, e)} onToTask={f.kind === 'message' ? () => onMessageToTask(f.text, f.mentions) : undefined} />
            </View>
          );
        })}
        <View style={{ height: 8 }} />
      </ScrollView>

      {/* + 메뉴 */}
      {menu && (
        <>
          <Pressable style={s.menuBackdrop} onPress={() => setMenu(false)} />
          <View style={s.menu}>
            <MenuItem icon="checkmark-circle-outline" label="할일 추가" sub={isOwner ? '가게 전체 / 나만 보기' : '나만 보기'} onPress={() => { setMenu(false); onAddTask(); }} />
            <MenuItem icon="image-outline" label="사진 보내기" sub="곧 추가돼요" onPress={() => setMenu(false)} />
            {isOwner && <MenuItem icon="megaphone-outline" label="공지 작성" sub="사장만" onPress={() => { setMenu(false); onWriteNotice(); }} top />}
          </View>
        </>
      )}

      <View style={s.composer}>
        <Pressable onPress={() => setMenu((v) => !v)} style={({ pressed }) => [s.plus, pressed && { opacity: 0.85 }]}>
          <Ionicons name={menu ? 'close' : 'add'} size={24} color="#FFFFFF" />
        </Pressable>
        <MentionInput value={draft} onChangeText={setDraft} onSubmit={send} members={members} />
        <Pressable onPress={send} disabled={!draft.trim()} style={({ pressed }) => [s.send, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
          <Ionicons name="arrow-up" size={20} color={InkColors.ink} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MenuItem({ icon, label, sub, onPress, top }: { icon: any; label: string; sub: string; onPress: () => void; top?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.mi, top && s.miTop, pressed && { backgroundColor: InkColors.paper }]}>
      <View style={s.miIc}>
        <Ionicons name={icon} size={16} color={InkColors.ink} />
      </View>
      <View>
        <Text style={s.miLabel}>{label}</Text>
        <Text style={s.miSub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function FeedRow({ item, me, nameOf, members, onReact, onToTask }: { item: FeedItem; me: string; nameOf: (id: string) => string; members: Member[]; onReact: (e: string) => void; onToTask?: () => void }) {
  if (item.kind === 'task_done') {
    return (
      <View style={s.doneRow}>
        <Ionicons name="checkmark-circle" size={15} color={BrandColors.good} />
        <Text style={s.doneText}>
          {item.text} · {hhmm(item.createdAt)}
        </Text>
      </View>
    );
  }
  const mine = item.authorId === me;
  return (
    <View style={[s.msgRow, mine ? s.msgRowMine : s.msgRowOther]}>
      {!mine && <Text style={s.msgAuthor}>{item.authorName}</Text>}
      <Pressable onLongPress={onToTask} delayLongPress={350} style={[s.bubble, mine && s.bubbleMine]}>
        <MentionText text={item.text} members={members} mine={mine} />
      </Pressable>
      {onToTask && (
        <Pressable onPress={onToTask} hitSlop={6} style={({ pressed }) => [s.toTask, pressed && { opacity: 0.6 }]}>
          <Ionicons name="add-circle-outline" size={13} color={InkColors.ink3} />
          <Text style={s.toTaskText}>할일로</Text>
        </Pressable>
      )}
      <View style={mine ? { alignItems: 'flex-end' } : undefined}>
        <ReactionBar reactions={item.reactions} me={me} nameOf={nameOf} onReact={onReact} />
      </View>
      <Text style={s.msgTime}>{hhmm(item.createdAt)}{mine ? ` · ${item.authorName}` : ''}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pinbar: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: InkColors.bg, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  pinTag: { backgroundColor: InkColors.paper, color: InkColors.ink2, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },
  pinTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: InkColors.ink },

  scroll: { padding: 12, gap: 11 },
  empty: { textAlign: 'center', color: InkColors.ink3, fontSize: 13, marginTop: 40 },
  divider: { alignItems: 'center', marginVertical: 2 },
  dividerText: { fontSize: 11, color: InkColors.ink3, fontWeight: '700', backgroundColor: '#ffffff9c', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 99 },

  doneRow: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: InkColors.cream, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: InkColors.line, borderStyle: 'dashed', maxWidth: '92%' },
  doneText: { fontSize: 12, color: InkColors.ink2, fontWeight: '600' },

  // maxWidth 만 주고 alignSelf 를 안 주면 부모(스트림)가 stretch 로 행을 왼쪽에 고정해
  // 내 메시지가 프레임 오른쪽 끝까지 못 가고 가운데로 밀린다. 행 자체를 좌/우로 붙인다.
  msgRow: { maxWidth: '82%', gap: 3 },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowOther: { alignSelf: 'flex-start' },
  msgAuthor: { fontSize: 11, color: InkColors.ink2, fontWeight: '700', paddingLeft: 4 },
  bubble: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: 15, borderTopLeftRadius: 5, paddingHorizontal: 12, paddingVertical: 9, ...Elevation.e1 },
  bubbleMine: { backgroundColor: InkColors.ink, borderColor: InkColors.ink, borderTopLeftRadius: 15, borderTopRightRadius: 5, alignSelf: 'flex-end' },
  msgText: { fontSize: 14, color: InkColors.ink, lineHeight: 21 },
  mention: { color: '#2f6fd6', fontWeight: '800' },
  mentionMine: { color: BrandColors.yellow },
  toTask: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 4 },
  toTaskText: { fontSize: 11, color: InkColors.ink3, fontWeight: '700' },
  msgTime: { fontSize: 10, color: InkColors.ink3, paddingHorizontal: 4 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: InkColors.cream, borderTopWidth: 1, borderTopColor: InkColors.line },
  plus: { width: 38, height: 38, borderRadius: 12, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  send: { width: 38, height: 38, borderRadius: 99, backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep, alignItems: 'center', justifyContent: 'center' },

  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menu: { position: 'absolute', left: 12, bottom: 64, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 6, width: 220, ...Elevation.e3 },
  mi: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: Radius.sm },
  miTop: { borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: 3, paddingTop: 12 },
  miIc: { width: 30, height: 30, borderRadius: 9, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  miLabel: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  miSub: { fontSize: 10.5, color: InkColors.ink3 },
});
