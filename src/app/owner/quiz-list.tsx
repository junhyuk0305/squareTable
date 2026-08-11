import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { InkColors } from '@/lib/theme/colors';

/**
 * 옛 코스 관리 화면 — 2026-08-11 퀴즈 재설계로 **폐기**.
 *
 * 화면 어휘에서 "코스"가 사라지면서(퀴즈 1건 = 코스 1건) 이 화면이 하던 일이 전부 옮겨 갔다:
 *   · 코스 만들기·프리셋            → `/owner/quiz-new` (만들기 5단계)
 *   · 담기·순서·문항 관리           → `/owner/quiz/[id]` (문항 세그먼트)
 *   · 공유 링크·오답 신호           → `/owner/quiz/[id]` (⋯ 시트 · 문항 세그먼트)
 *
 * ★라우트를 지우지 않고 리다이렉트만 남긴다 — 사장이 예전 링크를 누르면 빈 화면이 아니라
 *   퀴즈 홈에 착지해야 한다(탭을 뺄 때 라우트는 남긴다는 기존 규칙과 같은 이유).
 */
export default function OwnerQuizListRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/owner/training' as never);
  }, [router]);
  return <View style={st.safe} />;
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
});
