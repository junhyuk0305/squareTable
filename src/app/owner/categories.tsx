import { Stack, useRouter, useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/Screen';
import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { OwnerKnowhowBrowse, type KnowhowSegKey } from '@/components/owner/OwnerKnowhowBrowse';

const SEG_KEYS: KnowhowSegKey[] = ['todo', 'knowhow'];
// 2026-08-19 에 '안 쓰임' 칸이 '할 일'로 흡수됐다. 옛 딥링크(?seg=unused)는 죽이지 않고 그리로 착지시킨다.
const SEG_ALIAS: Record<string, KnowhowSegKey> = { unused: 'todo' };

/**
 * 노하우 탭(사장님) — 할 일 · 노하우 2칸(OwnerKnowhowBrowse).
 *
 * (이력) 옛 KnowhowSegment 3칸[둘러보기|물어보기|내노하우] → 2칸 → 세그먼트 폐지.
 * (2026-08-07) 받은질문 탭을 흡수하며 세그먼트가 [할 일|노하우|안 쓰임]으로 돌아왔다.
 * (2026-08-19) '안 쓰임'을 '할 일'로 합쳐 [할 일|노하우] 2칸.
 * `?seg=todo` = 구 /owner/inbox 착지점(딥링크·푸시가 리다이렉트로 들어온다).
 */
export default function OwnerCategoriesScreen() {
  const router = useRouter();
  const { seg } = useLocalSearchParams<{ seg?: string }>();
  // 모르는 값이면 넘기지 않는다 — undefined면 컴포넌트가 기본 칸('노하우')을 쓴다.
  const initialSegment = SEG_KEYS.find((k) => k === seg) ?? (seg ? SEG_ALIAS[seg] : undefined);

  // 카드를 탭하면 해당 노하우 수정으로 (검토/보강 흐름).
  const openEntry = (id: string) => router.push({ pathname: '/owner/edit/[id]', params: { id } });

  return (
    // 목록이 자기 스크롤·떠 있는 + 버튼을 가져서 scroll={false} — 바탕·헤더·탭바만 Screen 이 든다.
    <Screen
      header={
        // 네이티브 헤더를 끄고 제목을 직접 그린다 — 근거는 ScreenTitleHeader 주석(iOS 는 왼쪽 정렬 평문 제목이 불가).
        <ScreenTitleHeader variant="tab" title="노하우" />
      }
      tabBar="owner"
      scroll={false}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <OwnerKnowhowBrowse onSelect={openEntry} initialSegment={initialSegment} />
    </Screen>
  );
}
