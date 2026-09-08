import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SectionLabel } from '@/components/SectionLabel';
import { PressableScale } from '@/components/PressableScale';
import { showToast } from '@/lib/store/useToastStore';
import { shareText, type ShareTextResult } from '@/lib/utils/shareText';
import { siteOrigin } from '@/lib/config/site';
import { track } from '@/lib/analytics/track';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 직원 초대 블록 — 코드 하나만 던져주던 자리를 "무엇을 어떻게 전하면 되는가"까지로 넓힌 공용 컴포넌트.
 *
 * ★왜 링크가 필요한가 (첫 사용 워크스루 #15)
 *   예전엔 사장이 복사할 수 있는 게 숫자 6자리뿐이었다. 그 숫자를 받은 직원은 앱을 어디서 받는지,
 *   가입할 때 '직원'을 골라야 한다는 것도 모른다 — 사장이 그걸 매번 말로 설명해야 했다.
 *   그래서 **카톡에 그대로 붙일 수 있는 3줄 + 링크**를 통째로 복사한다.
 *
 * ★링크는 `/signup?role=junior&code=______`. signup 이 '직원' 카드를 미리 고르고,
 *   가입이 끝나면 hub 로 code 를 넘겨 6칸을 채운다(자동 제출은 하지 않는다 — 누르는 건 직원이다).
 *
 * ★네 자리(온보딩 완료·홈·직원 관리·설정)가 같은 이 컴포넌트를 쓴다. 자리마다 다른 건 밀도뿐이다.
 *   자리별로 복제하면 문구가 갈라져 사장이 자리마다 다른 설명을 읽게 된다.
 */
export function InviteBlock({
  code,
  from,
  compact = false,
  action,
  style,
}: {
  /** 매장 초대코드 6자리. */
  code: string;
  /** 관측용 — 사장이 어느 자리에서 뿌렸는지. */
  from: 'onboarding' | 'home' | 'staff' | 'settings';
  /** 이미 다른 카드들 사이에 끼는 자리(설정) — 안내 3줄을 접고 코드+링크만 남긴다. */
  compact?: boolean;
  /** 코드 줄 오른쪽 추가 액션(직원 관리의 '코드 변경'). */
  action?: React.ReactNode;
  /** 바깥 여백만 — 부모 목록에 gap 이 없는 화면(설정)이 아래 간격을 준다. */
  style?: StyleProp<ViewStyle>;
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const link = `${siteOrigin()}/signup?role=junior&code=${code}`;
  // 카톡에 그대로 붙는 한 덩어리. 링크만 보내면 받은 사람이 무엇을 해야 하는지 모른다.
  const message = `매장의 정석에 초대할게요.\n1) 링크 열기 → 2) ‘직원’으로 가입 → 3) 초대코드 ${code} 입력\n${link}`;

  const done = (what: 'code' | 'link', r: ShareTextResult) => {
    if (r === 'copied') {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
      showToast(what === 'code' ? '초대코드를 복사했어요' : '초대 링크를 복사했어요', 'good');
      return;
    }
    // 공유 시트는 그 자체가 피드백이라 열렸거나 닫은 경우엔 조용히 둔다. 실패만 말한다.
    if (r === 'failed') {
      showToast(
        Platform.OS === 'web'
          ? '복사가 안 됐어요. 화면의 코드를 길게 눌러 복사해 주세요'
          : '공유 창을 열지 못했어요. 화면의 코드를 길게 눌러 복사해 주세요',
      );
    }
  };

  // 복사 = "사장이 초대를 실제로 뿌렸다"의 유일한 관측점. 이게 없으면 직원 합류율이 낮을 때
  // 사장이 안 뿌린 건지, 뿌렸는데 직원이 안 들어온 건지 DB로 구분할 수 없다.
  const sendCode = () => {
    track('invite_shared', { from, via: 'code' });
    void shareText(code).then((r) => done('code', r));
  };
  const sendLink = () => {
    track('invite_shared', { from, via: 'link' });
    void shareText(message).then((r) => done('link', r));
  };

  const isWeb = Platform.OS === 'web';

  return (
    <View style={style}>
      <SectionLabel title="직원 초대" />
      <View style={s.card}>
        {!compact && (
          <>
            <Text style={s.howTitle}>직원에게 이렇게 알려주세요</Text>
            <View style={s.steps}>
              <Text style={s.step}>1. 아래 링크를 열고</Text>
              <Text style={s.step}>2. ‘직원’으로 가입한 뒤</Text>
              <Text style={s.step}>3. 초대코드를 넣으면 합류 신청이 돼요</Text>
            </View>
          </>
        )}

        <View style={s.codeRow}>
          <View style={s.codeCol}>
            <Text style={s.codeLabel}>초대코드</Text>
            <Text style={s.code} selectable>
              {code}
            </Text>
          </View>
          <Pressable
            onPress={sendCode}
            accessibilityRole="button"
            accessibilityLabel={isWeb ? '초대코드 복사' : '초대코드 공유'}
            style={({ pressed }) => [s.copyBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name={copied === 'code' ? 'checkmark' : isWeb ? 'copy-outline' : 'share-outline'} size={15} color={InkColors.ink} />
            <Text style={s.copyText}>{copied === 'code' ? '복사됨' : isWeb ? '복사' : '공유'}</Text>
          </Pressable>
          {action}
        </View>

        <PressableScale
          onPress={sendLink}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={isWeb ? '초대 링크 복사' : '초대 링크 공유'}
          style={s.primary}
        >
          <Ionicons name={isWeb ? 'link-outline' : 'share-outline'} size={16} color={InkColors.bubbleText} />
          <Text style={s.primaryText}>{copied === 'link' ? '복사됨' : isWeb ? '초대 링크 복사' : '초대 링크 공유'}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
  },
  howTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  steps: { gap: 4 },
  step: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: InkColors.ink2 },

  codeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  codeCol: { flex: 1, minWidth: 0 },
  codeLabel: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  code: { fontSize: 22, lineHeight: 30, fontWeight: '900', color: InkColors.ink, letterSpacing: 3 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    minHeight: 48, paddingHorizontal: Space.md,
    borderRadius: Radius.pill, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line,
  },
  copyText: { fontSize: 13, fontWeight: '800', color: InkColors.ink },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 48, borderRadius: Radius.md, backgroundColor: BrandColors.brand,
  },
  primaryText: { fontSize: 15, fontWeight: '900', color: InkColors.bubbleText },
});
