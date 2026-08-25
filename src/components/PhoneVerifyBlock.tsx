import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';

import { usePhoneOtp } from '@/lib/otp';
import { formatPhone, normalizePhone } from '@/lib/utils/validation';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 전화번호 인증 한 벌 — **서버가 `PHONE_NOT_VERIFIED` 로 막았을 때만** 화면이 연다.
 *
 * ★미리 열지 않는 이유: 인증 여부는 서버만 안다(`phone_otps` 는 클라가 못 읽는다). 무조건 열면
 *   가입 폼에서 이미 인증한 대다수 사용자에게 실 SMS 를 한 번 더 보내게 된다 — '막혔을 때 그 자리에서 푼다'.
 *
 * ★★이 블록이 컴포넌트인 이유(2026-08-25 감사 #2·#3): 같은 인증 단계가 **두 축**에 필요하다 —
 *   사장의 매장 만들기(`owner/create-store`)와 직원의 매장 합류(`junior/hub`). 두 곳에 복제하면
 *   아래 `profiles.phone` 갱신 같은 판정이 한쪽에만 들어가 다시 어긋난다(AGENTS ② SSOT).
 *
 * ★★★가장 중요한 것 — `onVerified` 는 `profiles.phone` 을 갱신한 **뒤에** 불린다.
 *   0088 게이트는 `profiles.phone` 으로 `phone_otps` 를 조인해 판정하는데 `usePhoneOtp` 는
 *   `phone_otps` 에만 흔적을 남긴다. 이 갱신이 없으면 인증을 마쳐도 게이트는 그대로 닫혀 있어
 *   재시도가 또 `PHONE_NOT_VERIFIED` 로 떨어진다 — **SMS 비용만 나가고 결과는 같다**(#3 의 no-op).
 */
export function PhoneVerifyBlock({
  guide,
  okText,
  initialPhone,
  updateProfile,
  onVerifiedChange,
}: {
  /** 왜 지금 인증이 필요한지 한 줄. 축마다 다르다(매장 만들기 / 매장 합류). */
  guide: string;
  /** 인증을 마쳤을 때 보여줄 다음 행동 문장. */
  okText: string;
  initialPhone?: string | null;
  updateProfile: (patch: { phone?: string }) => Promise<{ error: string | null }>;
  /** 인증 + profiles 반영이 **둘 다** 끝났을 때 true. 호출부는 이 값으로만 제출을 허용한다. */
  onVerifiedChange: (ready: boolean) => void;
}) {
  const [phone, setPhone] = useState(formatPhone(initialPhone ?? ''));
  const [code, setCode] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const otp = usePhoneOtp(normalizePhone(phone));

  // 번호를 고치면 훅이 정규화 번호 비교로 sent/verified 를 스스로 푼다 — 여기서도 반영분을 되돌린다.
  const ready = otp.verified && saved;

  const verify = async () => {
    const ok = await otp.verify(code);
    if (!ok) return; // 실패 문구는 otp.msg 가 말한다
    // 인증 직후 곧바로 profiles 에 반영한다 — 이 한 줄이 없으면 서버 게이트가 안 열린다(위 주석).
    const { error } = await updateProfile({ phone: normalizePhone(phone) });
    if (error) {
      setSaveErr(error);
      setSaved(false);
      onVerifiedChange(false);
      return;
    }
    setSaveErr(null);
    setSaved(true);
    onVerifiedChange(true);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.label}>전화번호 인증<Text style={styles.req}> *</Text></Text>
      <Text style={styles.guide}>{guide}</Text>

      <View style={styles.row}>
        <TextInput
          value={phone}
          onChangeText={(v) => {
            setSaveErr(null);
            setSaved(false);
            onVerifiedChange(false);
            setPhone(formatPhone(v));
          }}
          placeholder="010-1234-5678"
          placeholderTextColor={InkColors.ink3}
          keyboardType="phone-pad"
          maxLength={13}
          style={[styles.input, styles.flex]}
        />
        {!ready && (
          <Pressable
            onPress={() => void otp.send()}
            disabled={otp.busy === 'send' || otp.countdown > 0}
            style={[styles.btn, (otp.busy === 'send' || otp.countdown > 0) && styles.btnDim]}
          >
            {otp.busy === 'send' ? (
              <ActivityIndicator size="small" color={InkColors.ink2} />
            ) : (
              <Text style={styles.btnText}>
                {otp.countdown > 0 ? `재발송 ${otp.countdown}초` : otp.sent ? '인증번호 재발송' : '인증번호 받기'}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {otp.sent && !ready && (
        <View style={styles.row}>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="인증번호 6자리"
            placeholderTextColor={InkColors.ink3}
            keyboardType="number-pad"
            maxLength={6}
            style={[styles.input, styles.flex]}
          />
          <Pressable
            onPress={() => void verify()}
            disabled={otp.busy === 'verify' || code.length !== 6}
            style={[styles.btn, (otp.busy === 'verify' || code.length !== 6) && styles.btnDim]}
          >
            {otp.busy === 'verify' ? (
              <ActivityIndicator size="small" color={InkColors.ink2} />
            ) : (
              <Text style={styles.btnText}>인증하기</Text>
            )}
          </Pressable>
        </View>
      )}

      {ready && <Text style={styles.ok}>✓ 인증된 번호예요. {okText}</Text>}
      {otp.msg && <Text style={styles.msg}>{otp.msg}</Text>}
      {saveErr && <Text style={styles.err}>{saveErr}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: InkColors.bgSoft,
    borderRadius: Radius.md,
    padding: Space.lg,
    gap: Space.sm,
  },
  label: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  req: { color: BrandColors.badText },
  guide: { fontSize: 15, color: InkColors.ink2, lineHeight: 21 },
  row: { flexDirection: 'row', gap: Space.sm, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    minHeight: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: '#fff',
    paddingHorizontal: Space.md,
    fontSize: 15,
    color: InkColors.ink,
  },
  btn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: '#fff',
  },
  btnDim: { opacity: 0.5 },
  btnText: { fontSize: 15, fontWeight: '600', color: InkColors.ink2 },
  ok: { fontSize: 15, color: BrandColors.goodText },
  msg: { fontSize: 15, color: InkColors.ink2 },
  err: { fontSize: 15, color: BrandColors.badText },
});
