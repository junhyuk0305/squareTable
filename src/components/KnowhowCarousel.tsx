import { useEffect, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { BrowseCard } from './BrowseList';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

// 가로 스크롤 노하우 캐러셀 — 한 화면에 세로로 길게 쌓이던 카드를 가로 드래그로 넘겨본다.
// 카드는 공용 BrowseCard 재사용. 고정폭(CARD_W)으로 다음 카드가 살짝 엿보이게(peek) 한다.
// 사장 둘러보기 + 직원 둘러보기 공용.
const CARD_W = 260;

export type KnowhowCarouselProps = {
  entries: PlaybookEntry[];
  onSelect: (entry: PlaybookEntry) => void;
  /** 카테고리 라벨 노출(사장=true, 직원=false 프레임 v2) */
  showCategory: boolean;
  /** 카드 하단 추가 액션(예: 미검증 섹션의 1탭 검증 버튼) */
  renderExtra?: (entry: PlaybookEntry) => React.ReactNode;
};

export function KnowhowCarousel({ entries, onSelect, showCategory, renderExtra }: KnowhowCarouselProps) {
  const ref = useRef<ScrollView>(null);

  // PC(웹·마우스)에서는 세로 휠로 가로 캐러셀을 넘길 수 없어(터치패드 가로 스와이프만 동작)
  // 사실상 스크롤이 막힌다. 세로 휠을 가로 스크롤로 변환하되, 캐러셀 양 끝에 닿으면
  // 페이지 세로 스크롤에 양보해 사용자가 갇히지 않게 한다.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      const max = node.scrollWidth - node.clientWidth;
      if (max <= 0) return; // 넘길 게 없으면 그대로 세로 스크롤
      const atStart = node.scrollLeft <= 0;
      const atEnd = node.scrollLeft >= max - 1;
      if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) return; // 끝이면 양보
      node.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      // 부모(세로 ScrollView)의 좌우 패딩을 상쇄해 카드가 가장자리까지 자연스럽게 흐르도록.
      style={styles.scroll}
    >
      {entries.map((e) => (
        <BrowseCard
          key={e.id}
          entry={e}
          onSelect={onSelect}
          showCategory={showCategory}
          style={cardStyle}
          renderExtra={renderExtra}
        />
      ))}
    </ScrollView>
  );
}

const cardStyle: ViewStyle = { width: CARD_W };

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -Space.gutter },
  content: { gap: Space.md, paddingHorizontal: Space.gutter, paddingVertical: 2 },
});
