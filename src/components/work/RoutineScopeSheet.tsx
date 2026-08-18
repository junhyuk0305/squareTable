import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 루틴 업무를 고칠 때 **어디까지 바꿀지** 먼저 묻는 시트.
 *
 * 루틴은 매장 설정(schedule_config.dayparts)에서 매일 파생되는 일이라, 할일 화면에서 고친 내용이
 * 오늘 하루 얘기인지 내일부터도 그런지가 갈린다. 물어보지 않으면 둘 중 하나는 반드시 틀린다.
 *
 * ★시스템 Alert 을 쓰지 않는다 — react-native-web 에서 `Alert.alert` 은 **아무 일도 하지 않는다**.
 *   이 앱의 주 채널이 웹(PWA)이라 그대로 두면 "수정을 눌렀는데 반응이 없다"가 된다.
 *   확인/취소 두 갈래는 `confirmAction`(앱 내 모달)이 맡지만, 여기는 선택지가 셋이라 시트로 둔다.
 */
export function RoutineScopeSheet({
  title,
  dateLabel,
  onPickToday,
  onPickAll,
  onClose,
}: {
  /** 고치려는 루틴 이름 — 무엇을 고르는 중인지 시트 안에서 다시 보여준다. */
  title: string;
  /** '오늘만'의 그 날짜(예: "8월 19일 (화)"). 할일 화면에서 고른 날이 오늘이 아닐 수 있다. */
  dateLabel: string;
  onPickToday: () => void;
  onPickAll: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible onClose={onClose} sheetStyle={s.sheet}>
      <Text style={s.title}>어디까지 바꿀까요?</Text>
      <Text style={s.sub} numberOfLines={2}>‘{title}’</Text>

      <Pressable
        onPress={onPickToday}
        accessibilityRole="button"
        accessibilityLabel={`${dateLabel} 루틴만 수정`}
        style={({ pressed }) => [s.opt, pressed && { opacity: 0.75 }]}
      >
        <View style={s.icon}>
          <Ionicons name="today-outline" size={18} color={InkColors.ink} />
        </View>
        <View style={s.body}>
          <Text style={s.optTitle}>{dateLabel} 루틴만 수정</Text>
          <Text style={s.optSub}>그 다음 날부터는 원래 루틴 그대로예요</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
      </Pressable>

      <Pressable
        onPress={onPickAll}
        accessibilityRole="button"
        accessibilityLabel="이후 모든 루틴 수정"
        style={({ pressed }) => [s.opt, s.optAccent, pressed && { opacity: 0.85 }]}
      >
        <View style={[s.icon, s.iconAccent]}>
          <Ionicons name="repeat-outline" size={18} color={InkColors.ink} />
        </View>
        <View style={s.body}>
          <Text style={s.optTitle}>이후 모든 루틴 수정</Text>
          <Text style={s.optSub}>업무 설정의 루틴 업무가 바뀌어요 · 매장 전체에 적용</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={InkColors.ink} />
      </Pressable>

      <Pressable onPress={onClose} style={({ pressed }) => [s.cancel, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <Text style={s.cancelText}>그대로 두기</Text>
      </Pressable>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  sheet: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.sm },
  title: { fontSize: 17, fontWeight: '800', color: InkColors.ink, paddingTop: Space.xs },
  // 어떤 루틴을 고르는 중인지 — 읽어서 판단하는 문장이라 본문 하한 15sp.
  sub: { fontSize: 15, color: InkColors.ink2, marginBottom: Space.sm },

  opt: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    minHeight: 56, paddingHorizontal: Space.md, paddingVertical: Space.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  // '이후 모두'는 매장 전체 설정을 바꾸는 쪽이라 면으로 무게를 준다(되돌리려면 다시 설정을 고쳐야 한다).
  optAccent: { backgroundColor: BrandColors.yellowSoft, borderColor: BrandColors.yellowDeep },
  icon: { width: 34, height: 34, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  iconAccent: { backgroundColor: BrandColors.yellow },
  body: { flex: 1, gap: 1 },
  optTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  optSub: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink2 },

  cancel: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: Space.xs,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bgSoft,
  },
  cancelText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
