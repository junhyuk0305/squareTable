/**
 * 교육 링크 상세(S11 · 공간 주인) — 상태 · 주소 복사 · 노하우 넣기·빼기 · 기간 늘리기 · 링크 닫기.
 *
 * ★아직 들어오는 길이 없다(공간 입구가 꺼져 있다 · 의도). 공간 번호는 `?unit=` 으로 받는다.
 * ★기간은 만든 날부터 센다. 서버 상한 = 만든 시각 + 30일(edu_link_update). 이미 지난 끝 날은 고를 수 없다.
 * ★닫으면 되돌릴 수 없다. 받은 사람 쪽이 전부 끊긴다. 그래서 confirmAction 으로 한 번 묻고, 닫은 뒤 앞 화면으로 간다.
 * ★닫힌 링크·기간 끝난 링크는 고칠 수 없다(서버 link_closed · link_expired). 화면도 고치는 칸을 그리지 않는다.
 *   기간 끝난 링크는 닫을 수 있다(서버가 받는다).
 * 담긴 노하우가 나중에 지워졌거나 보관됐으면 목록에 안 보인다. 그 번호는 그대로 둔다(서버가 담긴 번호는 다시 검사하지 않는다).
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Appear } from '@/components/Appear';
import { PickRow } from '@/components/blocks/PickRow';
import { DayChips } from '@/components/edu/DayChips';
import {
  closeEduLink,
  fetchEduLinkPickEntries,
  fetchEduLinks,
  updateEduLink,
  type EduLinkPickEntry,
  type EduLinkRow,
} from '@/lib/db';
import { placeErrorMessage } from '@/lib/place/errors';
import { EDU_LINK_DAY_OPTIONS, createdPlusDays, daysLeft, eduLinkUrl } from '@/lib/edu/link';
import { SPACE_WORDS } from '@/lib/place/words';
import { copyLinkToast, COPY_LINK_LABEL } from '@/lib/quiz/link';
import { shareText } from '@/lib/utils/shareText';
import { confirmAction } from '@/lib/utils/confirm';
import { showToast } from '@/lib/store/useToastStore';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { EmptyStyles } from '@/lib/theme/empty';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const endDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export default function EduLinkDetailScreen() {
  const router = useRouter();
  const { id, unit } = useLocalSearchParams<{ id: string; unit?: string }>();
  const linkId = typeof id === 'string' ? id : '';
  const unitId = typeof unit === 'string' ? unit : '';

  const [link, setLink] = useState<EduLinkRow | null>(null);
  const [list, setList] = useState<EduLinkPickEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const loadKey = `${unitId}:${linkId}:${retry}`;
  const ready = !unitId || loadedFor === loadKey;

  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void Promise.all([fetchEduLinks(unitId), fetchEduLinkPickEntries(unitId)]).then(([links, entries]) => {
      if (!alive) return;
      const l = (links.data ?? []).find((x) => x.id === linkId) ?? null;
      setLink(l);
      setList(entries.data ?? []);
      setPicked(l?.entryIds ?? []);
      setDays(null);
      setFailed(!!links.error || !!entries.error);
      setLoadedFor(loadKey);
    });
    return () => { alive = false; };
  }, [unitId, linkId, loadKey]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = (eid: string) =>
    setPicked((prev) => (prev.includes(eid) ? prev.filter((x) => x !== eid) : [...prev, eid]));

  const header = <ScreenTitleHeader title={link?.title.trim() || SPACE_WORDS.link} backFallback />;

  if (!unitId || (ready && failed)) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadErrorState title="링크를 불러오지 못했어요" onRetry={() => setRetry((n) => n + 1)} />
      </Screen>
    );
  }
  if (!ready) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenLoading label="링크를 불러오고 있어요…" />
      </Screen>
    );
  }
  if (!link) {
    return (
      <Screen header={header}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={EmptyStyles.box}>
          <Text style={EmptyStyles.text}>{placeErrorMessage({ message: 'link_not_found' })}</Text>
        </View>
      </Screen>
    );
  }

  const closed = !!link.closedAt;
  const left = daysLeft(link.expiresAt);
  const expired = !closed && left === 0;
  const editable = !closed && !expired;
  const status = closed ? '닫힘' : expired ? '기간 끝남' : '열림';

  const nextExpiry = days !== null ? createdPlusDays(link.createdAt, days) : null;
  const dirty = !sameIds(picked, link.entryIds) || nextExpiry !== null;

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    const r = await updateEduLink(link.id, {
      entryIds: sameIds(picked, link.entryIds) ? undefined : picked,
      expiresAt: nextExpiry ?? undefined,
    });
    setBusy(false);
    if (r.error) { showToast(placeErrorMessage(r.error)); return; }
    showToast('저장했어요', 'good');
    setRetry((n) => n + 1);
  };

  const close = async () => {
    if (busy) return;
    const ok = await confirmAction(
      '링크를 닫을까요?',
      '닫으면 이 주소로 아무도 열 수 없어요. 다시 열 수는 없어요.',
      SPACE_WORDS.linkClose,
      { destructive: true, cancelLabel: '그대로 두기' },
    );
    if (!ok) return;
    setBusy(true);
    const r = await closeEduLink(link.id);
    setBusy(false);
    if (r.error) { showToast(placeErrorMessage(r.error)); return; }
    showToast('링크를 닫았어요', 'good');
    router.back();
  };

  const copy = async () => {
    const t = copyLinkToast(await shareText(eduLinkUrl(link.token)));
    if (t) showToast(t.text, t.tone);
  };

  // 지금 끝 날보다 앞이거나 이미 지난 날은 고를 수 없다(줄이기는 이 화면에서 하지 않는다 · 닫기가 있다).
  const cannotPick = (d: number) => {
    const t = new Date(createdPlusDays(link.createdAt, d)).getTime();
    return t <= Date.now() || t <= new Date(link.expiresAt).getTime();
  };

  return (
    <Screen header={header}>
      <Stack.Screen options={{ headerShown: false }} />

      <Appear style={st.card}>
        <View style={st.kvRow}>
          <Text style={st.kvLabel}>상태</Text>
          <Text style={[st.kvValue, !editable && st.kvMuted]}>{status}</Text>
        </View>
        {!closed ? (
          <View style={st.kvRow}>
            <Text style={st.kvLabel}>남은 기간</Text>
            <Text style={st.kvValue}>{left > 0 ? `${left}일 (${endDay(link.expiresAt)}까지)` : '없음'}</Text>
          </View>
        ) : null}
        <View style={st.kvRow}>
          <Text style={st.kvLabel}>열어 본 횟수</Text>
          <Text style={st.kvValue}>{link.openedCount > 0 ? `${link.openedCount}번` : '없음'}</Text>
        </View>
        {editable ? (
          <>
            <Text style={st.url} selectable>{eduLinkUrl(link.token)}</Text>
            <Pressable
              onPress={() => void copy()}
              accessibilityRole="button"
              accessibilityLabel={COPY_LINK_LABEL}
              style={({ pressed }) => [st.smallBtn, pressed && st.pressed]}
            >
              <Text style={st.smallBtnText}>{COPY_LINK_LABEL}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={st.desc}>
            {closed ? '닫힌 링크예요. 새 링크를 만들어 주세요.' : placeErrorMessage({ message: 'link_expired' })}
          </Text>
        )}
      </Appear>

      {editable ? (
        <>
          <Section title="담긴 노하우" hint={picked.length > 0 ? `${picked.length}개` : undefined}>
            {list.length === 0 ? (
              <View style={EmptyStyles.box}>
                <Text style={EmptyStyles.text}>담을 수 있는 노하우가 없어요.</Text>
              </View>
            ) : (
              <PickRow
                rows={list.map((e) => ({
                  key: e.id,
                  title: e.title,
                  chips: e.status === 'draft' ? [{ text: '초안' }] : undefined,
                  picked: pickedSet.has(e.id),
                  onToggle: () => toggle(e.id),
                }))}
              />
            )}
          </Section>

          <Section title="기간 늘리기" hint="만든 날부터">
            <DayChips
              options={EDU_LINK_DAY_OPTIONS}
              value={days}
              onChange={(d) => setDays((cur) => (cur === d ? null : d))}
              disabledOf={cannotPick}
            />
            {nextExpiry ? <Text style={st.desc}>{endDay(nextExpiry)}까지 열려요.</Text> : null}
          </Section>

          <Pressable
            onPress={() => void save()}
            disabled={busy || !dirty}
            accessibilityRole="button"
            accessibilityLabel="저장"
            style={({ pressed }) => [st.cta, (busy || !dirty) && st.off, pressed && st.pressed]}
          >
            <Text style={st.ctaText}>저장</Text>
          </Pressable>
        </>
      ) : null}

      {!closed ? (
        <Pressable
          onPress={() => void close()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={SPACE_WORDS.linkClose}
          style={({ pressed }) => [st.textBtn, pressed && st.pressed]}
        >
          <Text style={st.closeText}>{SPACE_WORDS.linkClose}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  card: { ...CardStyles.list, gap: Gap.item },
  kvRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.md },
  kvLabel: { ...Type.desc, fontWeight: '700', flexShrink: 0 },
  kvValue: { ...Type.body, fontWeight: '700', flex: 1, minWidth: 0, textAlign: 'right' },
  kvMuted: { color: TextColor.secondary },
  url: { ...Type.body, color: InkColors.ink },
  desc: { ...Type.desc, fontWeight: '600' },
  smallBtn: { ...ButtonStyles.small, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: InkColors.bg },
  smallBtnText: { ...ButtonTextStyles.small, color: InkColors.ink },
  cta: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  textBtn: { ...ButtonStyles.inlineHit, alignSelf: 'center', paddingHorizontal: Space.lg },
  closeText: { ...Type.body, fontWeight: '700', color: BrandColors.badText },
});
