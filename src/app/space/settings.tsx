import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { SettingsSection, SettingsRow } from '@/components/settings/SettingsKit';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import {
  aiQuotaStatusAt,
  decideSpaceJoinRequest,
  deleteSpace,
  fetchSpaceJoinRequests,
  fetchSpaceMembers,
  removeSpaceMember,
  type AiQuotaStatus,
  type SpaceJoinRequest,
  type SpaceMember,
} from '@/lib/db';
import { track } from '@/lib/analytics/track';
import { confirmAction, notifyAction } from '@/lib/utils/confirm';
import { shareText } from '@/lib/utils/shareText';
import { placeErrorMessage } from '@/lib/place/errors';
import { SPACE_MEMBERS, SPACE_SCREEN, SPACE_WORDS } from '@/lib/place/words';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { CardStyles } from '@/lib/theme/card';
import { Radius } from '@/lib/theme/elevation';
import { TouchSize, hitTrim } from '@/lib/theme/button';
import { Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

/**
 * S06 공간 설정(주인) — 공간 이름 · 초대코드 · 합류 신청(승인·거절) · 멤버(내보내기) · AI 사용량 · 더 쓰기 · 매장으로 돌아가기 · 공간 지우기.
 * 더 쓰기 = v1 결제 없음. 누른 수만 센다(space_more_use_tapped) → 안내 한 장.
 * 합류 신청·멤버는 0460 함수(주인만)를 공간 번호로 부른다. 확인 단계 = confirmAction 한 번 · 되돌리기 없음.
 * ?member=<요청한 사람> = N7 알림 착지(0460 url) → 그 신청 줄을 강조한다. ?space= 는 공간 _layout 이 먼저 들어가는 데 쓴다.
 */
export default function SpaceSettings() {
  const router = useRouter();
  const { member: focusMember } = useLocalSearchParams<{ member?: string }>();
  const spaceId = useSessionStore((s) => s.spaceId);
  const spaceName = useSessionStore((s) => s.spaceName);
  const spaces = useSessionStore((s) => s.spaces);
  const leaveSpace = useSessionStore((s) => s.leaveSpace);
  const inviteCode = spaces.find((s) => s.id === spaceId)?.inviteCode ?? null;
  const [quota, setQuota] = useState<AiQuotaStatus | null>(null);
  const [requests, setRequests] = useState<SpaceJoinRequest[]>([]);
  const [members, setMembers] = useState<SpaceMember[] | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadPeople = useCallback(async () => {
    if (!spaceId) return;
    const [req, mem] = await Promise.all([fetchSpaceJoinRequests(spaceId), fetchSpaceMembers(spaceId)]);
    // 신청 목록을 못 읽으면 그 칸만 빈다(멤버 목록 실패는 문구로 말한다 · 0명으로 위장하지 않는다).
    if (req.data) setRequests(req.data);
    if (mem.data) {
      setMembers(mem.data);
      setMembersFailed(false);
    } else setMembersFailed(true);
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      if (!spaceId) return;
      let alive = true;
      // 못 읽으면 행을 그리지 않는다(0건으로 위장하지 않는다 · 매장 설정과 같은 규칙).
      void aiQuotaStatusAt(spaceId).then(({ data }) => {
        if (alive) setQuota(data);
      });
      void loadPeople();
      return () => {
        alive = false;
      };
    }, [spaceId, loadPeople]),
  );

  const refreshBell = () => void import('@/lib/store/useCrossNotifStore').then(({ useCrossNotifStore }) => useCrossNotifStore.getState().retry());

  const decide = async (r: SpaceJoinRequest, accept: boolean) => {
    if (busy) return;
    if (!accept) {
      const ok = await confirmAction(SPACE_MEMBERS.rejectTitle, SPACE_MEMBERS.rejectBody(r.name), SPACE_MEMBERS.reject, {
        destructive: true,
        icon: 'close-circle-outline',
      });
      if (!ok) return;
    }
    setBusy(true);
    const { error } = await decideSpaceJoinRequest(r.requestId, accept);
    setBusy(false);
    if (error) showToast(placeErrorMessage(error), 'warn');
    else showToast(accept ? SPACE_MEMBERS.approved(r.name) : SPACE_MEMBERS.rejected, 'good');
    // 실패해도(이미 처리 등) 목록을 다시 읽어 지금 상태를 보인다. 벨의 신청 줄도 다시 맞춘다.
    void loadPeople();
    refreshBell();
  };

  const remove = async (m: SpaceMember) => {
    if (busy || !spaceId) return;
    const ok = await confirmAction(SPACE_MEMBERS.removeTitle, SPACE_MEMBERS.removeBody(m.name), SPACE_MEMBERS.remove, {
      destructive: true,
      icon: 'person-remove-outline',
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await removeSpaceMember(spaceId, m.userId);
    setBusy(false);
    if (error) showToast(placeErrorMessage(error), 'warn');
    else showToast(SPACE_MEMBERS.removed, 'good');
    void loadPeople();
  };

  const copyInvite = async () => {
    if (!inviteCode) return;
    const r = await shareText(inviteCode);
    showToast(r === 'copied' ? SPACE_MEMBERS.inviteCopied : SPACE_MEMBERS.inviteCopyFail, r === 'copied' ? 'good' : 'warn');
  };

  const removeSpace = async () => {
    if (busy || !spaceId) return;
    const ok = await confirmAction(SPACE_MEMBERS.deleteTitle, SPACE_MEMBERS.deleteBody, SPACE_MEMBERS.deleteRow, {
      destructive: true,
      icon: 'trash-outline',
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await deleteSpace(spaceId);
    setBusy(false);
    if (error) {
      showToast(placeErrorMessage(error), 'warn');
      return;
    }
    showToast(SPACE_MEMBERS.deleted, 'good');
    // 먼저 공간 밖으로 옮긴 뒤 상태를 비운다(문지기가 ?space= 로 다시 들어가려 하지 않게).
    router.replace('/stores');
    leaveSpace();
    void useSessionStore.getState().loadSpaces();
    refreshBell();
  };

  const moreUse = () => {
    const used = quota?.used ?? 0;
    const cap = quota?.cap ?? 0;
    track('space_more_use_tapped', { used, cap, used_pct: cap > 0 ? Math.round((used / cap) * 100) : 0 });
    void notifyAction(SPACE_SCREEN.moreUseTitle, SPACE_WORDS.moreUseSoon, '확인', { icon: 'sparkles-outline' });
  };

  const backToStores = () => {
    leaveSpace();
    router.replace('/stores');
  };

  return (
    <Screen header={<ScreenTitleHeader variant="tab" title={SPACE_SCREEN.tabSettings} line={spaceName} />} tabBar="space">
      <Stack.Screen options={{ headerShown: false }} />
      <SettingsSection>
        <SettingsRow first icon="library-outline" label={SPACE_SCREEN.settingsName} value={spaceName} />
        <SettingsRow
          icon="key-outline"
          label={SPACE_MEMBERS.inviteTitle}
          hint={inviteCode ? SPACE_MEMBERS.inviteHint : SPACE_MEMBERS.inviteNone}
          value={inviteCode ?? undefined}
          onPress={inviteCode ? () => void copyInvite() : undefined}
        />
      </SettingsSection>

      {requests.length > 0 ? (
        <Section title={SPACE_MEMBERS.requestsTitle(requests.length)}>
          <View style={styles.card}>
            {requests.map((r, i) => (
              <View key={r.requestId} style={[styles.row, i > 0 && styles.rowLine, r.userId === focusMember && styles.focus]}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                <Pressable
                  onPress={() => void decide(r, false)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name} ${SPACE_MEMBERS.reject}`}
                  style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
                >
                  <View style={styles.ghostBtn}>
                    <Text style={styles.ghostText}>{SPACE_MEMBERS.reject}</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => void decide(r, true)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name} ${SPACE_MEMBERS.approve}`}
                  style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
                >
                  <View style={styles.solidBtn}>
                    <Text style={styles.solidText}>{SPACE_MEMBERS.approve}</Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {membersFailed && !members ? (
        <Text style={styles.fail}>{SPACE_MEMBERS.membersLoadFail}</Text>
      ) : members ? (
        <Section title={SPACE_MEMBERS.membersTitle(members.length)}>
          <View style={styles.card}>
            {members.map((m, i) => (
              <View key={m.userId} style={[styles.row, i > 0 && styles.rowLine]}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.name}
                </Text>
                {m.role === 'space_owner' ? (
                  <Text style={styles.tag}>{SPACE_MEMBERS.ownerTag}</Text>
                ) : (
                  <Pressable
                    onPress={() => void remove(m)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name} ${SPACE_MEMBERS.remove}`}
                    style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
                  >
                    <View style={styles.ghostBtn}>
                      <Text style={styles.dangerText}>{SPACE_MEMBERS.remove}</Text>
                    </View>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <SettingsSection>
        {quota ? (
          <SettingsRow
            first
            icon="sparkles-outline"
            label={SPACE_SCREEN.settingsAi}
            hint={SPACE_SCREEN.settingsAiHint}
            value={`${quota.used.toLocaleString()} / ${quota.cap.toLocaleString()}`}
          />
        ) : null}
        <SettingsRow
          first={!quota}
          icon="add-circle-outline"
          label={SPACE_WORDS.moreUse}
          hint={SPACE_SCREEN.settingsMoreHint}
          onPress={moreUse}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          first
          icon="storefront-outline"
          label={SPACE_SCREEN.settingsBack}
          hint={SPACE_SCREEN.settingsBackHint}
          onPress={backToStores}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          first
          danger
          icon="trash-outline"
          label={SPACE_MEMBERS.deleteRow}
          hint={SPACE_MEMBERS.deleteHint}
          onPress={() => void removeSpace()}
        />
      </SettingsSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...CardStyles.rows },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: TouchSize.inline, paddingVertical: Space.sm },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: InkColors.line },
  // N7 착지 줄 — 색만이 아니라 굵은 테두리로도 구분한다.
  focus: { backgroundColor: BrandColors.yellowSoft, borderRadius: Radius.sm, paddingHorizontal: Space.sm, borderWidth: 1, borderColor: BrandColors.yellowDeep },
  name: { ...Type.body, fontWeight: '700', flex: 1 },
  tag: { ...Type.desc, color: TextColor.secondary },
  hit: { minWidth: TouchSize.inline, minHeight: TouchSize.inline, alignItems: 'center', justifyContent: 'center', marginVertical: hitTrim(TouchSize.inlineFace) },
  pressed: { opacity: 0.7 },
  ghostBtn: {
    minHeight: TouchSize.inlineFace,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { ...Type.desc, fontWeight: '800', color: InkColors.ink },
  dangerText: { ...Type.desc, fontWeight: '800', color: BrandColors.accentText },
  solidBtn: {
    minHeight: TouchSize.inlineFace,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solidText: { ...Type.desc, fontWeight: '800', color: InkColors.bg },
  fail: { ...Type.desc, color: TextColor.secondary },
});
