import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Modal, Platform, StyleSheet } from 'react-native';
import { StoredImage } from '@/components/StoredImage';
import { Ionicons } from '@expo/vector-icons';

import { type FeedItem } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';
import { hhmm } from '@/lib/utils/attendance';
import { ReactionBar } from './ReactionBar';
import { MentionInput, extractMentions, type Member } from './MentionInput';
import { Appear } from '@/components/Appear';
import { InfoDot } from '@/components/InfoDot';
import { PHOTO_UPLOAD_INFO } from '@/lib/copy/photoUploadInfo';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
function dateLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}

/** @멘션 토큰을 강조 렌더. mine이면 검정 말풍선이라 노랑으로.
 *  memo — 부모(FeedRow/스트림)가 무관한 이유로 재렌더돼도, props(text·members·mine) 불변이면
 *  멤버 수에 비례하는 정규식 재계산을 건너뛴다(채팅 길어질수록 효과). */
const MentionText = memo(function MentionText({ text, members, mine }: { text: string; members: Member[]; mine: boolean }) {
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
    <Text style={[s.msgText, mine && { color: InkColors.bubbleText }]}>
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
});

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
  onSendPhoto,
  sendingPhoto,
  onReact,
  onMessageToTask,
  onDelete,
  onAddTask,
  onAssignTask,
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
  /** ＋메뉴 '사진 보내기' — 픽·업로드·발행은 부모(WorkBoard)가 처리. */
  onSendPhoto: () => void;
  sendingPhoto?: boolean;
  onReact: (id: string, emoji: string) => void;
  onMessageToTask: (text: string, mentions?: string[]) => void;
  /** 메시지 삭제 — 권한(본인 or 사장)은 여기서 게이팅, 백엔드 RLS(wf_delete)도 같은 매장·방만 허용. */
  onDelete: (id: string) => void;
  onAddTask: () => void;
  /** 사장: @리스트에서 직원에게 바로 할일 배정(그 직원 담당 모달 오픈). */
  onAssignTask?: (memberId: string) => void;
  onWriteNotice: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  // 롱프레스로 연 메시지 액션 시트(할일로/삭제). null이면 닫힘.
  const [actionItem, setActionItem] = useState<FeedItem | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const canDeleteActive = !!actionItem && (actionItem.authorId === me || isOwner);
  const canTaskActive = !!actionItem && !!actionItem.text.trim();

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
              <Appear>
                <FeedRow
                  item={f}
                  me={me}
                  nameOf={nameOf}
                  members={members}
                  onReact={(e) => onReact(f.id, e)}
                  onToTask={f.kind === 'message' && f.text.trim() ? () => onMessageToTask(f.text, f.mentions) : undefined}
                  onLongPress={f.kind === 'message' ? () => setActionItem(f) : undefined}
                />
              </Appear>
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
            <MenuItem icon="image-outline" label="사진 보내기" sub={sendingPhoto ? '올리는 중…' : '이미지 첨부'} onPress={() => { setMenu(false); onSendPhoto(); }} />
            {isOwner && <MenuItem icon="megaphone-outline" label="공지 작성" sub="사장만" onPress={() => { setMenu(false); onWriteNotice(); }} top />}
            <View style={s.menuInfoRow}>
              <Text style={s.menuInfoText}>사진은 자동 압축·EXIF 제거돼요</Text>
              <InfoDot title={PHOTO_UPLOAD_INFO.title} body={PHOTO_UPLOAD_INFO.body} size={14} accessibilityLabel="사진 업로드 규격 안내" />
            </View>
          </View>
        </>
      )}

      <View style={s.composer}>
        <Pressable
          onPress={() => setMenu((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={menu ? '추가 메뉴 닫기' : '추가 메뉴 열기'}
          style={({ pressed }) => [s.plus, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name={menu ? 'close' : 'add'} size={24} color={InkColors.bubbleText} />
        </Pressable>
        <MentionInput value={draft} onChangeText={setDraft} onSubmit={send} members={members} me={me} onAssignTask={isOwner ? onAssignTask : undefined} />
        <Pressable onPress={send} disabled={!draft.trim()} accessibilityRole="button" accessibilityLabel="메시지 전송" style={({ pressed }) => [s.send, !draft.trim() && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
          <Ionicons name="arrow-up" size={20} color={InkColors.ink} />
        </Pressable>
      </View>

      {/* 메시지 롱프레스 액션 시트 — 프레임(460) 안에 가둔다(modalFrameStyle). */}
      <Modal visible={!!actionItem} transparent animationType="slide" onRequestClose={() => setActionItem(null)}>
        <View style={modalFrameStyle}>
          <Pressable style={s.sheetBackdrop} onPress={() => setActionItem(null)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            {canTaskActive && (
              <Pressable
                onPress={() => { const it = actionItem!; setActionItem(null); onMessageToTask(it.text, it.mentions); }}
                style={({ pressed }) => [s.sheetItem, pressed && { backgroundColor: InkColors.paper }]}
              >
                <Ionicons name="add-circle-outline" size={19} color={InkColors.ink} />
                <Text style={s.sheetItemText}>할일로 만들기</Text>
              </Pressable>
            )}
            {canDeleteActive && (
              <Pressable
                onPress={() => { const id = actionItem!.id; setActionItem(null); onDelete(id); }}
                style={({ pressed }) => [s.sheetItem, pressed && { backgroundColor: InkColors.paper }]}
                accessibilityRole="button"
                accessibilityLabel="이 메시지 삭제"
              >
                <Ionicons name="trash-outline" size={19} color={BrandColors.bad} />
                <Text style={[s.sheetItemText, { color: BrandColors.bad }]}>삭제</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setActionItem(null)} style={({ pressed }) => [s.sheetCancel, pressed && { opacity: 0.85 }]}>
              <Text style={s.sheetCancelText}>취소</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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

function FeedRow({ item, me, nameOf, members, onReact, onToTask, onLongPress }: { item: FeedItem; me: string; nameOf: (id: string) => string; members: Member[]; onReact: (e: string) => void; onToTask?: () => void; onLongPress?: () => void }) {
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
  const photo = item.photoUrl;
  const hasText = !!item.text.trim();
  return (
    <View style={[s.msgRow, mine ? s.msgRowMine : s.msgRowOther]}>
      {!mine && <Text style={s.msgAuthor}>{item.authorName}</Text>}
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[s.bubble, mine && s.bubbleMine, photo && s.bubblePhoto]}
      >
        {photo && (
          <StoredImage
            stored={photo}
            style={[s.msgImage, hasText && s.msgImageWithText]}
            resizeMode="cover"
            openOnPress
            accessibilityLabel="사진 크게 보기"
          />
        )}
        {hasText && (
          <View style={photo ? s.msgCaption : undefined}>
            <MentionText text={item.text} members={members} mine={mine} />
          </View>
        )}
      </Pressable>
      {onToTask && (
        <Pressable onPress={onToTask} hitSlop={6} style={({ pressed }) => [s.toTask, pressed && { opacity: 0.6 }]}>
          <Ionicons name="add-circle-outline" size={13} color={InkColors.ink3} />
          <Text style={s.toTaskText}>할일로</Text>
        </Pressable>
      )}
      <View style={mine ? { alignItems: 'flex-end' } : undefined}>
        <ReactionBar reactions={item.reactions} me={me} nameOf={nameOf} onReact={onReact} side={mine ? 'left' : 'right'} />
      </View>
      <Text style={s.msgTime}>{hhmm(item.createdAt)}{mine ? ` · ${item.authorName}` : ''}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pinbar: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: InkColors.bg, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  pinTag: { backgroundColor: InkColors.paper, color: InkColors.ink2, fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.tail },
  pinTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: InkColors.ink },

  // 웹: 말풍선 롱프레스로 액션시트를 여는데, 브라우저가 대신 드래그-선택을 시작해 화면 전체가
  // 선택되는 걸 막는다(스트림 전역 user-select:none). 단, 말풍선 '텍스트'(msgText)만 다시 선택 허용.
  scroll: { padding: 12, gap: 11, ...(Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null) },
  empty: { textAlign: 'center', color: InkColors.ink3, fontSize: 13, marginTop: 40 },
  divider: { alignItems: 'center', marginVertical: 2 },
  dividerText: { fontSize: 11, color: InkColors.ink3, fontWeight: '700', backgroundColor: InkColors.scrim, paddingHorizontal: 12, paddingVertical: 3, borderRadius: Radius.pill },

  doneRow: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: InkColors.cream, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: InkColors.line, borderStyle: 'dashed', maxWidth: '92%' },
  doneText: { fontSize: 12, color: InkColors.ink2, fontWeight: '600' },

  // maxWidth 만 주고 alignSelf 를 안 주면 부모(스트림)가 stretch 로 행을 왼쪽에 고정해
  // 내 메시지가 프레임 오른쪽 끝까지 못 가고 가운데로 밀린다. 행 자체를 좌/우로 붙인다.
  msgRow: { maxWidth: '82%', gap: 3 },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowOther: { alignSelf: 'flex-start' },
  msgAuthor: { fontSize: 11, color: InkColors.ink2, fontWeight: '700', paddingLeft: 4 },
  bubble: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, borderTopLeftRadius: Radius.tail, paddingHorizontal: 12, paddingVertical: 9, ...Elevation.e1 },
  bubbleMine: { backgroundColor: InkColors.ink, borderColor: InkColors.ink, borderTopLeftRadius: Radius.md, borderTopRightRadius: Radius.tail, alignSelf: 'flex-end' },
  bubblePhoto: { padding: 4, overflow: 'hidden' },
  msgImage: { width: 200, height: 200, borderRadius: Radius.sm },
  msgImageWithText: { marginBottom: 6 },
  msgCaption: { paddingHorizontal: 8, paddingBottom: 5, paddingTop: 1 },
  // 스트림 전역 user-select:none 위에서, 말풍선 본문 텍스트만 선택/복사 가능하게 복원(웹).
  msgText: { fontSize: 14, color: InkColors.ink, lineHeight: 21, ...(Platform.OS === 'web' ? ({ userSelect: 'text' } as object) : null) },
  mention: { color: BrandColors.mention, fontWeight: '800' },
  mentionMine: { color: BrandColors.yellow },
  toTask: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 4 },
  toTaskText: { fontSize: 11, color: InkColors.ink3, fontWeight: '700' },
  msgTime: { fontSize: 10, color: InkColors.ink3, paddingHorizontal: 4 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: InkColors.cream, borderTopWidth: 1, borderTopColor: InkColors.line },
  plus: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  send: { width: 38, height: 38, borderRadius: Radius.pill, backgroundColor: BrandColors.yellow, borderWidth: 1, borderColor: BrandColors.yellowDeep, alignItems: 'center', justifyContent: 'center' },

  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menu: { position: 'absolute', left: 12, bottom: 64, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 6, width: 220, ...Elevation.e3 },
  mi: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: Radius.sm },
  miTop: { borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: 3, paddingTop: 12 },
  miIc: { width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  miLabel: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  miSub: { fontSize: 10.5, color: InkColors.ink3 },
  menuInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingTop: 8, paddingBottom: 2, borderTopWidth: 1, borderTopColor: InkColors.line, marginTop: 4 },
  menuInfoText: { flex: 1, fontSize: 10.5, color: InkColors.ink3, fontWeight: '600' },

  // 롱프레스 액션 시트 — 딤 없이 올라오기만(공용 BottomSheet와 동일 규칙: backdrop은 투명 flex:1).
  sheetBackdrop: { flex: 1 },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 24, gap: 4, ...Elevation.e3 },
  sheetHandle: { width: 40, height: 4, borderRadius: Radius.pill, backgroundColor: InkColors.line, alignSelf: 'center', marginBottom: 8 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: Radius.md },
  sheetItemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  sheetCancel: { marginTop: 4, alignItems: 'center', paddingVertical: 13, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  sheetCancelText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
});
