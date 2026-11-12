/**
 * 교육 링크 화면(S14 · 0400) — 로그인 없이 도는 라우트다. 퀴즈 링크(/q/[token])와 같은 자리에 선다.
 *
 * 카톡으로 받은 주소를 연 사람이 노하우를 읽는다. 본문은 공용 부품 EduLinkView 가 그린다(앱 안에서도 같은 화면).
 * 묻기·보내기·도움 안 됨·내 질문 다시 보기·신고 = EduAsk(0401 · 손님 열쇠는 이 기기에 둔다). 가입은 4번 덩이다.
 *
 * 보안 경계(전부 서버가 지킨다. 이 화면은 판정하지 않는다):
 *  · 접근은 토큰 definer RPC 뿐(edu_link_open · entries · ask · send · answers · report)과 AI 엣지 손님 갈래. 로그인 경로(RLS)를 열지 않는다.
 *  · 닫힘·만료·없는 토큰·지운 자리는 서버가 ok=false 하나로 준다. 화면도 "닫힌 링크" 하나로 말한다.
 *  · 열 때마다 서버가 열람 수를 올린다. 그래서 한 번 열 때 edu_link_open 을 한 번만 부른다.
 * ★토큰은 계측·로그에 싣지 않는다. 화면 계측은 경로 템플릿(/l/[token])만 남긴다(useScreenTracking).
 * 루트 _layout 에 인증 가드가 없어 따로 빼 줄 것이 없다(/q 와 같다). 웹 배포는 vercel.json 의 `/(.*)` → app.html 이 받는다.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Appear } from '@/components/Appear';
import { ScreenLoading } from '@/components/ScreenLoading';
import { EduAsk } from '@/components/edu/EduAsk';
import { EduLinkView } from '@/components/edu/EduLinkView';
import { HandoffCode } from '@/components/edu/HandoffCode';
import { openEduLink, fetchEduLinkEntries, type EduLinkEntry, type EduLinkInfo } from '@/lib/db';
import { askClaimEduGuests } from '@/lib/edu/autoClaim';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors, Surface, TextColor } from '@/lib/theme/colors';
import { Gap, Space, screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

const CLOSED: EduLinkInfo = { ok: false, failed: false, placeKind: null, placeName: '', ownerName: '', title: '', entryCount: 0, expiresAt: null };

// failed = 우리 쪽 문제(네트워크·서버). 닫힌 링크와 한 화면으로 뭉치면 장애가 "닫힌 링크"로 보인다(/q 와 같은 이유).
type Phase = 'loading' | 'ready' | 'failed';

export default function EduLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const tk = typeof token === 'string' ? token : '';

  const [phase, setPhase] = useState<Phase>(tk ? 'loading' : 'ready');
  const [info, setInfo] = useState<EduLinkInfo>(CLOSED);
  const [entries, setEntries] = useState<EduLinkEntry[]>([]);
  // 개발 모드 StrictMode 가 이펙트를 두 번 돌려도 열람 수가 두 번 오르지 않게 토큰당 한 번만 연다.
  const openedFor = useRef<string | null>(null);

  // 이 브라우저에 로그인 세션이 있으면(가입하고 돌아옴) 이 기기에서 보낸 질문을 그 계정으로 옮길지 묻는다(사용자 결정 3 · 1112 fix 5).
  //   열쇠가 없거나 이미 답했으면 묻지 않는다. 화면은 지금처럼 손님 열쇠로 돈다.
  const userId = useSessionStore((s) => s.userId);
  const signedIn = useSessionStore((s) => s.status === 'signed_in');
  useEffect(() => {
    if (signedIn && userId) void askClaimEduGuests(userId);
  }, [signedIn, userId]);

  useEffect(() => {
    if (!tk || openedFor.current === tk) return;
    openedFor.current = tk;
    void (async () => {
      const v = await openEduLink(tk);
      if (v.failed) { setPhase('failed'); return; }
      if (!v.ok) { setInfo(CLOSED); setPhase('ready'); return; }
      const r = v.entryCount > 0 ? await fetchEduLinkEntries(tk) : { data: [] as EduLinkEntry[], error: null };
      if (r.error) { setPhase('failed'); return; }
      setInfo(v);
      setEntries(r.data ?? []);
      setPhase('ready');
    })();
  }, [tk]);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, title: '교육 링크' }} />

      {phase === 'loading' && <ScreenLoading label="노하우를 불러오고 있어요…" />}

      {phase === 'failed' && (
        <Appear style={st.fill}>
          <View style={st.center}>
            <Ionicons name="cloud-offline-outline" size={26} color={TextColor.iconMuted} />
            <Text style={st.centerText}>지금은 불러오지 못했어요.{'\n'}연결을 확인하고 잠시 후 다시 열어 주세요.</Text>
          </View>
        </Appear>
      )}

      {phase === 'ready' && !info.ok && <EduLinkView info={info} entries={[]} />}

      {phase === 'ready' && info.ok && (
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <EduLinkView
            info={info}
            entries={entries}
            askSlot={
              <View style={st.askStack}>
                <EduAsk token={tk} place={info.placeKind} ownerName={info.ownerName} />
                {/* 이어받기 코드(사용자 결정 3) — 웹에서만. 앱 안에서는 /link/[id] 가 같은 일을 한다. */}
                {Platform.OS === 'web' ? <HandoffCode token={tk} /> : null}
              </View>
            }
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  // 헤더 없는 단독 화면이라 위·아래 안전 영역을 여기서 든다(/q 와 같다).
  safe: { flex: 1, backgroundColor: Surface.screen },
  scroll: { ...screenScrollStyle, paddingBottom: Space.xxl },
  fill: { flex: 1 },
  askStack: { gap: Gap.group },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, paddingHorizontal: Space.xl },
  centerText: { ...Type.body, fontWeight: '600', color: InkColors.ink2, textAlign: 'center', lineHeight: 23 },
});
