/**
 * 교육 링크 만들기·상세 부품 — 공간(S10·S11 · `src/app/space/link/*`)과 매장(M06 · `src/app/owner/edu-link/*`)이 같이 쓴다.
 * 2026-11-12 g7: 공간 두 화면의 본문을 그대로 옮겼다(동작 같음). 자리마다 다른 것만 props 로 받는다.
 *   - loadPick: 담을 목록. 공간 = fetchEduLinkPickEntries · 매장 = fetchStoreEduLinkPickEntries(본사 노하우 빼기 · 0555).
 *   - pickNote: 담을 목록 아래 한 줄(매장에 본사 노하우가 있을 때 STORE_LINK.pickNoBrand). 없으면 안 그린다.
 *   - onOpenDetail: 만든 뒤 [링크 상세 보기]가 갈 곳(자리마다 경로가 다르다).
 *
 * 만들기(S10)
 * ★고르기는 처음에 아무것도 골라 두지 않는다. "전부 고르기"도 두지 않는다(무엇을 보낼지는 주인이 하나씩 정한다).
 * ★비워도 만들 수 있다. 빈 링크는 받는 사람에게 "궁금한 걸 물어보세요"로 보인다(S14 빈 링크).
 * 공유는 주소 복사다. 퀴즈 링크·초대 링크와 같은 shareText(웹·네이티브 모두 클립보드)를 쓴다.
 *
 * 상세(S11)
 * ★기간은 만든 날부터 센다. 서버 상한 = 만든 시각 + 30일(edu_link_update). 이미 지난 끝 날은 고를 수 없다.
 * ★닫으면 되돌릴 수 없다. 받은 사람 쪽이 전부 끊긴다. 그래서 confirmAction 으로 한 번 묻고, 닫은 뒤 앞 화면으로 간다.
 * ★닫힌 링크·기간 끝난 링크는 고칠 수 없다(서버 link_closed · link_expired). 화면도 고치는 칸을 그리지 않는다.
 *   기간 끝난 링크는 닫을 수 있다(서버가 받는다).
 * 담긴 노하우가 나중에 지워졌거나 보관됐으면 목록에 안 보인다. 그 번호는 그대로 둔다(서버가 담긴 번호는 다시 검사하지 않는다).
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Screen, Section } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Appear } from '@/components/Appear';
import { PickRow } from '@/components/blocks/PickRow';
import { DayChips } from '@/components/edu/DayChips';
import {
  closeEduLink,
  createEduLink,
  fetchEduLinks,
  updateEduLink,
  type DbResult,
  type EduLinkPickEntry,
  type EduLinkRow,
} from '@/lib/db';
import { placeErrorMessage } from '@/lib/place/errors';
import { EDU_LINK_DAY_OPTIONS, EDU_LINK_DEFAULT_DAYS, createdPlusDays, daysLeft, eduLinkUrl } from '@/lib/edu/link';
import { SPACE_WORDS } from '@/lib/place/words';
import { copyLinkToast, COPY_LINK_LABEL } from '@/lib/quiz/link';
import { shareText } from '@/lib/utils/shareText';
import { confirmAction } from '@/lib/utils/confirm';
import { showToast } from '@/lib/store/useToastStore';
import { BrandColors, InkColors, TextColor } from '@/lib/theme/colors';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { EmptyStyles } from '@/lib/theme/empty';
import { Radius } from '@/lib/theme/elevation';
import { Gap, Space } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';

export type EduLinkPickLoader = (unitId: string) => Promise<DbResult<EduLinkPickEntry[]>>;

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const endDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

function PickNote({ text }: { text?: string }) {
  return text ? <Text style={st.desc}>{text}</Text> : null;
}

export function EduLinkNewForm({
  unitId,
  loadPick,
  pickNote,
  onOpenDetail,
}: {
  unitId: string;
  loadPick: EduLinkPickLoader;
  pickNote?: string;
  onOpenDetail: (linkId: string) => void;
}) {
  const [list, setList] = useState<EduLinkPickEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const loadKey = `${unitId}:${retry}`;
  const ready = !unitId || loadedFor === loadKey;

  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<number>(EDU_LINK_DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; token: string } | null>(null);

  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void loadPick(unitId).then((r) => {
      if (!alive) return;
      setList(r.data ?? []);
      setFailed(!!r.error);
      setLoadedFor(loadKey);
    });
    return () => { alive = false; };
  }, [unitId, loadKey, loadPick]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = async () => {
    if (busy || !unitId) return;
    setBusy(true);
    const r = await createEduLink(unitId, { title: title.trim(), entryIds: picked, days });
    setBusy(false);
    if (r.error || !r.data) { showToast(placeErrorMessage(r.error)); return; }
    setMade({ id: r.data.id, token: r.data.token });
  };

  const copy = async () => {
    if (!made) return;
    const t = copyLinkToast(await shareText(eduLinkUrl(made.token)));
    if (t) showToast(t.text, t.tone);
  };

  const header = <ScreenTitleHeader title="교육 링크 만들기" backFallback />;

  if (!unitId || (ready && failed)) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadErrorState title="노하우를 불러오지 못했어요" onRetry={() => setRetry((n) => n + 1)} />
      </Screen>
    );
  }

  if (!ready) {
    return (
      <Screen header={header} scroll={false}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenLoading label="노하우를 불러오고 있어요…" />
      </Screen>
    );
  }

  // 만든 뒤 — 주소와 복사 하나. 상세(S11)로 가면 넣기·빼기·기간·닫기를 한다.
  if (made) {
    return (
      <Screen header={header}>
        <Stack.Screen options={{ headerShown: false }} />
        <Appear style={st.doneCard}>
          <Text style={st.doneTitle}>링크를 만들었어요</Text>
          <Text style={st.url} selectable>{eduLinkUrl(made.token)}</Text>
          <Text style={st.desc}>주소를 복사해 카톡으로 보내 주세요.</Text>
        </Appear>
        <Pressable
          onPress={() => void copy()}
          accessibilityRole="button"
          accessibilityLabel={COPY_LINK_LABEL}
          style={({ pressed }) => [st.cta, pressed && st.pressed]}
        >
          <Text style={st.ctaText}>{COPY_LINK_LABEL}</Text>
        </Pressable>
        <Pressable
          onPress={() => onOpenDetail(made.id)}
          accessibilityRole="button"
          accessibilityLabel="링크 상세 보기"
          style={({ pressed }) => [st.textBtn, pressed && st.pressed]}
        >
          <Text style={st.textBtnText}>링크 상세 보기</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <Stack.Screen options={{ headerShown: false }} />

      <Section title="담을 노하우" hint={picked.length > 0 ? `${picked.length}개 고름` : undefined}>
        {list.length === 0 ? (
          <View style={EmptyStyles.box}>
            <Text style={EmptyStyles.text}>아직 노하우가 없어요.{'\n'}비워 둬도 링크를 만들 수 있어요.</Text>
          </View>
        ) : (
          <PickRow
            rows={list.map((e) => ({
              key: e.id,
              title: e.title,
              // 초안은 발행해야 받는 사람에게 보인다(서버 edu_link_entries 가 발행본만 준다).
              chips: e.status === 'draft' ? [{ text: '초안' }] : undefined,
              picked: pickedSet.has(e.id),
              onToggle: () => toggle(e.id),
            }))}
          />
        )}
        <PickNote text={pickNote} />
      </Section>

      <Section title="기간">
        <DayChips options={EDU_LINK_DAY_OPTIONS} value={days} onChange={setDays} />
      </Section>

      <Section title="제목" hint="선택">
        <TextInput
          style={st.input}
          value={title}
          onChangeText={setTitle}
          placeholder="예) 첫 출근 전에 읽어 주세요"
          placeholderTextColor={TextColor.placeholder}
          maxLength={40}
          returnKeyType="done"
          accessibilityLabel="링크 제목"
        />
        <Text style={st.desc}>비우면 &apos;{SPACE_WORDS.link}&apos;로 보여요.</Text>
      </Section>

      <Pressable
        onPress={() => void create()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="링크 만들기"
        style={({ pressed }) => [st.cta, busy && st.busy, pressed && st.pressed]}
      >
        <Text style={st.ctaText}>링크 만들기</Text>
      </Pressable>
    </Screen>
  );
}

export function EduLinkDetailForm({
  unitId,
  linkId,
  loadPick,
  pickNote,
}: {
  unitId: string;
  linkId: string;
  loadPick: EduLinkPickLoader;
  pickNote?: string;
}) {
  const router = useRouter();
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
    void Promise.all([fetchEduLinks(unitId), loadPick(unitId)]).then(([links, entries]) => {
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
  }, [unitId, linkId, loadKey, loadPick]);

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
            <Text style={st.detailUrl} selectable>{eduLinkUrl(link.token)}</Text>
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
            <PickNote text={pickNote} />
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
  input: {
    minHeight: 52, paddingHorizontal: Space.md,
    borderWidth: 1, borderColor: InkColors.lineStrong, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    ...Type.body,
  },
  desc: { ...Type.desc, fontWeight: '600' },
  cta: { ...ButtonStyles.primary, backgroundColor: InkColors.ink },
  ctaText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  busy: { opacity: 0.5 },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  doneCard: { ...CardStyles.list, gap: Gap.inline },
  doneTitle: { ...Type.section },
  // 띄어쓰기 없는 주소는 RN-web Text 기본 word-wrap 이 끊는다(ui.md 줄바꿈).
  url: { ...Type.body, color: InkColors.ink, marginTop: Space.sm },
  detailUrl: { ...Type.body, color: InkColors.ink },
  card: { ...CardStyles.list, gap: Gap.item },
  kvRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.md },
  kvLabel: { ...Type.desc, fontWeight: '700', flexShrink: 0 },
  kvValue: { ...Type.body, fontWeight: '700', flex: 1, minWidth: 0, textAlign: 'right' },
  kvMuted: { color: TextColor.secondary },
  smallBtn: { ...ButtonStyles.small, borderWidth: 1, borderColor: InkColors.lineStrong, backgroundColor: InkColors.bg },
  smallBtnText: { ...ButtonTextStyles.small, color: InkColors.ink },
  textBtn: { ...ButtonStyles.inlineHit, alignSelf: 'center', paddingHorizontal: Space.lg },
  textBtnText: { ...Type.body, fontWeight: '700', color: InkColors.ink2, textDecorationLine: 'underline' },
  closeText: { ...Type.body, fontWeight: '700', color: BrandColors.badText },
});
