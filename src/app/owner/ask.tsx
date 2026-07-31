import { useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JuniorAsk } from '@/components/junior/JuniorAsk';
import { useChatStore } from '@/lib/store/useChatStore';
import { useSessionStore } from '@/lib/store/useSessionStore';

import { styles } from '@/styles/juniorChatStyles';

/**
 * 물어보기(매니저) — 권한체계 정본 §4 "AI 질문·노하우 검색: 매니저 ✅" 이행.
 * 직원 물어보기(JuniorAsk)를 그대로 재사용하는 owner 스택의 서브화면(뒤로가기 있음).
 * 진입점: 노하우 탭 검색 결과 없음(OwnerKnowhowBrowse, 매니저에게만 노출).
 * 매니저의 미답 질문 에스컬레이션 수신자는 사장 — 기존 워딩·경로 그대로 맞는다.
 */
export default function OwnerAskScreen() {
  const unitId = useSessionStore((s) => s.unitId);

  // owner 레이아웃은 챗 스토어를 hydrate하지 않는다(직원 레이아웃 담당) — 이 화면이 직접 당긴다.
  useEffect(() => {
    if (!unitId) return;
    useChatStore.getState().hydrate(useSessionStore.getState().userId);
  }, [unitId]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* 매니저는 제안 경로 대신 직접 발행(노하우 추가) 권한이 있으므로 제안 진입은 숨긴다. */}
      <JuniorAsk suggestEntry={false} />
    </SafeAreaView>
  );
}
