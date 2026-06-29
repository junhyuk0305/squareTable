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
