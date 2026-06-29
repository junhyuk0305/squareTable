import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { REACTIONS } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { styles } from './workStyles';

/** 공용: 이모지 리액션 바 — 채팅 메시지·공지 카드가 공유. */
export function ReactionBar({
  reactions,
  me,
  nameOf,
  onReact,
  side,
}: {
  reactions?: Record<string, string[]>;
  me: string;
  nameOf: (id: string) => string;
  onReact: (e: string) => void;
  /** 'left'/'right' = 칩 안에서 이모지 옆(수평)에 누른 사람 이름 표시(공간 있는 쪽). 미지정=칩 아래(레거시). */
  side?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const active = reactions ?? {};
  const chips = Object.entries(active).filter(([, who]) => who.length > 0);
  const namesOf = (ids: string[]) => ids.map((id) => (id === me ? '나' : nameOf(id))).join(', ');

  const addBtn = (
    <Pressable onPress={() => setOpen((v) => !v)} style={styles.reactAdd}>
      <Ionicons name={open ? 'close' : 'happy-outline'} size={15} color={InkColors.ink3} />
    </Pressable>
  );
  const picker =
    open &&
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
    ));

  // 칩 옆 표시(채팅): 이모지 바로 옆(수평)에 누른 사람 이름. mine=이모지 왼쪽, other=오른쪽.
  if (side) {
    return (
      <View style={styles.reactWrap}>
        {chips.map(([emoji, ids]) => {
          const mine = ids.includes(me);
          const name = (
            <Text style={[styles.reactWho, mine && { color: BrandColors.brand, fontWeight: '700' }]} numberOfLines={1}>
              {namesOf(ids)}
            </Text>
          );
          const emo = <Text style={styles.reactEmoji}>{emoji}</Text>;
          return (
            <Pressable key={emoji} onPress={() => onReact(emoji)} style={[styles.reactChip, mine && styles.reactChipMine]}>
              {side === 'left' ? (
                <>
                  {name}
                  {emo}
                </>
              ) : (
                <>
                  {emo}
                  {name}
                </>
              )}
            </Pressable>
          );
        })}
        {addBtn}
        {picker}
      </View>
    );
  }

  // 레거시(공지 카드 등): 칩(이모지+카운트) 위, 누른 사람 아래.
  return (
    <View style={{ gap: 3 }}>
      <View style={styles.reactWrap}>
        {chips.map(([emoji, ids]) => {
          const mine = ids.includes(me);
          return (
            <Pressable key={emoji} onPress={() => onReact(emoji)} style={[styles.reactChip, mine && styles.reactChipMine]}>
              <Text style={styles.reactEmoji}>{emoji}</Text>
              <Text style={[styles.reactCount, mine && { color: BrandColors.brand }]}>{ids.length}</Text>
            </Pressable>
          );
        })}
        {addBtn}
        {picker}
      </View>
      {chips.map(([emoji, ids]) => (
        <Text key={`who-${emoji}`} style={styles.reactWho}>
          {emoji} {namesOf(ids)}
        </Text>
      ))}
    </View>
  );
}
