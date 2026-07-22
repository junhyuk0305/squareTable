import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';

/**
 * CaptureKnowhowSheet — 반복 업무를 처음 완료한 직후 뜨는 1턴 캡처(S1 ②).
 * "이 업무 어떻게 하셨어요?" 한 줄을 받아 노하우로 축적(업무→노하우 루프). 항상 건너뛸 수 있다.
 * 사장이면 즉시 발행+첨부, 알바면 사장 승인 큐로 간다(호출부가 분기). 닫기(백드롭)=건너뛰기.
 */
export function CaptureKnowhowSheet({
  taskText,
  isOwner,
  onSubmit,
  onSkip,
}: {
  taskText: string;
  isOwner: boolean;
  onSubmit: (line: string) => void;
  onSkip: () => void;
}) {
  const [line, setLine] = useState('');
  const canSave = line.trim().length > 0;

  return (
    <BottomSheet visible={true} onClose={onSkip} sheetStyle={{ height: '46%' }}>
      <View style={s.body}>
        <Text style={s.title}>이 업무, 어떻게 하셨어요?</Text>
        <Text style={s.sub} numberOfLines={2}>
          <Text style={s.subStrong}>{taskText}</Text> · 한 줄 남기면 다음 사람이 바로 봐요
        </Text>

        <TextInput
          value={line}
          onChangeText={setLine}
          placeholder="예) 세제는 싱크대 아래 두 번째 칸 것 사용"
          placeholderTextColor={InkColors.ink3}
          style={s.inp}
          multiline
          autoFocus
        />

        <Text style={s.hint}>
          {isOwner ? '저장하면 이 업무에 바로 붙어요.' : '사장님이 확인하면 노하우로 등록돼 이 업무에 붙어요.'}
        </Text>

        <View style={s.foot}>
          <Pressable onPress={onSkip} style={({ pressed }) => [s.skip, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="건너뛰기">
            <Text style={s.skipText}>건너뛰기</Text>
          </Pressable>
          <Pressable
            onPress={() => onSubmit(line)}
            disabled={!canSave}
            style={({ pressed }) => [s.cta, !canSave && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={isOwner ? '노하우로 저장' : '남기기'}
          >
            <Ionicons name="bookmark-outline" size={15} color="#fff" />
            <Text style={s.ctaText}>{isOwner ? '노하우로 저장' : '남기기'}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 18 },
  title: { fontSize: 16, lineHeight: 23, fontWeight: '800', color: InkColors.ink },
  sub: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3, fontWeight: '600', marginTop: 4 },
  subStrong: { color: InkColors.ink2, fontWeight: '800' },
  inp: {
    marginTop: 12, minHeight: 72, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, lineHeight: 20, color: InkColors.ink,
    backgroundColor: InkColors.cream, textAlignVertical: 'top',
  },
  hint: { fontSize: 11.5, color: InkColors.ink3, marginTop: 8, paddingHorizontal: 2 },
  foot: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 14 },
  skip: { paddingHorizontal: 18, justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  skipText: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  cta: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: 14 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
