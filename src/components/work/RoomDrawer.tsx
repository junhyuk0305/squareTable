import { useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { StoredImage } from '@/components/StoredImage';
import { Appear } from '@/components/Appear';
import { Collapse } from '@/components/Collapse';
import { SectionLabel } from '@/components/SectionLabel';
import { ChachakSwitch } from '@/components/ChachakSwitch';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { HEADER_EDGE_GUTTER, Space } from '@/lib/theme/layout';
import { confirmAction } from '@/lib/utils/confirm';
import { roleNoun } from '@/lib/utils/roles';
import { roomLook } from '@/lib/utils/room';
import type { Room, RoomPref } from '@/lib/store/useRoomStore';
import type { FeedItem, TaskTemplate, DoneMark } from '@/lib/store/useWorkStore';
import type { Member } from '@/components/work/MentionInput';
import { fmtDateKo } from '@/lib/utils/schedule';

/**
 * RoomDrawer — 대화방 햄버거로 열리는 방 관리 화면. 블록 6개:
 *   정체성 / 공지 / 이 방 할일 / 참여 인원+초대 / 이 방 설정 / 나가기·삭제
 *
 * ★'이 방 할일'은 **담당자가 이 방 멤버인 할일**만이다(판정 Ⓑ). 담당 없는 매장 전체 할일까지
 *   넣으면 모든 방이 똑같은 목록을 갖게 되고, 방마다 열어 볼 이유가 사라진다.
 * ★스위치는 하나뿐이다 — '할일 완료를 채팅에 표시'(방마다 · 나에게만). 푸시 음소거는 만들지
 *   않는다(매장별 음소거가 unit_member_prefs(0076)에 이미 있어 축이 겹친다).
 */
export function RoomDrawer({
  room,
  pref,
  members,
  memberIds,
  notices,
  tasks,
  done,
  today,
  me,
  isStoreOwner,
  canKick,
  onBack,
  onEditLook,
  onInvite,
  onKick,
  onToggleTaskDone,
  onOpenNotices,
  onOpenTodo,
  onLeave,
  onDelete,
}: {
  room: Room;
  pref?: RoomPref;
  /** 매장 명부 전체(초대 후보를 여기서 고른다). */
  members: Member[];
  /** 이 방 멤버 id. 기본방('전체')은 전원이라 명부 전체가 들어온다. */
  memberIds: string[];
  notices: FeedItem[];
  tasks: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  today: string;
  me: string;
  /** 삭제는 사장 + 그 방 멤버만(0148). 매니저·직원은 나가기만. */
  isStoreOwner: boolean;
  /** 내보내기 권한(사장·매니저). */
  canKick: boolean;
  onBack: () => void;
  onEditLook: () => void;
  onInvite: (userId: string) => void;
  onKick: (userId: string) => void;
  onToggleTaskDone: (next: boolean) => void;
  onOpenNotices: () => void;
  onOpenTodo: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const look = roomLook(room, pref);
  const [inviteOpen, setInviteOpen] = useState(false);

  const inRoom = useMemo(() => members.filter((m) => memberIds.includes(m.id)), [members, memberIds]);
  const candidates = useMemo(() => members.filter((m) => !memberIds.includes(m.id)), [members, memberIds]);
  const creatorName = useMemo(
    () => (room.createdBy ? members.find((m) => m.id === room.createdBy)?.name : undefined),
    [room.createdBy, members],
  );
  const showTaskDone = pref?.showTaskDone !== false;

  async function leave() {
    const ok = await confirmAction(
      `‘${look.name}’에서 나갈까요?`,
      [
        '· 이 방의 대화·공지를 더 이상 볼 수 없어요.',
        '· 다시 들어오려면 남은 사람이 초대해야 해요.',
        '· 내가 쓴 메시지는 지워지지 않고 남아요.',
      ].join('\n'),
      '나가기',
      { destructive: true, icon: 'exit-outline' },
    );
    if (ok) onLeave();
  }

  async function del() {
    const ok = await confirmAction(
      `‘${look.name}’을 삭제할까요?`,
      '삭제하면 모든 참여자에게서 사라져요. 나가면 삭제할 수 없게 돼요.',
      '삭제',
      { destructive: true, icon: 'trash-outline' },
    );
    if (ok) onDelete();
  }

  return (
    <View style={{ flex: 1, backgroundColor: InkColors.cream }}>
      <View style={s.topbar}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="대화로 돌아가기" style={({ pressed }) => [s.topBtn, pressed && { opacity: 0.5 }]}>
          <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
        </Pressable>
        {/* 연필 = **개인용** 이름·사진 변경. 전역 이름은 만들 때 한 번만 정해진다(판정 ⑥). */}
        {!room.isDefault && (
          <Pressable onPress={onEditLook} hitSlop={12} accessibilityRole="button" accessibilityLabel="이 방 이름·사진 바꾸기" style={({ pressed }) => [s.topBtn, pressed && { opacity: 0.5 }]}>
            <Ionicons name="create-outline" size={22} color={InkColors.ink} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ① 정체성 — 카드가 아닌 히어로. 이 방이 무엇인지 한눈에. */}
        <Appear delay={0} style={s.identity}>
          {look.imageUrl ? (
            <StoredImage stored={look.imageUrl} style={s.bigAvatar} />
          ) : (
            <View style={[s.bigAvatar, { backgroundColor: look.color }]}>
              <Text style={s.bigAvatarText}>{look.initial}</Text>
            </View>
          )}
          <Text style={s.roomName}>{look.name}</Text>
          <Text style={s.roomMeta}>
            참여 {memberIds.length}명{creatorName ? ` · ${creatorName}이 만듦` : room.isDefault ? ' · 전원 참여' : ''}
          </Text>
        </Appear>

        {/* ② 공지 */}
        <Block title="공지" moreLabel="전체보기 ›" onMore={onOpenNotices}>
          {notices.length === 0 ? (
            <Text style={s.blockEmpty}>아직 공지가 없어요.</Text>
          ) : (
            notices.slice(0, 2).map((n, i) => (
              <Row key={n.id} first={i === 0} icon="megaphone-outline" title={n.text} sub={n.pinned ? `고정됨 · ${fmtDateKo(n.date)}` : fmtDateKo(n.date)} />
            ))
          )}
        </Block>

        {/* ③ 이 방 할일 — 담당자가 이 방 멤버인 것만(판정 Ⓑ) */}
        <Block title="이 방 할일" moreLabel="전체보기 ›" onMore={onOpenTodo}>
          {tasks.length === 0 ? (
            <Text style={s.blockEmpty}>이 방 사람에게 배정된 할일이 없어요.</Text>
          ) : (
            tasks.slice(0, 3).map((t, i) => {
              const isDone = !!done[today]?.[t.id];
              const who = t.ownerId ? members.find((m) => m.id === t.ownerId)?.name : undefined;
              return (
                <Row
                  key={t.id}
                  first={i === 0}
                  icon="checkbox-outline"
                  title={t.text}
                  sub={who ? `매장 전체 · 담당 ${who}` : '매장 전체'}
                  right={isDone ? '완료' : undefined}
                  rightGood={isDone}
                />
              );
            })
          )}
        </Block>

        {/* ④ 참여 인원 + 초대 */}
        <Block
          title={`참여 인원 ${memberIds.length}명`}
          moreLabel={room.isDefault ? undefined : inviteOpen ? '닫기' : '＋ 초대'}
          onMore={room.isDefault ? undefined : () => setInviteOpen((v) => !v)}
        >
          {inRoom.map((m, i) => (
            <Row
              key={m.id}
              first={i === 0}
              avatar
              title={m.id === me ? `${m.name} (나)` : m.name}
              right={roleNoun(m.role)}
              onRemove={!room.isDefault && canKick && m.id !== me ? () => onKick(m.id) : undefined}
            />
          ))}
          {/* 펼침은 아래로 — 초대 후보를 목록 밑에 붙인다. */}
          {inviteOpen && (
            <Collapse>
              <Text style={s.inviteLabel}>초대할 사람</Text>
              {candidates.length === 0 ? (
                <Text style={s.blockEmpty}>매장의 모든 사람이 이미 이 방에 있어요.</Text>
              ) : (
                candidates.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => onInvite(m.id)}
                    style={({ pressed }) => [s.row, s.rowBorder, pressed && { backgroundColor: InkColors.bgSoft }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name} 초대`}
                  >
                    <Ionicons name="person-add-outline" size={19} color={InkColors.ink2} style={s.rowIcon} />
                    <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                    <Text style={s.rowRight}>{roleNoun(m.role)}</Text>
                  </Pressable>
                ))
              )}
            </Collapse>
          )}
        </Block>

        {/* ⑤ 이 방 설정 — 스위치 하나뿐 */}
        <Block title="이 방 설정">
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>할일 완료를 채팅에 표시</Text>
              <Text style={s.rowSub}>이 방에서만 · 나에게만 적용돼요</Text>
            </View>
            <ChachakSwitch value={showTaskDone} onValueChange={onToggleTaskDone} accessibilityLabel="할일 완료를 채팅에 표시" />
          </View>
        </Block>

        {/* ⑥ 나가기 · 삭제 */}
        {!room.isDefault && (
          <View style={s.exit}>
            <Pressable onPress={leave} style={({ pressed }) => [s.exitRow, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="방 나가기">
              <Ionicons name="exit-outline" size={19} color={BrandColors.badText} />
              <Text style={s.exitText}>방 나가기</Text>
            </Pressable>
            <Text style={s.exitNote}>나가면 이 방의 대화를 더 이상 볼 수 없어요.</Text>
            {/* 삭제는 사장이면서 그 방 멤버일 때만 — 나가면 삭제 권한도 사라진다(규칙 4). */}
            {isStoreOwner && memberIds.includes(me) && (
              <Pressable onPress={del} style={({ pressed }) => [s.exitRow, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="채팅방 삭제">
                <Ionicons name="trash-outline" size={19} color={BrandColors.badText} />
                <Text style={s.exitText}>채팅방 삭제</Text>
              </Pressable>
            )}
          </View>
        )}
        <View style={{ height: Space.xl }} />
      </ScrollView>
    </View>
  );
}

/** 섹션 제목은 카드 '밖' 라벨 — 공용 SectionLabel(trailing=전체보기)로 통일한다. */
function Block({
  title,
  moreLabel,
  onMore,
  children,
}: {
  title: string;
  moreLabel?: string;
  onMore?: () => void;
  children: ReactNode;
}) {
  return (
    <Appear style={s.block}>
      <SectionLabel
        title={title}
        trailing={
          moreLabel && onMore ? (
            <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${title} ${moreLabel}`} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={s.blockMore}>{moreLabel}</Text>
            </Pressable>
          ) : undefined
        }
      />
      <View style={s.card}>{children}</View>
    </Appear>
  );
}

function Row({
  icon,
  avatar,
  title,
  sub,
  right,
  rightGood,
  first,
  onRemove,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  avatar?: boolean;
  title: string;
  sub?: string;
  right?: string;
  rightGood?: boolean;
  first?: boolean;
  onRemove?: () => void;
}) {
  return (
    <View style={[s.row, !first && s.rowBorder]}>
      {avatar ? (
        <View style={s.smallAvatar} />
      ) : icon ? (
        <Ionicons name={icon} size={19} color={InkColors.ink2} style={s.rowIcon} />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {sub && <Text style={s.rowSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {right && <Text style={[s.rowRight, rightGood && { color: BrandColors.goodText }]}>{right}</Text>}
      {onRemove && (
        <Pressable onPress={onRemove} hitSlop={12} accessibilityRole="button" accessibilityLabel={`${title} 내보내기`} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Ionicons name="close" size={19} color={InkColors.ink3} />
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: HEADER_EDGE_GUTTER, paddingVertical: Space.sm },
  topBtn: { paddingVertical: Space.xs },
  scroll: { paddingHorizontal: Space.gutter, gap: Space.lg },

  identity: { alignItems: 'center', gap: Space.xs, paddingVertical: Space.md },
  bigAvatar: { width: 66, height: 66, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bigAvatarText: { fontSize: 27, fontWeight: '800', color: InkColors.bubbleText },
  roomName: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  roomMeta: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3 },

  block: { gap: Space.sm },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, overflow: 'hidden', ...Elevation.e1 },
  blockMore: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 },
  blockEmpty: { fontSize: 15, lineHeight: 21, color: InkColors.ink3, fontWeight: '600', paddingHorizontal: Space.lg, paddingVertical: Space.md },

  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg, paddingVertical: 13, minHeight: 52 },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowIcon: { width: 22, textAlign: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  rowSub: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3, marginTop: 2 },
  rowRight: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3 },
  smallAvatar: { width: 26, height: 26, borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft },

  inviteLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2, paddingHorizontal: Space.lg, paddingTop: Space.md },

  exit: { gap: Space.xs },
  exitRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: 13, minHeight: 48 },
  exitText: { fontSize: 15, fontWeight: '700', color: BrandColors.badText },
  exitNote: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3 },
});
