import { useCallback, useRef, useState, type RefObject } from 'react';
import type { ScrollView, ViewStyle } from 'react-native';

/**
 * 채팅을 처음 열 때 **맨 아래에서 바로** 보이게 한다(2026-10-14 사용자 요청 · 전 채팅 공통).
 *
 * 예전엔 대화를 맨 위부터 한 번 그린 뒤 타이머로 scrollToEnd 를 불러, 웹에서 맨 위가 한 프레임 보였다가
 * 맨 아래로 순간이동했다. 여기서는 콘텐츠 높이가 처음 잡히는 순간 애니메이션 없이 바닥으로 보내고,
 * 그다음 프레임에 보이게 한다. 그 전까지 대화 상자는 투명하다(입력바·헤더는 그대로 보인다).
 *
 * 쓰는 법: ScrollView 의 onContentSizeChange 안에서 `pinOnSize(h)` 를 부르고, style 에 `hideUntilPinned` 를 더한다.
 * 첫 진입 뒤 새 메시지 따라가기는 각 채팅의 기존 로직이 맡는다(`pinned` 로 첫 진입인지 안다).
 */
export function useBottomPin(scrollRef: RefObject<ScrollView | null>) {
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);

  const pinOnSize = useCallback(
    (h: number) => {
      if (pinnedRef.current || h <= 0) return;
      pinnedRef.current = true;
      scrollRef.current?.scrollToEnd({ animated: false });
      requestAnimationFrame(() => setPinned(true));
    },
    [scrollRef],
  );

  const hideUntilPinned: ViewStyle | null = pinned ? null : { opacity: 0 };
  return { pinned, pinnedRef, pinOnSize, hideUntilPinned };
}
