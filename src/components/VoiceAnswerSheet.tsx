// 받은 질문에 음성 1터치로 답하는 하단 바텀시트 모달.
// 질문(query_text)을 위에 보여주고, VoiceButton(전사→텍스트)로 답을 받아
// 편집 가능한 TextInput에 채운 뒤 "등록"으로 onSubmit(text)을 호출한다.
//
// 🔒 프레임 불변식(AGENTS.md): RN <Modal>은 ResponsiveShell 바깥(document body)으로
//    렌더되므로 딤 배경·시트를 모두 modalFrameStyle 컬럼 안에 가둔다.
//    구조: <Modal><View modalFrameStyle>[backdrop flex:1 onPress=close][sheet]</View></Modal>
import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { modalFrameStyle } from '@/lib/theme/layout';
import { VoiceButton } from '@/components/VoiceButton';
import type { UnknownQuery } from '@/types';

export interface VoiceAnswerSheetProps {
  visible: boolean;
  uq: UnknownQuery | null;
  onClose: () => void;
  onSubmit: (answerText: string) => void;
}

export function VoiceAnswerSheet({ visible, uq, onClose, onSubmit }: VoiceAnswerSheetProps) {
  // 전사/직접입력된 답변 텍스트. 시트가 열릴 때(또는 다른 질문으로 바뀔 때)마다 비운다.
  const [text, setText] = useState('');
  // render-time 조정: 세션 키(visible+질문 id)가 바뀌면 입력값 초기화 (effect 내 setState 회피).
  const sessionKey = visible ? (uq?.id ?? 'open') : 'closed';
  const [prevKey, setPrevKey] = useState(sessionKey);
  if (sessionKey !== prevKey) {
    setPrevKey(sessionKey);
    setText('');
  }

  const canSubmit = text.trim().length > 0;
  const similar = uq?.similar_queries_count ?? 0;

  // VoiceButton(전사 결과)을 입력칸에 채운다. 기존 내용 뒤에 이어 붙임.
  const handleVoiceResult = (result: string) => {
    const v = result.trim();
    if (!v) return;
    setText((prev) => (prev.trim() ? `${prev.trim()} ${v}` : v));
  };

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSubmit(v);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* 딤·시트를 함께 프레임 폭(460)으로 가두는 컬럼 */}
      <View style={modalFrameStyle}>
        {/* 딤 배경 — flex:1, 탭하면 닫힘. 프레임 안에서만 어두워진다. */}
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" />

        {/* 시트 본문 */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.head}>
              <View style={styles.headTitleRow}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={InkColors.ink} />
                <Text style={styles.headTitle}>음성으로 답하기</Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="닫기"
                hitSlop={8}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="close" size={22} color={InkColors.ink2} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* 질문 표시 */}
              <View style={styles.questionCard}>
                {uq?.junior_name && !uq?.anonymous ? (
                  <Text style={styles.asker}>{uq.junior_name}님이 물었어요</Text>
                ) : (
                  <Text style={styles.asker}>받은 질문</Text>
                )}
                <Text style={styles.questionText}>{uq?.query_text ?? ''}</Text>
                {similar > 0 && (
                  <View style={styles.similarPill}>
                    <Ionicons name="layers-outline" size={13} color={InkColors.ink2} />
                    <Text style={styles.similarText}>비슷한 질문 {similar}건</Text>
                  </View>
                )}
              </View>

              {/* 음성 1터치 + 폴백 텍스트 입력 (VoiceButton 재사용) */}
              <VoiceButton size="lg" onResult={handleVoiceResult} label="🎙 답변" />
              <Text style={styles.helper}>말하듯 편하게 답하면 돼요. 글로 직접 다듬어도 좋아요.</Text>

              {/* 전사/누적된 답변 — 편집 가능한 미리보기 */}
              <Text style={styles.previewLabel}>등록할 답변</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="여기에 답변이 정리돼요"
                placeholderTextColor={InkColors.ink3}
                multiline
                style={styles.previewInput}
                accessibilityLabel="등록할 답변"
              />
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.btnGhostText}>다음에</Text>
              </Pressable>
              <Pressable
                disabled={!canSubmit}
                onPress={submit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit }}
                accessibilityLabel="답변 등록하기"
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnSolid,
                  !canSubmit && { opacity: 0.4 },
                  pressed && canSubmit && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.btnSolidText}>등록</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,17,17,0.45)',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    width: '100%',
    backgroundColor: InkColors.bg,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    maxHeight: '88%',
    ...Elevation.e3,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.line,
    marginBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headTitle: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { marginTop: 12 },
  bodyContent: { gap: 14, paddingBottom: 4 },
  questionCard: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: 14,
    gap: 8,
  },
  asker: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  questionText: { fontSize: 16, fontWeight: '700', color: InkColors.ink, lineHeight: 23 },
  similarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
  },
  similarText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  helper: { fontSize: 12.5, color: InkColors.ink2, lineHeight: 18 },
  previewLabel: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, marginTop: 2 },
  previewInput: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: InkColors.bg,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radius.md,
    minHeight: 48,
  },
  btnGhost: { backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  btnGhostText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  btnSolid: { backgroundColor: BrandColors.brand },
  btnSolidText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
