import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Wordmark } from '@/components/Wordmark';
import { Appear } from '@/components/Appear';

const CODE_LEN = 6;

// 직원 개인 허브 홈 — 회원가입 직후(매장 미연결) 착지점.
// 마이페이지 + 후킹 배너 + 가게 코드 입력 + 내 가게 목록을 한 화면에 모은다.
// 단일매장 모델이라 지금 '내 가게'는 0~1개지만, 목록(stores)으로 그려 향후 멀티매장 확장에 대비한다.
// 가게 합류/승인 대기 로직은 기존 joinByInvite(승인제)를 그대로 재사용한다.
export default function JuniorHub() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const pendingStoreName = useSessionStore((s) => s.pendingStoreName);
  const cancelJoinRequest = useSessionStore((s) => s.cancelJoinRequest);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);
  const rejectedJoinStoreName = useSessionStore((s) => s.rejectedJoinStoreName);
  const dismissRejectedJoin = useSessionStore((s) => s.dismissRejectedJoin);

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 매장이 이미 있을 때 코드 입력을 접어두는 상태. 매장 0개면 이 값과 무관하게 항상 펼쳐진다. */
  const [addOpen, setAddOpen] = useState(false);

  // 내 가게 목록 — 단일매장이라 연결 시 1개. 멀티매장 전환 시 여기만 배열로 바뀐다.
  const stores = unitId ? [{ id: unitId, name: storeName || '내 매장' }] : [];
  const hasStore = stores.length > 0;

  const cells = Array.from({ length: CODE_LEN }, (_, i) => code[i] ?? '');

  const onChange = (v: string) => {
    setErr(null);
    setCode(v.replace(/[^0-9]/g, '').slice(0, CODE_LEN));
  };

  const focusCode = () => inputRef.current?.focus();

  // 접힌 줄을 펼치면 곧바로 입력 대기 상태로 — 펼치고 다시 탭하게 만들지 않는다.
  const openAdd = () => {
    setAddOpen((v) => {
      if (!v) setTimeout(focusCode, 120);
      return !v;
    });
  };

  const join = async () => {
    if (code.length < CODE_LEN) {
      setErr('6자리 초대코드를 모두 입력해주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const { error, pending } = await joinByInvite(code.trim());
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setCode('');
    // 승인제: 성공은 '승인 대기' 신청(pendingUnitId 세팅 → 아래 대기 카드로 전환).
    // 혹시 즉시 합류(레거시)면 바로 가게로 진입.
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

  // 코드 입력 본문 — 상태 ①(매장 0개)과 ③(펼친 '매장 추가하기')이 **같은 한 벌**을 쓴다.
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
          keyboardType="number-pad"
          maxLength={CODE_LEN}
          style={styles.hiddenInput}
          caretHidden
          onSubmitEditing={join}
        />
      </Pressable>
      {err && <Text style={styles.err}>{err}</Text>}
      <Pressable
        disabled={busy}
        onPress={join}
        style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}
      >
        {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>매장 추가하기</Text>}
      </Pressable>
      <Text style={styles.codeHint}>코드가 없으신가요? 사장님께 요청하세요 (사장님: 설정 › 매장 관리).</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
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
        <Appear delay={0}>
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
          <Appear delay={90}>
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
              ③ 매장 있음 = A 조합형 — 매장 고르기. 코드 입력은 '＋ 매장 추가하기' 한 줄로 접는다.
            옛 판본은 셋을 한 레이아웃으로 그려서 ①에 "코드를 넣어라"가 세 번(히어로 배너·빈 카드·
            입력 섹션) 나왔고, 그중 히어로의 [코드 입력]은 화면 이동이 아니라 포커스만 주는 가짜 버튼이었다.
            ③에서는 이미 연결된 직원에게 코드 입력이 상시 노출됐다. */}
        <Appear delay={60}>
        <View style={styles.section}>
          {(pendingUnitId || hasStore) && <Text style={styles.sectionLabel}>내 매장</Text>}

          {pendingUnitId ? (
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
          ) : hasStore ? (
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
            ))
          ) : null}

          {/* ③ 매장 있음 — 코드 입력은 접힌 한 줄. 펼침은 아래로(집 스타일). */}
          {!pendingUnitId && hasStore && (
            <Pressable
              onPress={openAdd}
              style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityState={{ expanded: addOpen }}
              accessibilityLabel="코드로 매장 추가 — 초대코드 입력"
            >
              <Ionicons name="add" size={18} color={InkColors.ink2} />
              {/* 펼치면 나오는 Primary가 '매장 추가하기'라 라벨을 다르게 둔다 —
                  같은 말이 위아래로 겹치면 어느 쪽을 눌러야 하는지 흐려진다. */}
              <Text style={styles.addRowText}>코드로 매장 추가</Text>
              <Ionicons name={addOpen ? 'chevron-up' : 'chevron-down'} size={16} color={InkColors.ink3} />
            </Pressable>
          )}

          {/* ① 매장 0개면 곧바로 · ③ 매장 있으면 펼쳤을 때만 — 코드 입력 본문은 한 벌뿐이다(SSOT). */}
          {!pendingUnitId && (!hasStore || addOpen) && codeEntry}
        </View>
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
        <Appear delay={240}>
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
    </SafeAreaView>
  );
}

const CELL_GAP = 8;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.xl, paddingBottom: 40 },

  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topbarLeft: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  backBtn: { padding: 2 },

  greet: { gap: 4 },
  hello: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  helloSub: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },

  section: { gap: Space.md },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginLeft: 2 },

  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    ...Elevation.e1,
  },
  storeIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  storeName: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  storeMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },

  // '＋ 매장 추가하기' — 매장이 이미 있을 때 코드 입력을 접어두는 줄.
  // 매장 카드와 형태를 일부러 다르게 한다(카드가 아니라 점선 행) — 같은 형태가 이어지면 목록으로 읽힌다.
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
  },
  addRowText: { flex: 1, fontSize: 14, fontWeight: '800', color: InkColors.ink2 },

  pendingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  pendingIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: '#FBF3E2', alignItems: 'center', justifyContent: 'center' },
  pendingMeta: { fontSize: 12, color: BrandColors.warnText, fontWeight: '700', marginTop: 2 },
  pendingBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  pendingActions: { flexDirection: 'row', gap: Space.sm },
  ghostBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostBtnText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },

  codeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  cells: { flexDirection: 'row', gap: CELL_GAP, position: 'relative' },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 56,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: BrandColors.brand },
  cellText: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent' },
  err: { fontSize: 15, color: BrandColors.accentText, fontWeight: '600' },
  primary: { backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  // 안내문 = 본문(simplicity-voice §4) → 꼬리표용 ink3(2.55:1) 금지.
  codeHint: { fontSize: 12, color: InkColors.ink2, lineHeight: 18 },

  avatarSm: { width: 30, height: 30, borderRadius: Radius.pill, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  myRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 12 },
  // 카드 안 행이 아니라 단독 행 — 테두리·배경을 스스로 갖고 터치 타깃 48dp를 지킨다.
  myRowSolo: {
    minHeight: 48,
    paddingHorizontal: Space.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    ...Elevation.e1,
  },
  myRowText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink },
});
