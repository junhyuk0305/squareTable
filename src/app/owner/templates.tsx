import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';

import { KeyboardShift } from '@/components/KeyboardShift';
import { TemplateLibrary } from '@/components/owner/TemplateLibrary';
import { Screen } from '@/components/Screen';

/**
 * '노하우 템플릿 둘러보기' — 업종 표준 템플릿을 검색하고 내 노하우로 가져오는 백-가능 서브화면.
 * 설정·홈 배너에서 진입(router.push). 제목/백버튼은 owner/_layout.tsx 의 templates Stack.Screen +
 * 전역 HeaderBackButton 가 제공한다.
 */
export default function OwnerTemplatesScreen() {
  return (
    // 바탕·탭바 = Screen. 목록이 자기 스크롤을 가져 scroll={false}.
    <Screen header={<ScreenTitleHeader title="노하우 템플릿" backFallback />} tabBar="owner" scroll={false}>
      <KeyboardShift>
        <TemplateLibrary />
      </KeyboardShift>
    </Screen>
  );
}
