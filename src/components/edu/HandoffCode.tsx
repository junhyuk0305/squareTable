/**
 * 이어받기 코드 칸(S14 · 사용자 결정 3 · 0552 edu_link_handoff_code) — 웹 링크 화면(/l/[token]) 묻는 칸 아래.
 * [코드 받기] → 6자 코드를 크게 보인다. 앱의 코드 칸(직원 허브)에 넣으면 이 링크와 이 기기에서 보낸 질문이 그 계정으로 옮겨진다.
 * 이 기기의 손님 열쇠가 있으면 서버가 코드를 그 손님에 묶는다. 없으면 링크만 옮겨진다(물은 적 없어도 된다).
 * 10분이 지나면 코드를 지우고 [새 코드 받기]를 보인다. 서버는 원문을 저장하지 않아 같은 코드를 다시 보여 줄 수 없다.
 * ★토큰·열쇠·코드는 계측·로그에 싣지 않는다. 오류 원문을 화면에 내지 않는다(placeErrorMessage).
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';

import { eduLinkHandoffCode } from '@/lib/db';
import { loadEduGuest } from '@/lib/edu/guestKey';
import { placeErrorMessage } from '@/lib/place/errors';
import { HANDOFF } from '@/lib/place/words';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

export function HandoffCode({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // 10분이 지나면 코드를 지운다(화면에 죽은 코드를 남기지 않는다).
  useEffect(() => {
    if (!expiresAt) return;
    const left = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(left)) return;
    const t = setTimeout(() => { setCode(null); setExpiresAt(null); setExpired(true); }, Math.max(0, left));
    return () => clearTimeout(t);
  }, [expiresAt]);

  const get = async () => {
    if (busy) return;
    setBusy(true);
    const guest = await loadEduGuest(token);
    const r = await eduLinkHandoffCode(token, guest?.key ?? null);
    setBusy(false);
    if (r.error || !r.data) {
      showToast(placeErrorMessage(r.error ?? null, HANDOFF.codeFail), 'warn');
      return;
    }
    setExpired(false);
    setCode(r.data.code);
    setExpiresAt(r.data.expiresAt);
  };

  const label = code ? HANDOFF.again : HANDOFF.getCode;

  return (
    <View style={st.card}>
      <Text style={st.title}>{HANDOFF.title}</Text>
      {code ? (
        <View style={st.codeBox} accessible accessibilityRole="text" accessibilityLabel={code.split('').join(' ')}>
          <Text style={st.code} selectable>{code.split('').join(' ')}</Text>
        </View>
      ) : null}
      <Text style={st.note}>{expired && !code ? HANDOFF.expired : HANDOFF.codeBody}</Text>
      <Pressable
        onPress={() => void get()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [st.btn, pressed && st.pressed, busy && st.disabled]}
      >
        {busy ? <ActivityIndicator color={InkColors.ink} /> : <Text style={st.btnText}>{label}</Text>}
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  card: { ...CardStyles.list, gap: Space.sm },
  title: { ...Type.body, fontWeight: '800' },
  codeBox: { alignItems: 'center', paddingVertical: Space.sm, borderRadius: Radius.md, backgroundColor: Surface.screen },
  code: { ...Type.numHero, color: InkColors.ink },
  note: { ...Type.desc, color: TextColor.secondary },
  // 보조 버튼 — 화면의 Primary 는 묻는 칸의 [질문 보내기] 하나다.
  btn: { ...ButtonStyles.small, minHeight: 48, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: Surface.card },
  btnText: { ...ButtonTextStyles.small, color: InkColors.ink },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
