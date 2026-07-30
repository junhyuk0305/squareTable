import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Modal, Platform, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { StoredImage } from '@/components/StoredImage';
import { Ionicons } from '@expo/vector-icons';

import { type FeedItem, REACTIONS } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';
import { hhmm } from '@/lib/utils/attendance';
import { ReactionBar } from './ReactionBar';
import { MentionInput, extractMentions, type Member } from './MentionInput';
import { Appear } from '@/components/Appear';
import { InfoDot } from '@/components/InfoDot';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { appendDictation, buildHints } from '@/lib/voice/text';
import { PHOTO_UPLOAD_INFO } from '@/lib/copy/photoUploadInfo';

// 채팅 윈도잉 — 스트림이 수백~수천 개여도 최근 것만 렌더하고, 위로 스크롤하면 이전 대화를
// 한 페이지씩 붙인다(비가상 ScrollView라 전부 마운트하면 느려지고 @멘션 입력까지 버벅인다).
const CHAT_WINDOW = 40; // 처음 렌더할 최근 말풍선 수
const CHAT_PAGE = 40; // '이전 대화 더보기' 한 번에 늘리는 수

// 받아쓰기 이어붙이기 상한. 타이핑 입력엔 예전부터 상한이 없어 그 동작은 그대로 두고,
// 음성이 채우는 분량만 여기서 자른다(60초 발화 한 번은 넉넉히 들어간다).
const DRAFT_MAX_LEN = 2000;

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
  onMessageToKnowhow,
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
  /** 메시지 → 노하우 승격(사장 전용). 부모(WorkBoard)가 사장일 때만 주입 → coach 발행 플로우로 진입.
   *  owner_answer 해자의 입력 경로 — 채팅에서 답한 실전 Q&A가 증발하지 않고 노하우로 축적된다. */
  onMessageToKnowhow?: (text: string, feedId: string) => void;
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

  // 받아쓰기 힌트 — 멤버 이름. 사람 이름은 사전에 없는 고유명사라 가장 자주 틀린다.
  const voiceHints = useMemo(() => buildHints(members.map((m) => m.name)), [members]);

  const canDeleteActive = !!actionItem && (actionItem.authorId === me || isOwner);
  const canTaskActive = !!actionItem && !!actionItem.text.trim();
  // 노하우 승격은 사장 전용(onMessageToKnowhow 주입 여부로 게이팅) + 텍스트 있고 + 아직 승격 안 된 메시지만.
  const canKnowhowActive = !!actionItem && !!onMessageToKnowhow && !!actionItem.text.trim() && !actionItem.promotedEntryId;

  // ── 윈도잉 페이지네이션 ──────────────────────────────────────────────
  // 최근 visible개만 렌더. 위로 스크롤해 상단에 닿으면 이전 페이지를 붙인다.
  const [visible, setVisible] = useState(CHAT_WINDOW);
  const shown = useMemo(
    () => (stream.length > visible ? stream.slice(stream.length - visible) : stream),
    [stream, visible],
  );
  const hasMore = stream.length > shown.length;

  // 이전 대화를 위로 붙일 때 '보고 있던 말풍선'이 튀지 않게 스크롤 위치를 앵커로 보존한다.
  const anchorRef = useRef<{ y: number; h: number } | null>(null);
  const lastY = useRef(0);
  const contentH = useRef(0);
  const nearBottom = useRef(true); // 하단 근처면 새 메시지에 자동으로 붙어 내려간다.
  // 초기 진입 하단 고정 플래그 — 하단에 실제 도달하기 전까지는 상단 자동 loadMore 를 잠근다.
  // (애니메이션 scrollToEnd 가 y=0에서 출발하며 상단 트리거(y≤40)를 오발 → 앵커 복원이
  //  하단 스크롤을 끊어 중간에 걸리는 레이스 방지. 초기 점프는 무애니메이션이라 구간 자체도 없다.)
  const initialPin = useRef(true);

  const loadMore = useCallback(() => {
    if (stream.length <= visible) return;
    anchorRef.current = { y: lastY.current, h: contentH.current };
    setVisible((v) => Math.min(stream.length, v + CHAT_PAGE));
  }, [stream.length, visible]);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const a = anchorRef.current;
    if (a) {
      // 위로 붙은 만큼(delta)을 더해 스크롤을 내려 시야를 그대로 유지.
      scrollRef.current?.scrollTo({ y: a.y + (h - a.h), animated: false });
      anchorRef.current = null;
    } else if (initialPin.current && h > 0) {
      // 초기 진입: 콘텐츠가 붙는 즉시 무애니메이션으로 하단 점프(카톡·슬랙식).
      scrollRef.current?.scrollTo({ y: h, animated: false });
    }
    contentH.current = h;
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      lastY.current = contentOffset.y;
      contentH.current = contentSize.height;
      nearBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
      // 초기 하단 고정이 끝나기 전(하단 미도달)에는 상단 자동 트리거를 무시한다.
      if (initialPin.current) {
        if (nearBottom.current) initialPin.current = false;
        return;
      }
      if (contentOffset.y <= 40 && hasMore && !anchorRef.current) loadMore();
    },
    [hasMore, loadMore],
  );

  // 새 메시지/최초 로드 시 하단으로. 단, 위로 올려 과거를 읽는 중이면 끌어내리지 않는다.
  // (visible만 늘어나는 '더보기'는 stream.length가 안 변해 여기서 안 걸린다.)
  // 초기 진입 중(initialPin)엔 무애니메이션 — 애니메이션이 y=0에서 출발하며 상단 트리거를 지나는
  // 구간을 만들지 않는다(하단 점프 자체는 onContentSizeChange 가 담당, 여기는 보강).
  useEffect(() => {
    if (!nearBottom.current) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !initialPin.current }), 30);
    return () => clearTimeout(t);
  }, [stream.length]);

  function send() {
    const v = draft.trim();
    if (!v) return;
    nearBottom.current = true; // 내가 보낸 메시지는 항상 하단으로 따라간다.
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

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
      >
        {stream.length === 0 && <Text style={s.empty}>아직 대화가 없어요. 첫 메시지를 남겨보세요.</Text>}
        {hasMore && (
          <Pressable onPress={loadMore} style={({ pressed }) => [s.loadMore, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="이전 대화 더보기">
            <Ionicons name="arrow-up" size={13} color={InkColors.ink3} />
            <Text style={s.loadMoreText}>이전 대화 더보기</Text>
          </Pressable>
        )}
        {shown.map((f, i) => {
          const prev = shown[i - 1];
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
                  onLongPress={f.kind === 'message' ? () => setActionItem(f) : undefined}
                  onPromote={onMessageToKnowhow ? () => onMessageToKnowhow(f.text, f.id) : undefined}
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
            <MenuItem icon="checkmark-circle-outline" label="할일 추가" sub={isOwner ? '매장 전체 / 나만 보기' : '나만 보기'} onPress={() => { setMenu(false); onAddTask(); }} />
            <MenuItem icon="image-outline" label="사진 보내기" sub={sendingPhoto ? '올리는 중…' : '한 번에 최대 10장'} onPress={() => { setMenu(false); onSendPhoto(); }} />
            {isOwner && <MenuItem icon="megaphone-outline" label="공지 작성" sub="사장만" onPress={() => { setMenu(false); onWriteNotice(); }} top />}
            <View style={s.menuInfoRow}>
              <Text style={s.menuInfoText}>사진은 자동으로 압축돼서 올라가요</Text>
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
        {/* 말로 메시지 작성. 멤버 이름을 힌트로 넘겨 이름 오인식을 줄이되, @멘션은 자동으로 붙이지
            않는다 — 잘못 붙은 멘션은 엉뚱한 사람에게 알림이 가고 되돌릴 수 없다(사람이 직접 붙인다). */}
        <VoiceInputButton
          surface="work_chat"
          hints={voiceHints}
          onText={(t) => setDraft((prev) => appendDictation(prev, t, DRAFT_MAX_LEN))}
        />
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
            {/* 리액션 빠른 선택 — 카톡식으로 시트 상단에 이모지 행. 누르면 반영하고 닫힌다. */}
            <View style={s.sheetReactRow}>
              {REACTIONS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => { const id = actionItem!.id; setActionItem(null); onReact(id, e); }}
                  style={({ pressed }) => [s.sheetReact, pressed && { backgroundColor: InkColors.paper }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${e} 리액션`}
                >
                  <Text style={s.sheetReactEmoji}>{e}</Text>
                </Pressable>
              ))}
            </View>
            {canTaskActive && (
              <Pressable
                onPress={() => { const it = actionItem!; setActionItem(null); onMessageToTask(it.text, it.mentions); }}
                style={({ pressed }) => [s.sheetItem, pressed && { backgroundColor: InkColors.paper }]}
              >
                <Ionicons name="add-circle-outline" size={19} color={InkColors.ink} />
                <Text style={s.sheetItemText}>할일로 만들기</Text>
              </Pressable>
            )}
            {canKnowhowActive && (
              <Pressable
                onPress={() => { const it = actionItem!; setActionItem(null); onMessageToKnowhow!(it.text, it.id); }}
                style={({ pressed }) => [s.sheetItem, pressed && { backgroundColor: InkColors.paper }]}
                accessibilityRole="button"
                accessibilityLabel="이 메시지를 노하우로 저장"
              >
                <Ionicons name="bookmark-outline" size={19} color={InkColors.ink} />
                <Text style={s.sheetItemText}>노하우로 저장</Text>
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

function FeedRow({ item, me, nameOf, members, onReact, onLongPress, onPromote }: { item: FeedItem; me: string; nameOf: (id: string) => string; members: Member[]; onReact: (e: string) => void; onLongPress?: () => void; onPromote?: () => void }) {
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
  // 기능2 — ambient 승격 넛지: 내(사장) 답변에 ✅/👍(도움됐다는 신호)가 달리면 "노하우로 저장" 칩을 띄운다.
  // '기록하세요'라고 시키지 않고, 질문이 해결됐다는 신호(리액션)를 트리거로 승격을 제안(onPromote=사장만 주입).
  const resolvedSignal = !!item.reactions && ((item.reactions['✅']?.length ?? 0) > 0 || (item.reactions['👍']?.length ?? 0) > 0);
  const showPromote = !!onPromote && mine && hasText && item.kind === 'message' && resolvedSignal && !item.promotedEntryId;
  // 이미 승격된 내 메시지엔 넛지 대신 정적 확인 표시(사장 시점=onPromote 주입 시).
  const showPromoted = !!onPromote && mine && item.kind === 'message' && !!item.promotedEntryId;
  return (
    <View style={[s.msgRow, mine ? s.msgRowMine : s.msgRowOther]}>
      {!mine && <Text style={s.msgAuthor}>{item.authorName}</Text>}
      {/* 말풍선 + 시간: 시간을 말풍선 옆(하단 baseline)에 인라인으로 붙여 세로 한 줄을 없앤다(카톡식). */}
      <View style={[s.bubbleLine, mine && s.bubbleLineMine]}>
        {mine && <Text style={s.msgTime}>{hhmm(item.createdAt)}</Text>}
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
              viewOnPress
              accessibilityLabel="사진 크게 보기"
            />
          )}
          {hasText && (
            <View style={photo ? s.msgCaption : undefined}>
              <MentionText text={item.text} members={members} mine={mine} />
            </View>
          )}
        </Pressable>
        {!mine && <Text style={s.msgTime}>{hhmm(item.createdAt)}</Text>}
      </View>
      {/* 리액션은 '있을 때만' 칩으로 표시(추가 버튼은 롱프레스 시트로 이동). 없으면 줄 자체가 사라진다. */}
      <View style={mine ? { alignItems: 'flex-end' } : undefined}>
        <ReactionBar reactions={item.reactions} me={me} nameOf={nameOf} onReact={onReact} side={mine ? 'left' : 'right'} hideAdd />
        {showPromote && (
          <Pressable
            onPress={onPromote}
            style={({ pressed }) => [s.promoteChip, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="이 답변을 노하우로 저장"
          >
            <Ionicons name="bookmark-outline" size={12} color={BrandColors.yellowDeep} />
            <Text style={s.promoteChipText}>노하우로 저장</Text>
          </Pressable>
        )}
        {showPromoted && (
          <View style={s.promotedTag}>
            <Ionicons name="bookmark" size={11} color={InkColors.ink3} />
            <Text style={s.promotedTagText}>노하우로 저장됨</Text>
          </View>
        )}
      </View>
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
  empty: { textAlign: 'center', color: InkColors.ink3, fontSize: 15, marginTop: 40 },
  loadMore: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: InkColors.scrim, borderRadius: Radius.pill, paddingHorizontal: 13, paddingVertical: 6, marginBottom: 2 },
  loadMoreText: { fontSize: 11.5, color: InkColors.ink3, fontWeight: '700' },
  divider: { alignItems: 'center', marginVertical: 2 },
  dividerText: { fontSize: 11, color: InkColors.ink3, fontWeight: '700', backgroundColor: InkColors.scrim, paddingHorizontal: 12, paddingVertical: 3, borderRadius: Radius.pill },

  doneRow: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: InkColors.cream, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: InkColors.line, borderStyle: 'dashed', maxWidth: '92%' },
  doneText: { fontSize: 12, color: InkColors.ink2, fontWeight: '600' },

  // maxWidth 만 주고 alignSelf 를 안 주면 부모(스트림)가 stretch 로 행을 왼쪽에 고정해
  // 내 메시지가 프레임 오른쪽 끝까지 못 가고 가운데로 밀린다. 행 자체를 좌/우로 붙인다.
  msgRow: { maxWidth: '82%', gap: 2 },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowOther: { alignSelf: 'flex-start' },
  msgAuthor: { fontSize: 11, color: InkColors.ink2, fontWeight: '700', paddingLeft: 4 },
  // 말풍선+시간 한 줄. 시간은 말풍선 하단 baseline에 붙는다(flex-end). 말풍선이 길면 flexShrink로 양보.
  bubbleLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  bubbleLineMine: { justifyContent: 'flex-end' },
  bubble: { flexShrink: 1, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, borderTopLeftRadius: Radius.tail, paddingHorizontal: 12, paddingVertical: 7, ...Elevation.e1 },
  bubbleMine: { backgroundColor: InkColors.ink, borderColor: InkColors.ink, borderTopLeftRadius: Radius.md, borderTopRightRadius: Radius.tail, alignSelf: 'flex-end' },
  bubblePhoto: { padding: 4, overflow: 'hidden' },
  msgImage: { width: 200, height: 200, borderRadius: Radius.sm },
  msgImageWithText: { marginBottom: 6 },
  msgCaption: { paddingHorizontal: 8, paddingBottom: 5, paddingTop: 1 },
  // 스트림 전역 user-select:none 위에서, 말풍선 본문 텍스트만 선택/복사 가능하게 복원(웹).
  msgText: { fontSize: 14, color: InkColors.ink, lineHeight: 21, ...(Platform.OS === 'web' ? ({ userSelect: 'text' } as object) : null) },
  mention: { color: BrandColors.mention, fontWeight: '800' },
  mentionMine: { color: BrandColors.yellow },
  // 인라인 시간: 말풍선 옆에 붙어 하단 baseline에 앉는다. 줄바꿈 방지로 flexShrink 0.
  msgTime: { flexShrink: 0, fontSize: 10, color: InkColors.ink3, paddingBottom: 1 },
  // 기능2 ambient 승격 넛지 칩 — 리액션 받은 사장 답변 아래에 옅은 옐로 필로 제안.
  promoteChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BrandColors.yellowSoft, borderWidth: 1, borderColor: BrandColors.yellowDeep, borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 3, marginTop: 3 },
  promoteChipText: { fontSize: 11, fontWeight: '800', color: BrandColors.yellowDeep },
  // 승격 완료 정적 표시 — 넛지가 아니라 확인용이라 옅게(테두리 없음).
  promotedTag: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  promotedTagText: { fontSize: 10.5, fontWeight: '700', color: InkColors.ink3 },

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
  sheetReactRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  sheetReact: { width: 48, height: 48, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  sheetReactEmoji: { fontSize: 26 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: Radius.md },
  sheetItemText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  sheetCancel: { marginTop: 4, alignItems: 'center', paddingVertical: 13, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  sheetCancelText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
});
