// 사용 안내 팝업 호스트 — useGuideStore 의 현재 요청을 GuideModal 로 렌더한다.
// _layout 최상단(프레임 안)에 1회 마운트. DialogHost 와 같은 배치·같은 이유다.
import { useEffect } from 'react';

import { GuideModal } from '@/components/GuideModal';
import { GUIDES } from '@/lib/guides/guideContent';
import { useGuideStore } from '@/lib/store/useGuideStore';
import { useOverlayStore } from '@/lib/store/useOverlayStore';

export function GuideHost() {
  const current = useGuideStore((s) => s.current);
  const close = useGuideStore((s) => s.close);

  // 이 팝업이 떠 있는 동안엔 뒤의 알림 시트가 기다린다(오버레이 직렬화).
  const enter = useOverlayStore((s) => s.enter);
  const exit = useOverlayStore((s) => s.exit);
  useEffect(() => {
    if (!current) return;
    enter('guide');
    return () => exit('guide');
  }, [current, enter, exit]);

  // key — 가이드가 바뀌면 카드를 새로 마운트해 첫 장부터 시작하게 한다(모달 안에서 되돌리지 않는다).
  return (
    <GuideModal
      key={current ?? 'none'}
      guide={current ? GUIDES[current] : null}
      visible={!!current}
      onClose={close}
    />
  );
}
