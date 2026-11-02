import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, TextColor } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Radius } from '@/lib/theme/elevation';
import { Type } from '@/lib/theme/type';

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
    // 높이는 최소 46%(기본 모양 그대로)이고 글자가 커지면 90%까지 자란다. 그래도 넘치면 위 본문만 스크롤되고 아래 버튼은 남는다.
    <BottomSheet visible={true} onClose={onSkip} sheetStyle={{ minHeight: '46%', maxHeight: '90%' }}>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} alwaysBounceVertical={false}>
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
      </ScrollView>

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
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  // flexGrow 0 — ScrollView 기본값(flexGrow 1)이면 시트 최소 높이만큼 늘어나 버튼이 시트 바닥으로 내려간다.
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: 16, paddingTop: 4 },
  title: { ...Type.title, lineHeight: 25 },
  sub: { ...Type.desc, fontWeight: '600', marginTop: 4 },
  subStrong: { color: TextColor.secondary, fontWeight: '800' },
  inp: {
    ...Type.body,
    marginTop: 12, minHeight: 72, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 11, lineHeight: 21,
    backgroundColor: InkColors.cream, textAlignVertical: 'top',
  },
  hint: { ...Type.desc, marginTop: 8, paddingHorizontal: 2 },
  foot: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 14, marginHorizontal: 16, marginBottom: 18 },
  // 버튼 두 개 = 주 버튼 모양(52 · 모서리 16). 한 줄을 나눠 쓰므로 건너뛰기는 내용 폭, 저장이 나머지.
  skip: { ...ButtonStyles.primary, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  skipText: { ...ButtonTextStyles.primary, color: TextColor.secondary },
  cta: { ...ButtonStyles.primary, flex: 1, flexDirection: 'row', gap: 6, backgroundColor: InkColors.ink },
  ctaText: { ...ButtonTextStyles.primary, color: '#fff' },
});
