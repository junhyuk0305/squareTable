// 사용 안내 팝업 호스트 — useGuideStore 의 현재 요청을 GuideModal 로 렌더한다.
// _layout 최상단(프레임 안)에 1회 마운트. DialogHost 와 같은 배치·같은 이유다.
import { GuideModal } from '@/components/GuideModal';
import { GUIDES } from '@/lib/guides/guideContent';
import { useGuideStore } from '@/lib/store/useGuideStore';

export function GuideHost() {
  const current = useGuideStore((s) => s.current);
  const close = useGuideStore((s) => s.close);

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
