import { useEffect, useRef, useState } from 'react';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import { StepDock } from '@/components/StepDock';
import { askBeforeLeave, changedFields } from '@/lib/utils/formDirty';
import { useWebLeaveGuard } from '@/lib/hooks/useWebLeaveGuard';

import { ScreenLoading } from '@/components/ScreenLoading';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Screen, Section } from '@/components/Screen';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { fetchDeleteStorePreview, fetchUnitBizNo, saveUnitBizNo } from '@/lib/db';
import { deleteStoreConfirmText, deleteStoreToast } from '@/lib/account/storeCopy';
import { maskHHMM } from '@/lib/utils/attendance';
import { formatBizNo, isValidBizNo } from '@/lib/utils/bizno';
import { friendlyError } from '@/lib/utils/userError';
import { WEEKDAY_LABELS, WEEKDAY_ORDER, closedDaysLabel } from '@/lib/utils/schedule';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, screenScrollStyle } from '@/lib/theme/layout';
import { Type } from '@/lib/theme/type';
import { ButtonStyles, ButtonTextStyles, TouchSize } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * 게이트 껍데기 — 폼 본체를 **자식으로 분리한 이유**가 여기에 있다.
 * `StoreConfigForm`은 `useState(config.open)` 처럼 스토어 값을 **마운트 시 한 번** 로컬 state로 복사한다.
 * 하이드레이트 전에 마운트되면 `DEFAULT_CONFIG`(09:00~22:00·연중무휴·빈 비고)가 그대로 얼어붙고,
 * 나중에 도착한 DB 값이 반영되지 않은 채 저장되면 **실제 운영시간·휴무·비고가 기본값으로 덮인다.**
 * 게이트만 두고 폼을 같은 컴포넌트에 남기면 useState가 이미 실행된 뒤라 안 고쳐진다 — 분리가 곧 수정이다.
 * (설정 성격 화면이라 등장 애니메이션은 의도적으로 넣지 않는다.)
 */
export default function OwnerStoreConfigScreen() {
  const loaded = useScheduleStore((s) => s.loaded);
  // ★★2026-08-25 `loaded` 계약 통일과 **한 세트로** 들어와야 하는 가드다(#48).
  //   예전엔 "조회 실패 = loaded 안 올림"이라 이 폼이 아예 안 떠서 **우연히** 안전했다.
  //   loaded 가 "시도가 끝났다"로 바뀐 지금, 이 분기가 없으면 조회 실패 시 폼이 DEFAULT_CONFIG
  //   (09:00~22:00·연중무휴·빈 비고)로 마운트되고 저장 버튼까지 살아 있다 —
  //   누르는 순간 **서버의 실제 운영시간·정기휴무·비고가 지워진다.** 위 주석이 막으려던 바로 그 사고다.
  const configLoadError = useScheduleStore((s) => s.configLoadError);
  const retry = useScheduleStore((s) => s.retry);

  return (
    // 바탕·헤더·탭바 = Screen. 스크롤은 폼이 직접 든다(scroll={false}) — 게이트가 폼 자리를 바꾸고 KeyboardShift 가 스크롤을 감싼다.
    // 탭바 없음(화면조립표 2026-11-17 11절 5번 · 고치기 화면). 맨 아래는 저장 띠다.
    <Screen header={<ScreenTitleHeader title="매장 기본 정보" backFallback />} scroll={false}>
      <Stack.Screen options={{ title: '매장 기본 정보' }} />
      {!loaded ? (
        <ScreenLoading label="매장 정보를 불러오고 있어요…" />
      ) : configLoadError ? (
        <LoadErrorState screen title="매장 정보를 불러오지 못했어요" onRetry={() => void retry()} />
      ) : (
        <StoreConfigForm />
      )}
    </Screen>
  );
}

function StoreConfigForm() {
  const router = useRouter();
  const config = useScheduleStore((s) => s.config);
  const setConfig = useScheduleStore((s) => s.setConfig);

  const navigation = useNavigation();
  const [open, setOpen] = useState(config.open);
  const [close, setClose] = useState(config.close);
  const [closedDays, setClosedDays] = useState<number[]>(config.closedDays);
  const [note, setNote] = useState(config.note);
  const [saved, setSaved] = useState(false);
  // 0093: 매장 삭제·사업자등록번호 = 사장 전용(잠금 영역). 매니저에겐 그 칸 자체를 비노출.
  const isOwner = useSessionStore((s) => s.role) === 'owner';
  const biz = useBizNo(isOwner);

  // 심야 영업(예: 22:00→02:00) 허용 — close < open 은 자정을 넘는 정상 케이스다.
  // open===close(영업시간 0)만 무효로 막는다.
  const valid = TIME_RE.test(open) && TIME_RE.test(close) && open !== close;

  const toggleDay = (wd: number) =>
    setClosedDays((p) => (p.includes(wd) ? p.filter((x) => x !== wd) : [...p, wd]));

  // 저장 안 한 칸 — 판정 = formDirty(한 곳). 저장된 값(스토어·읽어 온 번호)과 지금 칸을 비교한다.
  const configChanged = changedFields(
    { open: config.open, close: config.close, closedDays: config.closedDays, note: config.note },
    { open, close, closedDays, note },
  );
  const bizChanged = biz.editable ? changedFields({ bizNo: biz.saved }, { bizNo: biz.value }) : [];
  const changed = [...configChanged, ...bizChanged];

  // ★"저장됐어요 ✓"는 서버 확인 뒤에만 뜬다(조용한 오류 D). 예전엔 쓰기를 기다리지 않고 성공을 말한 뒤
  //   450ms 만에 화면을 떠나, 사장이 성공 메시지를 본 다음 **다른 화면에서** 실패 배너를 받았다.
  //   실패 시 배너·롤백은 setConfig(guardWrite)가 이미 처리한다 — 여기선 성공했을 때만 착지시킨다.
  // 저장 버튼은 맨 아래 하나(화면조립표 2026-11-17 추천대로). 운영시간·휴무·비고·사업자등록번호를 한 번에 저장한다.
  const [saving, setSaving] = useState(false);
  const leaving = useRef(false);
  const save = async () => {
    if (!valid || saving || changed.length === 0) return;
    setSaving(true);
    const okConfig = configChanged.length === 0 || (await setConfig({ open, close, closedDays, note: note.trim() }));
    const okBiz = okConfig && (bizChanged.length === 0 || (await biz.save()));
    setSaving(false);
    if (!okConfig || !okBiz) return;
    setSaved(true);
    leaving.current = true;
    setTimeout(() => router.back(), 450);
  };

  // 저장 안 한 값이 있으면 나가기 전에 묻는다(결함 · 2026-11-17). 머리 뒤로·안드 뒤로는 화면을 빼는 동작이라 여기서 받는다.
  //   저장이 끝나 스스로 나가거나 매장을 지워 나갈 때는 묻지 않는다(leaving).
  const confirmLeave = () =>
    confirmAction('저장하지 않고 나갈까요?', '고친 값은 저장되지 않아요.', '나가기', { destructive: true, icon: 'alert-circle-outline' });
  // 웹 브라우저 뒤로는 라우터가 beforeRemove 없이 처리해 위가 못 받는다. 그래서 웹만 따로 건다(useWebLeaveGuard).
  //   저장했으면(saved) 걸지 않는다. 묻는 창이 떠 있는 동안 또 누르면 창을 하나 더 띄우지 않는다(asking).
  const asking = useRef(false);
  const webGuard = useWebLeaveGuard(askBeforeLeave(changed, saving) && !saved, (leave) => {
    if (asking.current) return;
    asking.current = true;
    void confirmLeave().then((ok) => {
      asking.current = false;
      if (!ok) return;
      leaving.current = true;
      leave();
    });
  });
  usePreventRemove(askBeforeLeave(changed, saving), ({ data }) => {
    // 라우터가 브라우저 기록을 옮기기 전에 웹 걸이를 푼다. 안 풀면 그 popstate 를 걸이가 가로챈다.
    if (leaving.current) {
      webGuard.release();
      return navigation.dispatch(data.action);
    }
    void confirmLeave().then((ok) => {
      if (!ok) return;
      webGuard.release();
      navigation.dispatch(data.action);
    });
  });

  // 다점포 매장 삭제 — 매장이 2개 이상일 때만. 파괴적이라 빨강 확인 → 성공 시 활성 재지정·목록 갱신.
  const stores = useSessionStore((s) => s.stores);
  const storeName = useSessionStore((s) => s.storeName);
  const deleteStore = useSessionStore((s) => s.deleteStore);
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false); // 삭제 미리보기를 읽는 동안 버튼을 잠근다

  const onDelete = async () => {
    const unitId = useSessionStore.getState().unitId;
    // J8: 서버가 남은 몫을 돌려주는 매장에만 기간 문장을 붙인다(delete_store_preview · 정책 M2).
    //   못 읽으면 null → 약속하지 않는다. 웹도 앱과 같이 부른다(토스 동결 2026-11-10 해제).
    setChecking(true);
    const { data: preview } = await fetchDeleteStorePreview(unitId);
    setChecking(false);
    const ok = await confirmAction(
      '이 매장을 삭제할까요?',
      deleteStoreConfirmText({ storeName, preview }),
      '삭제',
      { destructive: true, icon: 'trash-outline' },
    );
    if (!ok) return;
    setDeleting(true);
    const { error, result } = await deleteStore(unitId);
    setDeleting(false);
    if (error) return showToast(error, 'warn');
    showToast(deleteStoreToast({ result: result ?? null }));
    leaving.current = true;
    router.replace('/owner/dashboard');
  };

  return (
    <KeyboardShift>
    <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={screenScrollStyle} showsVerticalScrollIndicator={false}>
      <Text style={styles.lead}>운영시간과 정기 휴무를 정해두면 근무표에 반영돼요.</Text>

      {/* 운영시간 — 이 화면의 최우선. 2026-08-06: 카드 껍데기를 벗겨 시각 자체가 화면에서 가장 큰
          요소가 되게 했다(세 섹션이 전부 '제목→카드'라 한 종류의 나열로 읽히던 것을 여기서 끊는다).
          2026-11-16 R-14: 입력·선택지는 흰 카드 위(사용자 규칙) — 세 섹션 모두 다시 카드에 담는다. */}
      <Section title="운영시간" card>
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.timeLabel}>오픈</Text>
            <TextInput
              value={open}
              onChangeText={(t) => setOpen(maskHHMM(t))}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="09:00"
              placeholderTextColor={InkColors.ink3}
              style={[styles.timeInp, !TIME_RE.test(open) && open.length > 0 && styles.bad]}
            />
          </View>
          <Ionicons name="arrow-forward" size={16} color={InkColors.ink3} style={styles.timeArrow} />
          <View style={styles.timeField}>
            <Text style={styles.timeLabel}>마감</Text>
            <TextInput
              value={close}
              onChangeText={(t) => setClose(maskHHMM(t))}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="22:00"
              placeholderTextColor={InkColors.ink3}
              style={[styles.timeInp, !TIME_RE.test(close) && close.length > 0 && styles.bad]}
            />
          </View>
        </View>
        {!valid && <Text style={styles.warn}>HH:MM 형식으로, 오픈이 마감보다 빠르게 입력해 주세요.</Text>}
      </Section>

      {/* 정기 휴무 — 카드 없이 칩 줄. 선택 상태 요약(연중무휴·월·화)은 라벨 우측 hint 로 올렸다. */}
      <Section title="정기 휴무" hint={closedDaysLabel(closedDays)} card>
        <View style={styles.dows}>
          {WEEKDAY_ORDER.map((wd) => {
            const on = closedDays.includes(wd);
            return (
              <Pressable key={wd} onPress={() => toggleDay(wd)} accessibilityState={{ selected: on }} aria-selected={on} style={styles.dowHit}>
                <View style={[styles.dow, on && styles.dowOn, wd === 0 && on && styles.dowSun]}>
                  <Text style={[styles.dowText, on && { color: InkColors.bubbleText }]}>{WEEKDAY_LABELS[wd]}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>쉬는 요일을 누르세요. 연중무휴면 모두 끄면 돼요.</Text>
      </Section>

      {/* 비고 — 이 화면에서 유일하게 카드로 남긴 블록(배치규칙⑤: 화면당 카드 1~2개는 남긴다).
          여러 줄 자유 입력이라 경계면이 있어야 어디까지 쓰는 칸인지 보인다. */}
      <Section title="비고" card>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="예) 14~15시 브레이크타임 · 명절 당일 휴무"
          placeholderTextColor={InkColors.ink3}
          style={styles.noteInp}
          multiline
        />
      </Section>

      {/* C8(0283): 사업자등록번호 — 가입·매장 만들기에서 비워 둔 번호를 여기서 넣는다. 사장 전용. 저장은 맨 아래 버튼 하나가 같이 한다. */}
      {isOwner ? <BizNoSection biz={biz} /> : null}

      {/* 다점포 전용 위험 구역 — 이 매장 삭제(사장 전용 + 매장 2개 이상일 때만) */}
      {isOwner && stores.length > 1 ? (
        <View style={styles.dangerBox}>
          <Text style={styles.dangerLabel}>위험 구역</Text>
          <Text style={styles.dangerDesc}>이 매장(“{storeName}”)을 완전히 삭제해요. 노하우·근무 기록 등 모든 데이터가 사라지고 되돌릴 수 없어요. (직원이 있으면 먼저 내보내야 해요.)</Text>
          <Pressable
            onPress={onDelete}
            disabled={deleting || checking}
            style={({ pressed }) => [styles.dangerBtn, (pressed || deleting) && { opacity: 0.65 }]}
            accessibilityRole="button"
            accessibilityLabel="이 매장 삭제"
          >
            <Ionicons name="trash-outline" size={16} color={BrandColors.badText} />
            <Text style={ButtonTextStyles.danger}>{deleting ? '삭제 중…' : '이 매장 삭제'}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
    <StepDock
      label={saved ? '저장됐어요 ✓' : saving ? '저장 중이에요' : '저장'}
      onPress={() => { void save(); }}
      disabled={!valid || changed.length === 0 || saved}
      busy={saving}
    />
    </KeyboardShift>
  );
}

/**
 * 사업자등록번호 칸의 값·읽기·저장(C8 · 0283). 저장은 set_store_biz_no RPC 만 쓴다(0268: units 직접 쓰기는 업종뿐).
 * 칸은 BizNoSection 이 그리고, 저장은 폼 맨 아래 버튼 하나가 부른다(화면조립표 2026-11-17 추천대로).
 * enabled = 사장일 때만 읽는다(매니저에겐 칸이 없다).
 */
function useBizNo(enabled: boolean) {
  const unitId = useSessionStore((s) => s.unitId);
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  // 어느 매장 번호를 읽어 왔는가 — 매장이 바뀌면 다시 읽을 때까지 칸을 잠근다(효과 안에서 바로 setState 하지 않는다).
  const [loadedUnit, setLoadedUnit] = useState<string | null>(null);
  const loaded = loadedUnit === unitId;
  const [loadFailed, setLoadFailed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetchUnitBizNo(unitId).then(({ data, error }) => {
      if (!alive) return;
      // 못 읽었으면 빈칸으로 덮지 않는다. 그 상태로 저장하면 있던 번호가 지워진다.
      setLoadFailed(!!error);
      setValue(formatBizNo(data ?? ''));
      setSaved(formatBizNo(data ?? ''));
      setLoadedUnit(unitId);
    });
    return () => { alive = false; };
  }, [unitId, enabled]);

  const editable = enabled && loaded && !loadFailed;

  /** 저장했으면 true. 형식 오류·서버 거절은 칸 아래 글로 알리고 false. */
  const save = async (): Promise<boolean> => {
    if (!editable) return true;
    if (value.trim() && !isValidBizNo(value)) {
      setErr('사업자등록번호 형식(10자리)을 확인해주세요.');
      return false;
    }
    setErr(null);
    const { data, error } = await saveUnitBizNo(unitId, value);
    if (error) {
      const m = error.message;
      setErr(/biz_no_mine/.test(m)
        ? '내 다른 매장에 이미 등록한 번호예요. 번호를 확인해 주세요.'
        : /duplicate_biz_no/.test(m)
          ? '다른 매장에 이미 등록된 번호예요. 번호를 확인해 주세요.'
          : /invalid_biz_no/.test(m)
            ? '사업자등록번호 형식(10자리)을 확인해주세요.'
            : /not_owner/.test(m)
              ? '사장님만 바꿀 수 있어요.'
              : friendlyError(m, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      return false;
    }
    setValue(formatBizNo(data ?? ''));
    setSaved(formatBizNo(data ?? ''));
    return true;
  };

  const onChange = (v: string) => { setErr(null); setValue(formatBizNo(v)); };
  return { value, saved, loaded, loadFailed, err, editable, save, onChange };
}

/** 사업자등록번호 칸(C8 · 0283). 값·저장은 useBizNo 가 든다. */
function BizNoSection({ biz }: { biz: ReturnType<typeof useBizNo> }) {
  return (
    <Section title="사업자등록번호" card>
      <TextInput
        value={biz.value}
        onChangeText={biz.onChange}
        editable={biz.editable}
        placeholder="123-45-67890"
        placeholderTextColor={InkColors.ink3}
        keyboardType="number-pad"
        style={styles.bizInp}
      />
      {biz.loadFailed ? (
        <Text style={styles.hint}>번호를 불러오지 못했어요. 잠시 후 다시 열어 주세요.</Text>
      ) : biz.err ? (
        <Text style={styles.bizErr}>{biz.err}</Text>
      ) : biz.value.length > 0 ? (
        <Text style={[styles.hint, isValidBizNo(biz.value) && styles.bizOk]}>
          {isValidBizNo(biz.value) ? '✓ 형식이 올바른 번호예요' : '번호 10자리를 확인해주세요'}
        </Text>
      ) : (
        <Text style={styles.hint}>비워 두고 저장하면 등록한 번호를 지워요.</Text>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  lead: { ...Type.desc },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  timeField: { flex: 1, alignItems: 'center', gap: Space.xs },
  // 필드 위 라벨 높이만큼 화살표를 내려 시각 입력의 세로 중앙에 맞춘다(라벨은 화살표 쪽에 없다).
  timeArrow: { marginTop: Space.gutter },
  timeLabel: { ...Type.tag, fontWeight: '700', color: TextColor.secondary },
  // 카드 보더가 사라졌으니 입력칸이 스스로 면을 갖는다 — 흰 배경에 흰 필드면 어디를 누르는지 안 보인다.
  timeInp: { alignSelf: 'stretch', textAlign: 'center', fontSize: 24, fontWeight: '800', color: InkColors.ink, letterSpacing: 1, paddingVertical: 10, backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  bad: { borderColor: BrandColors.bad },
  warn: { ...Type.body, color: BrandColors.badText, fontWeight: '700', textAlign: 'center' },

  dows: { flexDirection: 'row', justifyContent: 'space-between' },
  // 요일 원 = 보이는 38 그대로 · 누르는 높이 40(2026-11-02 사용자 결정 · 칩·요일 원). 7개가 한 줄에 서야 해서 44 대신 40.
  // 너비는 한 칸(1/7) 전체 — 원 사이를 눌러도 가까운 요일이 켜진다(2026-11-03 QA F2).
  dowHit: { flex: 1, height: TouchSize.chip, alignItems: 'center', justifyContent: 'center' },
  dow: { width: 38, height: 38, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  dowSun: { backgroundColor: BrandColors.badSolid, borderColor: BrandColors.bad },
  dowText: { fontSize: Type.body.fontSize, fontWeight: '800', color: TextColor.secondary },
  hint: Type.desc,

  noteInp: { ...Type.body, minHeight: 56, lineHeight: 22, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },

  // 칸 늘이기 — 맨 아래 저장 띠(StepDock)가 스크롤 밖 바닥에 붙는다.
  fill: { flex: 1 },

  // 카드 없이 회색 바탕(Surface.screen)에 바로 놓인 칸 — 흰 면 + 진한 선이어야 보인다(검색창과 같은 lineStrong).
  bizInp: { ...Type.body, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.lineStrong, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  bizOk: { color: BrandColors.goodText },
  bizErr: { ...Type.tag, fontWeight: '700', color: BrandColors.badText },
  // 위험 구역 — 목록 카드 모양 + 빨강 선. 위 여백은 위 칸들과 한 번 더 떼어 둔다.
  dangerBox: { ...CardStyles.list, marginTop: Space.lg, borderColor: BrandColors.bad, gap: 8 },
  dangerLabel: { ...Type.tag, fontWeight: '800', color: BrandColors.badText, letterSpacing: 0.3 },
  dangerDesc: { ...Type.desc },
  // 매장 삭제 = 위험 버튼(연한 빨강 · 가로 꽉). 주 버튼 모양은 맨 아래 저장 하나다(화면조립표 2026-11-17 추천대로).
  dangerBtn: { ...ButtonStyles.danger, alignSelf: 'stretch', flexDirection: 'row', gap: 6, marginTop: 4 },
});
