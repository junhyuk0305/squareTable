/**
 * S16 앱 안 교육 링크(결정 82·118·153 · 사용자 결정 3) — 로그인한 사람이 받은 링크를 앱에서 연다.
 * 들어오는 길 = 매장 탭 "받은 교육 링크" 줄 · 코드 칸에 이어받기 코드 넣기 · 답 알림(/link/<번호>?uqId=).
 *
 * 흐름(서버가 판정한다):
 *  · 내가 받은 링크(my_edu_links · 살아 있는 것만)에 없으면 "이 링크는 닫혔어요." 한 화면. 닫힌 링크는 전부 끊긴다(결정 153).
 *  · 열 때 edu_link_me_key 로 이 기기 열쇠를 한 번 받는다. 그 열쇠로 웹 손님 화면과 같은 묻기·답·신고 길(EduAsk)을 쓴다.
 *    열쇠는 화면 상태에만 둔다. 기기 저장소에 남기지 않는다(같은 기기에서 계정이 바뀌어도 남의 질문이 안 보인다).
 *  · 공간 링크 + 공간 입구가 열린 계정 = [합류 신청하기](확인 한 번). 매장 링크에는 없다(결정 188). 이미 멤버면 서버가 그 문구를 준다.
 *  · ?uqId= 는 답 알림 착지다. 내 질문 칸은 묻는 칸 바로 아래라 첫 화면에 보인다. 질문 하나로 옮겨 가지는 않는다
 *    (edu_link_answers 가 답할 질문 번호를 주지 않는다 · 기록 g4b 가결정).
 * ★토큰·열쇠는 계측·로그에 싣지 않는다. 화면 계측은 경로 템플릿(/link/[id])만 남는다.
 * ★열람 수를 올리는 edu_link_open 은 부르지 않는다. 제목·자리 이름은 my_edu_links 가 준다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { EduAsk } from '@/components/edu/EduAsk';
import { EduLinkView } from '@/components/edu/EduLinkView';
import { useSessionGate } from '@/lib/hooks/useSessionGate';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction, notifyAction } from '@/lib/utils/confirm';
import {
  eduLinkMeKey, fetchEduLinkEntries, fetchMyEduLinks, requestSpaceJoin,
  type EduLinkEntry, type EduLinkInfo,
} from '@/lib/db';
import type { EduGuest } from '@/lib/edu/guestKey';
import { placeErrorCode, placeErrorMessage } from '@/lib/place/errors';
import { LINK_IN_APP, SPACE_MEMBERS, SPACE_WORDS, eduOwnerWord } from '@/lib/place/words';
import { InkColors, Surface } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Gap } from '@/lib/theme/layout';

const CLOSED: EduLinkInfo = { ok: false, failed: false, placeKind: null, placeName: '', ownerName: '', title: '', entryCount: 0, expiresAt: null };

type Phase = 'loading' | 'ready' | 'closed' | 'failed';

export default function LinkInApp() {
  const gate = useSessionGate();
  const { id } = useLocalSearchParams<{ id: string; uqId?: string }>();
  const linkId = typeof id === 'string' ? id : '';
  const userId = useSessionStore((s) => s.userId);
  const spaceOpen = useSessionStore((s) => s.spaceOpen);
  const loadSpaces = useSessionStore((s) => s.loadSpaces);

  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<EduLinkInfo>(CLOSED);
  const [entries, setEntries] = useState<EduLinkEntry[]>([]);
  const [token, setToken] = useState('');
  const [me, setMe] = useState<EduGuest | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinDone, setJoinDone] = useState(false);
  // 열쇠는 열 때 한 번만 받는다(개발 모드 StrictMode 가 이펙트를 두 번 돌려도 한 번).
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    const list = await fetchMyEduLinks();
    if (list.error) { setPhase('failed'); return; }
    const row = (list.data ?? []).find((x) => x.linkId === linkId);
    if (!row) { setPhase('closed'); return; }
    const k = await eduLinkMeKey(linkId);
    if (k.error || !k.data) {
      setPhase(placeErrorCode(k.error ?? null) === 'link_closed' ? 'closed' : 'failed');
      return;
    }
    const r = row.entryCount > 0 ? await fetchEduLinkEntries(k.data.token) : { data: [] as EduLinkEntry[], error: null };
    if (r.error) { setPhase('failed'); return; }
    setInfo({
      ok: true, failed: false, placeKind: row.placeKind, placeName: row.placeName,
      ownerName: row.ownerName ?? '', title: row.title, entryCount: row.entryCount, expiresAt: row.expiresAt,
    });
    setEntries(r.data ?? []);
    setToken(k.data.token);
    setMe({ key: k.data.key, name: k.data.name });
    setPhase('ready');
  }, [linkId]);

  useEffect(() => {
    if (!userId || !linkId || loadedFor.current === `${userId}:${linkId}`) return;
    loadedFor.current = `${userId}:${linkId}`;
    void load();
  }, [userId, linkId, load]);

  // 합류 신청 버튼은 공간 입구가 열린 계정에만 둔다(0460 합류 신청이 입구를 본다 · 눌러도 실패하는 버튼을 두지 않는다).
  useEffect(() => {
    if (userId && spaceOpen == null) void loadSpaces();
  }, [userId, spaceOpen, loadSpaces]);

  const owner = eduOwnerWord(info.placeKind, info.ownerName);
  const showJoin = phase === 'ready' && info.placeKind === 'space' && spaceOpen === true && !joinDone;

  const join = async () => {
    if (joinBusy || !token) return;
    const ok = await confirmAction(LINK_IN_APP.joinTitle, LINK_IN_APP.joinBody(owner), LINK_IN_APP.joinConfirm, { icon: 'people-outline' });
    if (!ok) return;
    setJoinBusy(true);
    const r = await requestSpaceJoin(token);
    setJoinBusy(false);
    if (r.error) {
      const c = placeErrorCode(r.error);
      if (c === 'already_member' || c === 'already_pending') setJoinDone(true);
      showToast(placeErrorMessage(r.error), 'warn');
      return;
    }
    setJoinDone(true);
    void notifyAction(SPACE_MEMBERS.requestedTitle, SPACE_MEMBERS.requestedBody, '확인', { icon: 'time-outline' });
  };

  if (gate !== undefined) return gate;

  return (
    <Screen header={<ScreenTitleHeader title={SPACE_WORDS.link} backFallback="/stores" />}>
      <Stack.Screen options={{ headerShown: false }} />
      {phase === 'loading' && <ScreenLoading label={LINK_IN_APP.loading} />}
      {phase === 'failed' && <LoadErrorState title={LINK_IN_APP.loadFail} onRetry={() => void load()} />}
      {phase === 'closed' && <EduLinkView info={CLOSED} entries={[]} />}
      {phase === 'ready' && me && (
        <EduLinkView
          info={info}
          entries={entries}
          askSlot={
            <View style={st.askStack}>
              <EduAsk token={token} place={info.placeKind} ownerName={info.ownerName} me={me} />
              {showJoin ? (
                <Pressable
                  onPress={() => void join()}
                  disabled={joinBusy}
                  accessibilityRole="button"
                  accessibilityLabel={LINK_IN_APP.join}
                  style={({ pressed }) => [st.btn, pressed && st.pressed, joinBusy && st.disabled]}
                >
                  {joinBusy ? <ActivityIndicator color={InkColors.ink} /> : <Text style={st.btnText}>{LINK_IN_APP.join}</Text>}
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  askStack: { gap: Gap.group },
  // 보조 버튼 — 화면의 Primary 는 묻는 칸의 [질문 보내기] 하나다.
  btn: { ...ButtonStyles.small, minHeight: 48, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: Surface.card },
  btnText: { ...ButtonTextStyles.small, color: InkColors.ink },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
