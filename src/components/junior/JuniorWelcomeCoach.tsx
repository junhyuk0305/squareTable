import { useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Space, SCREEN_GUTTER, FRAME_MAX_WIDTH } from '@/lib/theme/layout';
import { Radius, Elevation } from '@/lib/theme/elevation';

// 직원 라이트 온보딩 — 합류 직후 1회 노출.
// 핵심 인지: ① 모르는 건 물어보면 매장 노하우로 답한다 ② 내가 아는 건 직접 등록 신청한다.
// '본 적 있음'은 로컬에 저장(웹=localStorage). 네이티브 등 저장 불가 환경은 세션 1회 폴백.
const SEEN_KEY = 'sqt.juniorCoachSeen';
let _memSeen = false; // localStorage 불가 환경의 세션 폴백

const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;

function readSeen(): boolean {
  if (_memSeen) return true;
  try {
    return storage?.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markSeen() {
  _memSeen = true;
  try {
    storage?.setItem(SEEN_KEY, '1');
  } catch {
    /* noop */
  }
}

const POINTS: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }[] = [
  {
    icon: 'search',
    title: '모르면 물어보세요',
    body: '궁금한 걸 검색하면 우리 가게 노하우로 바로 답해줘요. 없으면 사장님께 대신 여쭤봐요.',
  },
  {
    icon: 'bulb-outline',
    title: '아는 건 등록하세요',
    body: '내가 아는 요령·고칠 점은 ‘노하우 제안’으로 올리면 사장님 확인 뒤 매장 노하우가 돼요.',
  },
];

export function JuniorWelcomeCoach() {
  // 마운트 시점에 1회 판정(localStorage 동기 읽기) — effect 안 setState 회피.
  const [open, setOpen] = useState(() => !readSeen());

  const dismiss = () => {
    markSeen();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      {/* 모바일 프레임(460) 안으로 가둔다 — 딤 배경이 웹 뷰포트 전체로 새지 않도록(AGENTS.md). */}
      <View style={styles.frameWrap}>
        <View style={styles.overlay}>
          <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="hand-left-outline" size={26} color={BrandColors.brand} />
          </View>
          <Text style={styles.title}>여기서 이렇게 쓰면 돼요</Text>
          <Text style={styles.sub}>가게 노하우를 묻고, 내가 아는 건 직접 쌓을 수 있어요.</Text>

          <View style={styles.points}>
            {POINTS.map((p) => (
              <View key={p.title} style={styles.point}>
                <View style={styles.pointIcon}>
                  <Ionicons name={p.icon} size={18} color={InkColors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointTitle}>{p.title}</Text>
                  <Text style={styles.pointBody}>{p.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <PressableScale onPress={dismiss} scaleTo={0.97} style={styles.cta}>
            <Text style={styles.ctaText}>알겠어요, 시작할게요</Text>
          </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frameWrap: { flex: 1, width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(17,17,17,0.45)', alignItems: 'center', justifyContent: 'center', padding: SCREEN_GUTTER },
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.sheet, padding: Space.xl, gap: Space.sm, ...Elevation.e3 },
  iconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: BrandColors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: InkColors.ink, marginTop: Space.xs },
  sub: { fontSize: 13.5, color: InkColors.ink2, lineHeight: 20 },
  points: { gap: Space.md, marginTop: Space.sm, marginBottom: Space.xs },
  point: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  pointIcon: { width: 34, height: 34, borderRadius: Radius.sm, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  pointTitle: { fontSize: 14.5, fontWeight: '800', color: InkColors.ink },
  pointBody: { fontSize: 13, color: InkColors.ink2, lineHeight: 19, marginTop: 2 },
  cta: { marginTop: Space.sm, backgroundColor: InkColors.ink, paddingVertical: Space.lg, borderRadius: Radius.md, alignItems: 'center' },
  ctaText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
});
