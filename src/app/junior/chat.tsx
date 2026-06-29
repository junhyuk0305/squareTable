import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RoleTabBar } from '@/components/RoleTabBar';
import { KnowhowSegment } from '@/components/KnowhowSegment';
import { JuniorBrowseDashboard } from '@/components/JuniorBrowseDashboard';
import { JuniorAsk } from '@/components/junior/JuniorAsk';

import { useChatStore } from '@/lib/store/useChatStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';

import type { PlaybookEntry } from '@/types';

import { styles } from './chatStyles';

/**
 * 노하우 탭(주니어) — KnowhowSegment 컨테이너.
 *  · 둘러보기: 발행된 노하우를 BrowseList로 (주니어·시니어 공용)
 *  · 물어보기: 기존 AI 어시스턴트 챗(RAG·useChatStore·만족도 100% 보존)
 *
 * 크롬(SafeArea·헤더·탭바) 소유권은 이 컨테이너가 가진다 — 임베드된 챗(JuniorAsk)은
 * 자체 SafeAreaView/RoleTabBar를 갖지 않는다(중복 방지).
 */
export default function JuniorChatScreen() {
  const entries = usePlaybookStore((s) => s.entries);
  const submit = useChatStore((s) => s.submit);

  // 둘러보기에 노출할 발행 노하우. status 없는 시드도 안전하게 통과(published 우선, 미정이면 노출).
  const publishedEntries = useMemo(
    () => entries.filter((e) => e.status === 'published' || !e.status),
    [entries],
  );

  // 주니어가 카드를 탭하면 그 노하우를 질문으로 띄워 RAG가 같은 카드를 채팅에 보여준다.
  const handleBrowseSelect = (entry: PlaybookEntry) => {
    void submit(entry.title, { anonymous: false });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '물어보기' }} />
      <KnowhowSegment
        role="junior"
        initial="ask"
        browse={
          <JuniorBrowseDashboard
            entries={publishedEntries}
            onSelect={handleBrowseSelect}
            emptyHint="아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요."
          />
        }
        ask={<JuniorAsk />}
      />
      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}
