import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { insertSalesInquiry } from '@/lib/db';
import { BUSINESS_INFO } from '@/lib/config/business';
import { showToast } from '@/lib/store/useToastStore';
import { BrandColors, InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { Appear } from '@/components/Appear';

/**
 * 도입 문의 — 웹 영업 퍼널의 앞문(0105). 결제는 전부 웹에서 받으므로, 표준 3티어에 안 담기는
 * 도입(다점포·프랜차이즈 본사·맞춤 요금)은 여기서 리드를 남기고 상담 후 운영자가 요금제를 지정한다.
 * 비로그인 방문자(랜딩 welcome.html)도 들어오는 top-level 라우트 — 세션 게이트 없음.
 * 로그인 상태면 db 계층이 계정을 함께 연결한다(운영자 대사용).
 */
export default function InquiryScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setMsg('성함을 입력해 주세요.');
      return;
    }
    // 유선(매장 전화)도 받는다 — 모바일 전용 검증(isValidPhone) 대신 숫자 자릿수만 본다.
    if (phone.replace(/\D/g, '').length < 8) {
      setMsg('연락받을 전화번호를 숫자로 적어주세요.');
      return;
    }
    setBusy(true);
    setMsg(null);
    const ok = await insertSalesInquiry({ name, phone, company, message });
    setBusy(false);
    if (!ok) {
      setMsg('문의를 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setDone(true);
  };

  const copyEmail = () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(BUSINESS_INFO.email);
        showToast('이메일 복사됨');
      }
    } catch {
      /* 복사 미지원 환경 — 무시 */
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <HeaderBackButton fallback="/" />
      </View>

      <KeyboardShift>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Appear delay={0}>
          <View style={styles.header}>
            <Text style={styles.title}>도입 문의</Text>
            <Text style={styles.sub}>
              여러 매장이나 프랜차이즈 본사 도입, 요금 상담이 필요하면 남겨주세요. 확인 후 남겨주신 번호로 연락드려요.
            </Text>
          </View>
        </Appear>

        {done ? (
          <Appear delay={0}>
            <View style={styles.card}>
              <View style={styles.doneHead}>
                <Ionicons name="checkmark-circle" size={22} color={BrandColors.brand} />
                <Text style={styles.doneTitle}>문의를 받았어요</Text>
              </View>
              <Text style={styles.body}>남겨주신 번호로 곧 연락드릴게요.</Text>
              <Pressable onPress={goBack} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}>
                <Text style={styles.ghostText}>돌아가기</Text>
              </Pressable>
            </View>
          </Appear>
        ) : (
          <Appear delay={60}>
            <View style={styles.card}>
              <Text style={styles.label}>성함</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="김민수"
                placeholderTextColor={InkColors.ink3}
                style={styles.input}
                maxLength={40}
                accessibilityLabel="성함 입력"
              />

              <Text style={styles.label}>연락처</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="010-1234-5678"
                placeholderTextColor={InkColors.ink3}
                keyboardType="phone-pad"
                style={styles.input}
                maxLength={20}
                accessibilityLabel="연락처 입력"
              />

              <Text style={styles.label}>매장·회사 이름 (선택)</Text>
              <TextInput
                value={company}
                onChangeText={setCompany}
                placeholder="우리커피 신촌점"
                placeholderTextColor={InkColors.ink3}
                style={styles.input}
                maxLength={80}
                accessibilityLabel="매장 또는 회사 이름 입력"
              />

              <Text style={styles.label}>문의 내용 (선택)</Text>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="매장 5곳 도입 비용이 궁금해요"
                placeholderTextColor={InkColors.ink3}
                style={[styles.input, styles.inputMulti]}
                multiline
                maxLength={1000}
                accessibilityLabel="문의 내용 입력"
              />

              <Pressable
                disabled={busy}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}
              >
                {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>문의 보내기</Text>}
              </Pressable>

              {msg && <Text style={styles.msg}>{msg}</Text>}
            </View>
          </Appear>
        )}

        <Appear delay={120}>
          <Pressable onPress={copyEmail} style={({ pressed }) => [styles.mailRow, pressed && { opacity: 0.6 }]}>
            <Text style={styles.mailText}>메일로도 받아요 · {BUSINESS_INFO.email}</Text>
          </Pressable>
        </Appear>
      </ScrollView>
      </KeyboardShift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Surface.screen },
  topbar: { height: 48, justifyContent: 'center' },
  // 좌우·아래 = 화면 틀 값. 위는 뒤로가기 줄 바로 아래라 좁게, 블록 사이 24 는 그대로.
  scroll: { ...screenScrollStyle, flexGrow: 1, paddingTop: Space.xs, gap: Space.xl },
  header: { gap: Space.sm },
  title: { ...Type.title },
  sub: { ...Type.desc },

  card: { ...CardStyles.list, gap: Space.sm },
  label: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: TextColor.secondary, marginTop: Space.xs },
  input: {
    ...Type.body,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: Surface.input,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  primary: { ...ButtonStyles.primary, marginTop: Space.md, backgroundColor: BrandColors.brand },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  msg: { fontSize: 15, lineHeight: 22, color: BrandColors.accentText, fontWeight: '700', textAlign: 'center', marginTop: 2 },

  doneHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  doneTitle: { ...Type.title },
  body: { ...Type.desc },
  ghost: { ...ButtonStyles.primary, marginTop: Space.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { fontSize: Type.body.fontSize, fontWeight: '700', color: TextColor.secondary },

  mailRow: { alignItems: 'center', paddingVertical: Space.sm },
  mailText: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
});
