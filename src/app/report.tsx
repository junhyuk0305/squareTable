import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { KeyboardShift } from '@/components/KeyboardShift';
import { ContactModal } from '@/components/ContactModal';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { HAS_SUPABASE } from '@/lib/supabase';
import { fetchReportTargets, submitUserReport, type ReportTargetRow } from '@/lib/db';
import {
  AI_TARGET_LABEL,
  PERSON_CATEGORIES,
  REPORT_BODY_MAX,
  REPORT_DAYS,
  REPORT_DONE_TEXT,
  REPORT_NO_STORE_TEXT,
  prepareReport,
  reportErrorMessage,
} from '@/lib/report/form';
import { honorific } from '@/lib/utils/roles';
import { SPACE_WORDS } from '@/lib/place/words';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, screenScrollStyle } from '@/lib/theme/layout';
import { ChipStyles } from '@/lib/theme/chip';
import { Type } from '@/lib/theme/type';
import { CardStyles } from '@/lib/theme/card';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';

/**
 * 신고하기(F-1 · 0241) — 설정 > 약관·고객센터 > "신고하기". 사장·매니저·직원 모두 같은 화면이다.
 * 흐름: 매장(2곳 이상일 때) → 대상(같은 매장 사람 또는 "AI 답변 문제") → 어떤 일 → 내용 → 있었던 때(선택) → 보내기.
 * 신고는 운영자만 읽는다(user_reports 정책 0개). 차단 기능은 만들지 않는다(사용자 결정).
 * 설정류 화면이라 등장 애니메이션은 넣지 않고 ready 게이트만 둔다(ui.md 예외).
 */
export default function ReportScreen() {
  const status = useSessionStore((s) => s.status);
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false, title: '신고하기' }} />
      <ScreenTitleHeader title="신고하기" backFallback="/account-settings" />
      {HAS_SUPABASE && status === 'loading' ? <ScreenLoading label="계정 정보를 불러오고 있어요…" /> : <ReportBody />}
    </SafeAreaView>
  );
}

function ReportBody() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  // ★야간 g4a(결정 11): 공간 AI 답 아래 입구 = /report?unit=<공간>&ai=1. 내가 그 공간에 있으면 그 공간으로 고정하고 "AI 답변" 갈래를 연다.
  //   인자가 없으면 지금 화면 그대로다(설정 > 신고하기). 공간 목록을 아직 안 읽었으면 한 번 읽는다(딥링크로 바로 열 때).
  const params = useLocalSearchParams<{ unit?: string; ai?: string }>();
  const unitParam = typeof params.unit === 'string' ? params.unit : '';
  const spaces = useSessionStore((s) => s.spaces);
  const spacesLoaded = useSessionStore((s) => s.spacesLoaded);
  const loadSpaces = useSessionStore((s) => s.loadSpaces);
  useEffect(() => {
    if (unitParam && !spacesLoaded) void loadSpaces();
  }, [unitParam, spacesLoaded, loadSpaces]);
  const fixedSpace = unitParam ? spaces.find((x) => x.id === unitParam) : undefined;
  const waitSpace = !!unitParam && !spacesLoaded;
  const [picked, setPicked] = useState('');
  // 고른 매장이 목록에서 사라지면(나가기·전환) 활성 매장으로 돌아간다.
  const unitId = fixedSpace
    ? fixedSpace.id
    : stores.some((s) => s.unit_id === picked)
      ? picked
      : ((stores.find((s) => s.is_active) ?? stores[0])?.unit_id ?? '');

  // 대상 목록은 매장마다 다르다. 응답에 어느 매장·몇 번째 요청인지 붙여 두고, 지금 매장과 맞을 때만 쓴다
  // (늦게 온 옛 매장 응답이 새 매장 목록 자리에 들어가지 않는다).
  const [reload, setReload] = useState(0);
  const [res, setRes] = useState<{ unit: string; n: number; rows: ReportTargetRow[] | null; err: string | null } | null>(null);
  const fresh = res && res.unit === unitId && res.n === reload ? res : null;
  const targets = fresh?.rows ?? null;
  const loadErr = fresh?.err ?? null;
  const [picks, setPicks] = useState<string | null>(null);
  // 고른 사람이 지금 매장 목록에 없으면(매장을 바꿨다) 안 고른 것으로 본다.
  const targetId = targets?.some((t) => t.user_id === picks) ? picks : null;
  const [ai, setAi] = useState(params.ai === '1');
  const [category, setCategory] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [day, setDay] = useState<number | null>(null);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [contact, setContact] = useState(false);

  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void fetchReportTargets(unitId).then(({ data, error }) => {
      if (!alive) return;
      setRes(
        error || !data
          ? { unit: unitId, n: reload, rows: null, err: reportErrorMessage(error, '사람 목록을 불러오지 못했어요. 다시 시도해 주세요.') }
          : { unit: unitId, n: reload, rows: data, err: null },
      );
    });
    return () => {
      alive = false;
    };
  }, [unitId, reload]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/account-settings' as never);
  };

  const submit = async () => {
    const r = prepareReport({ unitId, targetId, ai, category, body, day, time });
    if (r.error !== null) return setMsg(r.error);
    setBusy(true);
    setMsg(null);
    const { error } = await submitUserReport(r.payload);
    setBusy(false);
    if (error) return setMsg(reportErrorMessage(error));
    setDone(true);
  };

  let content: React.ReactNode;
  if (waitSpace) {
    return <ScreenLoading label="신고할 사람을 불러오고 있어요…" />;
  } else if (!fixedSpace && stores.length === 0) {
    content = (
      <View style={styles.card}>
        <Text style={styles.body}>{REPORT_NO_STORE_TEXT}</Text>
        <Text style={styles.body}>다른 일은 문의하기로 알려 주세요.</Text>
        <Pressable onPress={() => setContact(true)} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.ghostText}>문의하기</Text>
        </Pressable>
      </View>
    );
  } else if (done) {
    content = (
      <View style={styles.card}>
        <View style={styles.doneHead}>
          <Ionicons name="checkmark-circle" size={22} color={BrandColors.brand} />
          <Text style={styles.doneTitle}>{REPORT_DONE_TEXT}</Text>
        </View>
        <Pressable onPress={goBack} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.ghostText}>돌아가기</Text>
        </Pressable>
      </View>
    );
  } else if (loadErr) {
    content = (
      <View style={styles.card}>
        <Text style={styles.body}>{loadErr}</Text>
        <Pressable onPress={() => setReload((n) => n + 1)} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.ghostText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  } else if (!targets) {
    return <ScreenLoading label="신고할 사람을 불러오고 있어요…" />;
  } else {
    content = (
      <View style={styles.card}>
        <Text style={styles.body}>신고 내용은 운영팀만 봐요.</Text>

        {fixedSpace ? (
          <>
            <Text style={styles.label}>{SPACE_WORDS.place}</Text>
            <Text style={styles.body}>{fixedSpace.name}</Text>
          </>
        ) : null}

        {!fixedSpace && stores.length > 1 && (
          <>
            <Text style={styles.label}>매장</Text>
            <View style={styles.chipWrap}>
              {stores.map((s) => (
                <Chip key={s.unit_id} label={s.store_name} on={s.unit_id === unitId} onPress={() => setPicked(s.unit_id)} />
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>신고 대상</Text>
        <View style={styles.chipWrap}>
          {targets.map((t) => (
            <Chip
              key={t.user_id}
              label={honorific(t.name ?? '이름 없음', t.role)}
              on={!ai && targetId === t.user_id}
              onPress={() => {
                setAi(false);
                setPicks(t.user_id);
              }}
            />
          ))}
          <Chip label={AI_TARGET_LABEL} on={ai} onPress={() => setAi(true)} />
        </View>

        {!ai && (
          <>
            <Text style={styles.label}>어떤 일</Text>
            <View style={styles.chipWrap}>
              {PERSON_CATEGORIES.map((c) => (
                <Chip key={c.key} label={c.label} on={category === c.key} onPress={() => setCategory(c.key)} />
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>내용</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={ai ? '어떤 질문에 어떤 답이 나왔는지 적어 주세요' : '무슨 일이 있었는지 적어 주세요'}
          placeholderTextColor={InkColors.ink3}
          style={[styles.input, styles.inputMulti]}
          multiline
          maxLength={REPORT_BODY_MAX}
          accessibilityLabel="신고 내용 입력"
        />

        <Text style={styles.label}>있었던 때 (선택)</Text>
        <View style={styles.chipWrap}>
          {REPORT_DAYS.map((d) => (
            <Chip key={d.offset} label={d.label} on={day === d.offset} onPress={() => setDay(day === d.offset ? null : d.offset)} />
          ))}
        </View>
        {day !== null && (
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="18:30"
            placeholderTextColor={InkColors.ink3}
            style={styles.input}
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="있었던 시각 입력"
          />
        )}
        <Text style={styles.hint}>더 전에 있었던 일은 내용에 날짜를 적어 주세요.</Text>

        <Pressable
          disabled={busy}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="신고 보내기"
        >
          {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>신고 보내기</Text>}
        </Pressable>
        {msg && <Text style={styles.msg}>{msg}</Text>}
      </View>
    );
  }

  return (
    <>
      <KeyboardShift>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
      </KeyboardShift>
      <ContactModal visible={contact} onClose={() => setContact(false)} />
    </>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Surface.screen },
  scroll: screenScrollStyle,
  card: { ...CardStyles.list, gap: Space.sm },
  body: { fontSize: 15, lineHeight: 22, color: TextColor.secondary },
  label: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: TextColor.secondary, marginTop: Space.md },
  hint: { ...Type.desc },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: { ...ChipStyles.chip, maxWidth: '100%' },
  chipOn: ChipStyles.chipOn,
  chipText: ChipStyles.text,
  chipTextOn: ChipStyles.textOn,
  // 카드 없이 회색 바탕(Surface.screen)에 바로 놓인 칸 — 흰 면 + 진한 선(lineStrong · 2026-11-02 결정).
  input: {
    ...Type.body,
    borderWidth: 1,
    borderColor: InkColors.lineStrong,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: Surface.input,
  },
  inputMulti: { minHeight: 120, textAlignVertical: 'top' },
  primary: { ...ButtonStyles.primary, marginTop: Space.md, backgroundColor: BrandColors.brand },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  msg: { fontSize: 15, lineHeight: 22, color: BrandColors.accentText, fontWeight: '700', textAlign: 'center' },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  doneTitle: { ...Type.title, flex: 1, minWidth: 0 },
  ghost: { ...ButtonStyles.primary, marginTop: Space.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostText: { fontSize: Type.body.fontSize, fontWeight: '700', color: TextColor.secondary },
});
