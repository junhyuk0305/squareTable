import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useTourStore } from '@/lib/store/useTourStore';
import { useOverlayFree, useOverlayStore } from '@/lib/store/useOverlayStore';
import { pushSupported, permissionState, enablePush } from '@/lib/push/webpush';
import {
  pushSupported as nativePushSupported,
  nativePermissionState,
  enableNativePush,
  requestNativePermission,
} from '@/lib/push/nativepush';
import { canManage } from '@/lib/utils/roles';
import { SHOW_BILLING, WEB_PUSH_ENABLED } from '@/lib/config/store-policy';
import { InkColors, BrandColors, TextColor } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER } from '@/lib/theme/layout';
import { ButtonStyles, ButtonTextStyles } from '@/lib/theme/button';
import { Type } from '@/lib/theme/type';

/**
 * 알림 켜기 안내 — 홈 첫 진입에 **딱 한 번** 뜬다.
 *
 * ★왜 우리 화면으로 먼저 묻나 (이 컴포넌트가 존재하는 이유)
 *   iOS 는 OS 권한 팝업을 **한 번만** 띄울 수 있다. 거기서 '허용 안 함'을 누르면 앱에서는 두 번 다시
 *   못 띄우고, 사용자가 직접 설정 앱에 들어가야 한다. 그래서 맥락 없이 OS 팝업부터 띄우면 그 한 번을
 *   버리는 셈이다 — **왜 필요한지 먼저 말하고, 켜겠다고 한 사람에게만** OS 팝업을 넘긴다.
 *
 * ★알림만 이렇게 한다. 마이크·사진은 **쓰는 순간**에 묻는다(음성 입력 버튼·사진 첨부).
 *   지금 쓰지도 않는 권한을 미리 묻는 것은 App Store 심사 5.1.1 지적 대상이고 승낙률도 낮다.
 *   알림은 "일이 생기면 알려준다"가 가치라 쓰는 순간이라는 게 없어서 예외다.
 *
 * ★권한을 이미 정한 사람에게는 안 뜬다(granted·denied 둘 다). 거절한 사람을 다시 붙잡는 건
 *   알림 화면의 `NotificationEnableCard` 몫이다 — 거기선 "설정에서 켜세요"를 안내한다.
 */
/**
 * '알림을 이미 물어봤다' 플래그. 이 시트만의 것이 아니다 — 온보딩 완료 화면의
 * `NotificationEnableCard` 로 먼저 물어본 경우에도 세워서, 홈에 들어오자마자 같은 질문이
 * 두 번째로 뜨는 걸 막는다(첫 사용 워크스루 #6).
 */
export const NOTIFY_ASKED_ID = 'notify_permission_v1';
/**
 * 앱 첫 실행 안내(네이티브만 · 로그인 전에도 · 2026-10-29 사용자 결정). 루트 레이아웃이 `firstRun` 으로 한 번 붙인다.
 *   승인 대기 직원은 홈에 못 들어와 홈 시트를 영영 못 봤다. 그래서 앱을 열자마자 묻는다.
 *   로그인 전에 '나중에'를 누르면 로그인 뒤 홈 시트가 한 번 더 묻는다. 로그인한 채 봤으면 그것이 홈 시트 몫까지 친다.
 *   홈 시트는 이 안내가 끝난 뒤에만 뜬다. 둘이 한 진입에서 연달아 뜨지 않는다.
 */
export const NOTIFY_FIRST_RUN_ID = 'notify_first_run_v1';
/** 진입 애니메이션·기능 안내 팝업이 자리 잡은 뒤에 뜬다(가이드보다 늦게). */
const OPEN_DELAY_MS = 1200;
/** 첫 실행 안내는 스플래시가 걷힌 뒤 화면이 자리 잡을 만큼만 기다린다. */
const FIRST_RUN_DELAY_MS = 400;

export function NotificationPermissionSheet({ firstRun = false }: { firstRun?: boolean }) {
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const role = useSessionStore((s) => s.role);
  const seen = useTourStore((s) => s.seen);
  const tourLoaded = useTourStore((s) => s.loaded);
  const markSeen = useTourStore((s) => s.markSeen);
  const hydrateTour = useTourStore((s) => s.hydrate);
  const overlayFree = useOverlayFree();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isNative = nativePushSupported();

  useEffect(() => {
    void hydrateTour(); // 기기 단위 저장소라 로그인 전에도 읽힌다. 이미 읽었으면 바로 끝난다.
  }, [hydrateTour]);

  useEffect(() => {
    // '본 적 있음'이 도착하기 전에 띄우면 이미 본 사람에게 또 뜬다 — 도착을 기다린다.
    if (!tourLoaded) return;
    if (firstRun) {
      // 첫 실행 안내는 앱만 묻는다. 로그인한 사람이 홈 시트로 이미 답했으면 다시 묻지 않는다.
      if (!isNative || seen[NOTIFY_FIRST_RUN_ID] || (userId && seen[NOTIFY_ASKED_ID])) return;
    } else {
      if (seen[NOTIFY_ASKED_ID] || !userId) return;
      // 앱은 첫 실행 안내가 먼저다. 그 안내가 끝나기 전에 홈 시트가 먼저 뜨면 같은 질문이 연달아 나온다.
      if (isNative && !seen[NOTIFY_FIRST_RUN_ID]) return;
    }
    // 웹 푸시 미지원 브라우저 + 정책으로 끈 경우(웹은 안 묻는다 — 알림은 폰 앱이 받는다).
    if (!isNative && !(WEB_PUSH_ENABLED && pushSupported())) return;
    // ★앞 장(직원 환영 코치·사용 안내 팝업)이 떠 있으면 기다린다 — 겹치면 둘 다 안 읽힌다.
    //   markSeen 을 안 하므로, 앞 장이 닫히면 이 effect 가 다시 돌아 같은 진입에서 이어 뜬다.
    //   (예전엔 타이머 안에서 가이드만 한 번 확인하고 그냥 접었다 — 다음 진입까지 밀렸다.)
    if (!overlayFree) return;
    let alive = true;
    const t = setTimeout(async () => {
      const perm = isNative ? await nativePermissionState() : permissionState();
      // 아직 아무것도 안 정한 사람에게만. granted·denied 는 물을 이유가 없다.
      if (alive && perm === 'default') setOpen(true);
      // 이미 정한 사람은 첫 실행 안내가 끝난 것으로 친다. 안 찍으면 나중에 권한이 'default' 로 돌아갔을 때
      //   홈 시트가 첫 실행 안내를 기다리다 영영 안 뜬다.
      else if (alive && firstRun && perm !== 'default') markSeen(NOTIFY_FIRST_RUN_ID);
    }, firstRun ? FIRST_RUN_DELAY_MS : OPEN_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [tourLoaded, seen, userId, isNative, overlayFree, firstRun, markSeen]);

  // 이 시트도 줄에 등록한다 — 지금은 마지막 장이지만, 규칙을 예외 없이 한 줄로 둔다.
  const enter = useOverlayStore((s) => s.enter);
  const exit = useOverlayStore((s) => s.exit);
  const overlayId = firstRun ? 'notify_first' : 'notify';
  useEffect(() => {
    if (!open) return;
    enter(overlayId);
    return () => exit(overlayId);
  }, [open, enter, exit, overlayId]);

  const close = () => {
    // 켰든 미뤘든 한 번 보여줬으면 끝 — 다시 띄우는 건 방해다.
    // 첫 실행 안내를 로그인한 채 봤으면 홈 시트 몫도 끝난 것이다(같은 사람에게 같은 질문 두 번 금지).
    if (firstRun) markSeen(NOTIFY_FIRST_RUN_ID);
    if (!firstRun || userId) markSeen(NOTIFY_ASKED_ID);
    setOpen(false);
  };

  const onEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 로그인 전에는 권한만 받는다. 토큰은 로그인 뒤 usePushBootstrap 이 등록한다(등록 RPC 는 로그인이 필요하다).
      if (isNative) await (userId ? enableNativePush(unitId || null) : requestNativePermission());
      else await enablePush(userId, unitId || null);
    } finally {
      setBusy(false);
      close();
    }
  };

  // 로그인 전에는 사장인지 직원인지 모른다 — 둘 다 맞는 말로 쓴다.
  const lines = !userId
    ? ['합류 신청과 승인 결과', '나에게 배정된 할 일', '내 질문에 달린 답']
    : canManage(role)
    ? // 입금 확인은 웹 결제 채널에만 있다 — 앱에서 말하지 않는다(store-policy SHOW_BILLING).
      ['직원이 모르는 걸 물어보면 바로', '새 제안·합류 신청이 오면 바로', SHOW_BILLING ? '교대 요청·입금 확인 결과' : '교대 요청이 오면 바로']
    : // 공지는 알림이 아니다(2026-10-16 사용자 결정 · registry.ts) — 예전 '새 공지' 줄은 사실과 달랐다.
      ['합류 승인 결과', '나에게 배정된 할 일', '내 질문에 달린 답'];

  return (
    <BottomSheet visible={open} onClose={close}>
      <View style={s.wrap}>
        <View style={s.badge}>
          <Ionicons name="notifications" size={22} color={InkColors.ink} />
        </View>
        <Text style={s.title}>알림을 켜면 앱을 안 켜도 알 수 있어요</Text>
        <Text style={s.sub}>이런 걸 바로 알려드려요.</Text>

        <View style={s.list}>
          {lines.map((l) => (
            <View key={l} style={s.row}>
              <Ionicons name="checkmark-circle" size={17} color={BrandColors.good} />
              <Text style={s.rowText}>{l}</Text>
            </View>
          ))}
        </View>

        <Text style={s.note}>방해 금지 시간은 설정에서 정할 수 있어요.</Text>

        <Pressable
          onPress={onEnable}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [s.primary, (busy || pressed) && { opacity: 0.85 }]}
        >
          <Text style={s.primaryText}>{busy ? '켜는 중…' : '알림 켜기'}</Text>
        </Pressable>
        <Pressable onPress={close} accessibilityRole="button" style={({ pressed }) => [s.ghost, pressed && { opacity: 0.6 }]}>
          <Text style={s.ghostText}>나중에 할게요</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: SCREEN_GUTTER, paddingTop: Space.sm, gap: Space.sm },
  badge: {
    width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: BrandColors.yellowSoft, marginBottom: Space.xs,
  },
  title: { ...Type.title, lineHeight: 25 },
  sub: { ...Type.desc, fontWeight: '600' },
  list: { gap: Space.sm, marginTop: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  note: { ...Type.desc, fontWeight: '600', marginTop: Space.sm },
  // 주 버튼 모양(52 · 모서리 16 · 가로 꽉 · 16/800). 흰 면 위 주 버튼 = 검정(2026-11-02 사용자 결정).
  primary: {
    ...ButtonStyles.primary,
    marginTop: Space.md, backgroundColor: InkColors.ink,
  },
  primaryText: { ...ButtonTextStyles.primary, color: InkColors.bubbleText },
  ghost: { paddingVertical: 13, alignItems: 'center' },
  ghostText: { fontSize: Type.body.fontSize, fontWeight: '700', color: TextColor.secondary },
});
