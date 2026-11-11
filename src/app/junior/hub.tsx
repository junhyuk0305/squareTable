import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { KeyboardShift } from '@/components/KeyboardShift';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors, BrandColors, Surface, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Gap, Space, screenScrollStyle } from '@/lib/theme/layout';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { CardStyles } from '@/lib/theme/card';
import { Type } from '@/lib/theme/type';
import { SectionLabel } from '@/components/SectionLabel';
import { InfoDot } from '@/components/InfoDot';
import { SectionStack } from '@/components/Screen';
import { Wordmark } from '@/components/Wordmark';
import { Appear, stagger } from '@/components/Appear';
import { PhoneVerifyBlock } from '@/components/PhoneVerifyBlock';
import { INVITE_CODE_LEN, normalizeInviteCode } from '@/lib/utils/validation';
import { showToast } from '@/lib/store/useToastStore';
import { notifyAction } from '@/lib/utils/confirm';
import { HANDOFF, LINK_IN_APP, SPACE_MEMBERS } from '@/lib/place/words';

const CODE_LEN = INVITE_CODE_LEN;

// 직원 개인 허브 홈 — 회원가입 직후(매장 미연결) 착지점.
// 마이페이지 + 후킹 배너 + 가게 코드 입력 + 내 가게 목록을 한 화면에 모은다.
// 단일매장 모델이라 지금 '내 가게'는 0~1개지만, 목록(stores)으로 그려 향후 멀티매장 확장에 대비한다.
// 가게 합류는 joinByInvite 를 쓴다(0346 즉시 합류). 승인 대기 카드는 0346 전 옛 신청에만 보인다.
export default function JuniorHub() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  // S19(4번 덩이): 칸 하나로 공간 코드와 매장 코드를 받는다. 공간 입구가 닫힌 계정은 joinByInvite 그대로다.
  const joinByCode = useSessionStore((s) => s.joinByCode);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const pendingStoreName = useSessionStore((s) => s.pendingStoreName);
  const cancelJoinRequest = useSessionStore((s) => s.cancelJoinRequest);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);
  const rejectedJoinStoreName = useSessionStore((s) => s.rejectedJoinStoreName);
  const dismissRejectedJoin = useSessionStore((s) => s.dismissRejectedJoin);

  // 사장이 보낸 초대 링크로 가입해 들어온 경우에만 채워진다(signup 이 실어 보낸다).
  // 채우기만 하고 **자동 제출은 하지 않는다** — 합류는 직원이 누르는 것이다.
  const params = useLocalSearchParams<{ code?: string }>();
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState(typeof params.code === 'string' ? normalizeInviteCode(params.code) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ★서버가 PHONE_NOT_VERIFIED 로 막았을 때만 연다(#2). 예전엔 이 코드가 화이트리스트에 없어
  //   '코드를 확인하고 다시 시도해 주세요' 폴백으로 떨어졌고, 직원은 **정확한 코드를 무한 재입력**했다.
  //   그 시도가 join_attempts 에 적립돼 5번이면 10분 잠긴다 — 안내가 사용자를 잠금으로 몰고 갔다.
  const [needPhone, setNeedPhone] = useState(false);
  /** 인증 + profiles.phone 반영이 둘 다 끝났는가. PhoneVerifyBlock 이 올려준다. */
  const [phoneReady, setPhoneReady] = useState(false);
  const sessionPhone = useSessionStore((s) => s.phone);
  const updateProfile = useSessionStore((s) => s.updateProfile);

  // 내 가게 목록 — 단일매장이라 연결 시 1개. 멀티매장 전환 시 여기만 배열로 바뀐다.
  const stores = unitId ? [{ id: unitId, name: storeName || '내 매장' }] : [];
  const hasStore = stores.length > 0;

  const cells = Array.from({ length: CODE_LEN }, (_, i) => code[i] ?? '');

  const onChange = (v: string) => {
    setErr(null);
    setCode(normalizeInviteCode(v));
  };

  const focusCode = () => inputRef.current?.focus();

  const join = async () => {
    if (code.length < CODE_LEN) {
      setErr('6자리 초대코드를 모두 입력해주세요.');
      return;
    }
    if (needPhone && !phoneReady) {
      setErr('전화번호 인증을 완료해주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await joinByCode(code.trim());
    setBusy(false);
    // 이어받기 코드 갈래(0552 · 사용자 결정 3) — 웹 교육 링크에서 받은 코드면 그 링크를 앱 안(S16)에서 연다.
    if (res.kind === 'link_opened') {
      setCode('');
      setNeedPhone(false);
      showToast(LINK_IN_APP.opened, 'good');
      router.push({ pathname: '/link/[id]', params: { id: res.linkId } });
      return;
    }
    // 공간 코드 갈래(0461) — 바로 멤버면 그 공간(S17)으로 · 내보낸 사람이면 합류 신청이 들어갔다고 알린다.
    if (res.kind === 'space_joined') {
      setCode('');
      showToast(SPACE_MEMBERS.joinedToast(res.spaceName), 'good');
      router.replace({ pathname: '/space/joined/[id]', params: { id: res.spaceId } });
      return;
    }
    if (res.kind === 'space_requested') {
      setCode('');
      void notifyAction(SPACE_MEMBERS.requestedTitle, SPACE_MEMBERS.requestedBody, '확인', { icon: 'time-outline' });
      return;
    }
    const { error, pending, code: failCode } = res.kind === 'space_error' ? { error: res.error, pending: false, code: res.code ?? undefined } : res;
    // 전화 미인증이면 화면을 떠나지 않고 그 자리에서 인증 단계를 연다(막다른 화면 금지).
    if (failCode === 'PHONE_NOT_VERIFIED') setNeedPhone(true);
    if (error) {
      setErr(error);
      return;
    }
    setNeedPhone(false);
    setCode('');
    // ★0346 즉시 합류: 성공하면 그 매장 홈으로 간다. pending 은 0346 전 옛 신청(already_pending)일 때만 온다.
    if (!pending) router.replace('/junior/home');
  };

  const onCancelPending = async () => {
    setBusy(true);
    setErr(null);
    // 예전엔 반환값을 버려 RPC 실패 시 아무 반응 없이 대기카드가 그대로 남았다(#12 무음 no-op).
    // 이제 실패 사유를 대기카드 아래에 노출하고, 성공했을 때만 입력값을 정리한다.
    const { error } = await cancelJoinRequest();
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setCode('');
  };

  // 코드 입력 본문 — 상태 ①(매장 0개)과 ③('매장 추가' 섹션)이 **같은 한 벌**을 쓴다.
  // 컴포넌트로 쪼개지 않는다: 새 컴포넌트 경계를 만들면 상태가 바뀔 때 TextInput이 리마운트되며 포커스가 풀린다.
  const codeEntry = (
    <View style={styles.codeCard}>
      <Pressable onPress={focusCode} style={styles.cells}>
        {cells.map((ch, i) => (
          <View key={i} style={[styles.cell, i === Math.min(code.length, CODE_LEN - 1) && styles.cellActive]}>
            <Text style={styles.cellText}>{ch}</Text>
          </View>
        ))}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          keyboardType="ascii-capable"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LEN}
          style={styles.hiddenInput}
          caretHidden
          onSubmitEditing={join}
        />
      </Pressable>
      {/* 전화번호 인증 — 서버가 막았을 때만 나타난다. 사장 축(owner/create-store)과 같은 한 벌. */}
      {needPhone && (
        <PhoneVerifyBlock
          guide="매장에 합류하려면 본인 확인이 한 번 필요해요."
          okText="이제 합류할 수 있어요."
          initialPhone={sessionPhone}
          updateProfile={updateProfile}
          onVerifiedChange={setPhoneReady}
        />
      )}
      {err && <Text style={styles.err}>{err}</Text>}
      {/* 코드 6자를 다 넣기 전에는 흐리게 둔다(2026-11-10 W3 ④-9). 눌러도 막지 않는다 — 누르면 아래 err 가 이유를 말한다. */}
      <Pressable
        disabled={busy}
        onPress={join}
        style={({ pressed }) => [
          styles.primary,
          pressed && { opacity: 0.88 },
          (busy || code.length < CODE_LEN) && { opacity: 0.6 },
        ]}
      >
        {busy ? <ActivityIndicator color={InkColors.bubbleText} /> : <Text style={styles.primaryText}>합류하기</Text>}
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardShift>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 상단 바: 매장 선택으로(뒤로) + 워드마크.
            ★마이페이지 아이콘 버튼은 제거함(2026-07-29) — 같은 화면 아래 '마이페이지' 카드가 이미
              프로필 편집·로그아웃을 제공해 목적지가 완전히 겹쳤고(중복 진입점), 라벨 없는 아이콘 단독
              버튼이라 복잡도 원칙 P9(아이콘 단독 버튼 금지)에도 걸렸다. 이 화면의 목적은 '매장 합류'다. */}
        <View style={styles.topbar}>
          <View style={styles.topbarLeft}>
            {/* hub는 headerShown:false라 화면 안에 탈출 경로를 둔다 — 매장 선택(/stores)으로. */}
            <Pressable
              onPress={() => router.replace('/stores')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="매장 선택으로"
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
            </Pressable>
            <Wordmark size="sm" />
          </View>
        </View>

        {/* 인사 */}
        <Appear delay={stagger(0)}>
        <View style={styles.greet}>
          <Text style={styles.hello}>
            안녕하세요{userName ? `, ${userName}님` : ''}
          </Text>
          <Text style={styles.helloSub}>
            {hasStore
              ? '오늘도 시작해볼까요?'
              : pendingUnitId
                ? '사장님 승인을 기다리고 있어요.'
                : '사장님께 받은 6자리 코드를 넣으면 시작할 수 있어요.'}
          </Text>
        </View>
        </Appear>

        {/* 합류 미승인 안내(#미아 방지) — 승인 대기가 조용히 사라지던 것을 기기 마커로 감지해 알린다. */}
        {!pendingUnitId && !!rejectedJoinStoreName && (
          <Appear delay={stagger(1)}>
          <View style={styles.pendingCard}>
            <View style={styles.pendingHead}>
              <View style={styles.pendingIcon}>
                <Ionicons name="alert-circle-outline" size={20} color={BrandColors.warn} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName}>{rejectedJoinStoreName || '신청한 매장'}</Text>
                <Text style={styles.pendingMeta}>합류 신청이 승인되지 않았어요</Text>
              </View>
            </View>
            <Text style={styles.pendingBody}>코드를 다시 확인해 신청하거나, 사장님께 문의해 주세요.</Text>
            <View style={styles.pendingActions}>
              <Pressable onPress={dismissRejectedJoin} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.ghostBtnText}>닫기</Text>
              </Pressable>
            </View>
          </View>
          </Appear>
        )}

        {/* ══ 상태 분기 ══
            이 화면은 성격이 다른 세 상태를 겸한다(2026-08-06 정리).
              ① 매장 0개  = C 몰입형 — 할 일은 '코드 넣기' 하나. 입력을 최상단에 두고 그 외를 없앤다.
              ② 승인 대기 = C 몰입형 — 기다리는 것 말곤 할 게 없다. 대기 카드 하나.
                 (매장이 이미 있는 직원의 추가 신청도 같은 카드다 — 대기의 SSOT 는 profiles.pending_unit_id 이고
                  매장 유무와 무관하다. 그 아래 ③의 매장 목록은 그대로 두고, 코드 입력만 접는다.)
              ③ 매장 있음 = A 조합형 — 매장 고르기 + 그 아래 '매장 추가' 섹션(코드 입력을 접지 않는다 · 2026-11-10).
            옛 판본은 셋을 한 레이아웃으로 그려서 ①에 "코드를 넣어라"가 세 번(히어로 배너·빈 카드·
            입력 섹션) 나왔고, 그중 히어로의 [코드 입력]은 화면 이동이 아니라 포커스만 주는 가짜 버튼이었다.
            ③에서는 이미 연결된 직원에게 코드 입력이 상시 노출됐다. */}
        <Appear delay={stagger(2)}>
        <SectionStack>
        {(pendingUnitId || hasStore) && (
        <View style={styles.section}>
          {(pendingUnitId || hasStore) && <SectionLabel title="내 매장" />}

          <View style={styles.sectionCards}>
          {!!pendingUnitId && (
            <View style={styles.pendingCard}>
              <View style={styles.pendingHead}>
                <View style={styles.pendingIcon}>
                  <Ionicons name="hourglass-outline" size={20} color={BrandColors.warn} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{pendingStoreName || '신청한 매장'}</Text>
                  <Text style={styles.pendingMeta}>사장님 승인 대기 중</Text>
                </View>
              </View>
              <Text style={styles.pendingBody}>승인되면 바로 이 매장으로 들어갈 수 있어요.</Text>
              <View style={styles.pendingActions}>
                <Pressable disabled={busy} onPress={() => void refreshMembership()} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ghostBtnText}>승인 확인</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={onCancelPending} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ghostBtnText}>신청 취소</Text>
                </Pressable>
              </View>
              {/* 신청취소 실패 사유를 대기카드 안에서 노출(코드입력 섹션은 대기 중 숨겨져 err이 안 보였음 #12). */}
              {err && <Text style={styles.err}>{err}</Text>}
            </View>
          )}
          {hasStore &&
            stores.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.replace('/junior/home')}
                style={({ pressed }) => [styles.storeCard, pressed && { opacity: 0.9 }]}
              >
                <View style={styles.storeIcon}>
                  <Ionicons name="storefront-outline" size={20} color={InkColors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{s.name}</Text>
                  <Text style={styles.storeMeta}>탭하면 매장으로 들어가요</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
              </Pressable>
            ))}
          </View>
        </View>
        )}

        {/* 코드 입력 본문은 한 벌이고 한 자리에서만 그린다(SSOT).
            ① 매장 0개 — '초대코드' 섹션. 코드 입력이 곧 이 화면의 전부다.
            ③ 매장 있음 — 접지 않고 '매장 추가' 섹션으로 늘 보인다(2026-11-10 W3 ④-9 · 숨기지 않고 ⓘ로 설명).
            코드를 어디서 받는지는 늘 보이는 설명 줄 대신 제목 옆 ⓘ 하나가 말한다(두 상태 같은 문구). */}
        {!pendingUnitId && (
          <View style={styles.section} testID={hasStore ? 'hub-add-store' : 'hub-code-entry'}>
            <SectionLabel
              title={hasStore ? '매장 추가' : '초대코드'}
              titleAccessory={
                <InfoDot
                  title="초대코드"
                  body={`초대코드 6자리는 그 매장 사장님께 받아 넣으세요. 코드는 사장님 화면 설정 맨 위에 있어요.\n\n${HANDOFF.infoBody}`}
                />
              }
            />
            {codeEntry}
          </View>
        )}
        </SectionStack>
        </Appear>

        {/* 기능 소개 캐러셀(3장)은 2026-08-06에 제거했다.
            ① 합류 전 기능 소개는 시장 표준이 아니다(Slack·Discord·7shifts 전부 참여 후에 보여준다)
            ② 이 앱엔 이미 <JuniorWelcomeCoach>가 합류 직후 1회 뜬다 — '노하우 물어보기'가 겹쳤다
            ③ 코드를 넣은 사람은 입력칸 아래의 이 캐러셀을 볼 일이 없었다
            빠진 '출퇴근 체크'·'근무표 확인'은 JuniorWelcomeCoach로 옮겼다(실제로 쓸 수 있게 된 시점). */}

        {/* 내 계정 — 이 화면의 목적은 '매장 합류'이므로 계정 관리는 한 줄로 강등한다(IA 결정 1 = 안 A, 2026-07-29).
            ★통째로 옮기지 않은 이유: hub는 자체 상단바를 써서 HubTopBar의 계정 진입점이 없다. 카드를 없애면
              미합류 직원에게 로그아웃 경로가 사라진다. 대신 프로필편집·로그아웃·탈퇴를 모두 가진
              상위 화면(/account-settings) 한 줄로 합쳤다 — 요소 2개 → 1개, 기능은 오히려 늘어난다. */}
        <Appear delay={stagger(3)}>
        <View style={styles.section}>
          <Pressable
            onPress={() => router.push('/account-settings')}
            style={({ pressed }) => [styles.myRow, styles.myRowSolo, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="내 계정 — 프로필 편집·로그아웃"
          >
            <View style={styles.avatarSm}>
              <Text style={styles.avatarText}>{(userName || '?').slice(0, 1)}</Text>
            </View>
            <Text style={styles.myRowText}>{userName ? `${userName}님 · 내 계정` : '내 계정'}</Text>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </Pressable>
        </View>
        </Appear>
      </ScrollView>
      </KeyboardShift>
    </SafeAreaView>
  );
}

const CELL_GAP = 8;

const styles = StyleSheet.create({
  // 바탕 = 매장 안 화면과 같은 Surface.screen(2026-11-02 사용자 — 허브도 매장 내부와 같이).
  safe: { flex: 1, backgroundColor: Surface.screen },
  // 첫 여백·좌우·섹션 사이 = screenScrollStyle(상단바도 스크롤 안에 있다).
  scroll: screenScrollStyle,

  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topbarLeft: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  // 누르는 상자 48 — ScreenTitleHeader 뒤로가기와 같은 치수(RN-web 은 hitSlop 을 무시한다).
  backBtn: { marginLeft: -4, minWidth: 48, minHeight: 48, alignItems: 'flex-start', justifyContent: 'center' },

  greet: { gap: Gap.inline },
  // 허브 맨 위 제목 = Type.pageTitle(24/900).
  hello: { ...Type.pageTitle, color: InkColors.ink },
  helloSub: { ...Type.desc },

  // 섹션 = 제목(카드 밖) + 카드 묶음. 제목 ↔ 카드 10(SectionLabel 아래 2 + 8) · 카드끼리 12.
  section: { gap: Space.sm },
  sectionCards: { gap: Space.md },

  storeCard: { ...CardStyles.list, flexDirection: 'row', alignItems: 'center', gap: Space.md },
  storeIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  storeName: { ...Type.body, fontWeight: '800' },
  storeMeta: { ...Type.tag, color: TextColor.secondary, marginTop: 2 },

  pendingCard: { ...CardStyles.list, gap: Space.md },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  pendingIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: BrandColors.warnSoft, alignItems: 'center', justifyContent: 'center' },
  pendingMeta: { ...Type.tag, color: BrandColors.warnText, fontWeight: '700', marginTop: 2 },
  pendingBody: { ...Type.desc },
  pendingActions: { flexDirection: 'row', gap: Space.sm },
  // 작은 버튼(44 알약 · 15/800). 두 개가 한 줄을 나눠 가지므로 폭만 flex 1.
  ghostBtn: { ...ButtonStyles.small, flex: 1, alignSelf: 'auto', paddingHorizontal: Space.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostBtnText: { ...ButtonTextStyles.small, color: TextColor.secondary },

  codeCard: { ...CardStyles.list, gap: Space.md },
  cells: { flexDirection: 'row', gap: CELL_GAP, position: 'relative' },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 56,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: Surface.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: BrandColors.brand },
  // 칸 숫자 = Type.numCell(22/27/900).
  cellText: { ...Type.numCell, color: InkColors.ink },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent' },
  err: { fontSize: 15, color: BrandColors.accentText, fontWeight: '600' },
  primary: { ...ButtonStyles.primary, backgroundColor: BrandColors.brand },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },

  avatarSm: { width: 30, height: 30, borderRadius: Radius.pill, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: InkColors.bubbleText, fontSize: 14, fontWeight: '900' },
  myRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md },
  // 카드 안 행이 아니라 단독 행 — 행 목록 카드 모양을 스스로 갖고 터치 타깃 48dp를 지킨다.
  myRowSolo: { ...CardStyles.rows, minHeight: 48 },
  myRowText: { ...Type.body, flex: 1, fontWeight: '700' },
});
