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
} from '@/lib/push/nativepush';
import { canManage } from '@/lib/utils/roles';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER } from '@/lib/theme/layout';

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
/** 진입 애니메이션·기능 안내 팝업이 자리 잡은 뒤에 뜬다(가이드보다 늦게). */
const OPEN_DELAY_MS = 1200;

export function NotificationPermissionSheet() {
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const role = useSessionStore((s) => s.role);
  const seen = useTourStore((s) => s.seen);
  const tourLoaded = useTourStore((s) => s.loaded);
  const markSeen = useTourStore((s) => s.markSeen);
  const overlayFree = useOverlayFree();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isNative = nativePushSupported();

  useEffect(() => {
    // '본 적 있음'이 도착하기 전에 띄우면 이미 본 사람에게 또 뜬다 — 도착을 기다린다.
    if (!tourLoaded || seen[NOTIFY_ASKED_ID] || !userId) return;
    if (!isNative && !pushSupported()) return; // 웹 푸시 미지원 브라우저
    // ★앞 장(직원 환영 코치·사용 안내 팝업)이 떠 있으면 기다린다 — 겹치면 둘 다 안 읽힌다.
    //   markSeen 을 안 하므로, 앞 장이 닫히면 이 effect 가 다시 돌아 같은 진입에서 이어 뜬다.
    //   (예전엔 타이머 안에서 가이드만 한 번 확인하고 그냥 접었다 — 다음 진입까지 밀렸다.)
    if (!overlayFree) return;
    let alive = true;
    const t = setTimeout(async () => {
      const perm = isNative ? await nativePermissionState() : permissionState();
      // 아직 아무것도 안 정한 사람에게만. granted·denied 는 물을 이유가 없다.
      if (alive && perm === 'default') setOpen(true);
    }, OPEN_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [tourLoaded, seen, userId, isNative, overlayFree]);

  // 이 시트도 줄에 등록한다 — 지금은 마지막 장이지만, 규칙을 예외 없이 한 줄로 둔다.
  const enter = useOverlayStore((s) => s.enter);
  const exit = useOverlayStore((s) => s.exit);
  useEffect(() => {
    if (!open) return;
    enter('notify');
    return () => exit('notify');
  }, [open, enter, exit]);

  const close = () => {
    markSeen(NOTIFY_ASKED_ID); // 켰든 미뤘든 한 번 보여줬으면 끝 — 다시 띄우는 건 방해다.
    setOpen(false);
  };

  const onEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isNative) await enableNativePush(unitId || null);
      else await enablePush(userId, unitId || null);
    } finally {
      setBusy(false);
      close();
    }
  };

  const lines = canManage(role)
    ? ['직원이 모르는 걸 물어보면 바로', '새 제안·합류 신청이 오면 바로', '교대 요청·입금 확인 결과']
    : ['사장님이 내 질문에 답하면 바로', '새 공지가 올라오면 바로', '내 근무·교대 소식'];

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
  title: { fontSize: 18, fontWeight: '900', color: InkColors.ink, lineHeight: 25 },
  sub: { fontSize: 13.5, fontWeight: '600', color: InkColors.ink3 },
  list: { gap: Space.sm, marginTop: Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rowText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  note: { fontSize: 12.5, fontWeight: '600', color: InkColors.ink3, marginTop: Space.sm },
  primary: {
    marginTop: Space.md, backgroundColor: BrandColors.yellow, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '900', color: InkColors.ink },
  ghost: { paddingVertical: 13, alignItems: 'center' },
  ghostText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
});
