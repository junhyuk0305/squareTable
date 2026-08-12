import { useRouter } from 'expo-router';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { EmptyState } from '@/components/EmptyState';

/**
 * 매장이 0곳일 때 허브 탭(오늘·성장)이 그리는 빈 상태.
 *
 * 왜 있나: 예전엔 두 탭이 매장 0곳이면 `/stores` 로 되돌려버려서, 아직 합류하지 않은 직원은
 * 탭이 보이는데 눌러도 매장 탭으로 튕겨 나왔다("허브의 다른 기능을 볼 수 없다"). 탭은 열어두고
 * 여기서 "합류하면 무엇이 보이는지"를 말한 뒤 다음 행동을 준다(빈 화면에 행동 버튼 필수).
 *
 * 다음 행동은 계정 성격에 따라 갈린다 — 사장 계정은 매장 만들기, 직원 계정은 매장 합류.
 * 판정이 `role` 이 아닌 이유: handle_new_user 가 신규 프로필을 무조건 junior 로 만들어서,
 * 매장을 만들기 전의 사장은 role 만으로는 직원과 구별되지 않는다(가입 때 고른 signupRole 을 본다).
 */
export function NoStoreView({ what }: { what: string }) {
  const router = useRouter();
  const role = useSessionStore((s) => s.role);
  const signupRole = useSessionStore((s) => s.signupRole);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const canCreateStore = role === 'owner' || signupRole === 'owner';

  // 승인 대기 중이면 할 일이 '기다리기'뿐이다 — 코드 입력을 또 권하지 않는다.
  if (pendingUnitId) {
    return (
      <EmptyState
        title="사장님 승인을 기다리고 있어요"
        body={`합류가 승인되면 ${what}이 여기에 보여요.`}
        cta={{ label: '합류 상태 보기', onPress: () => router.push('/junior/hub') }}
      />
    );
  }

  return canCreateStore ? (
    <EmptyState
      title="아직 매장이 없어요"
      body={`매장을 만들면 ${what}이 여기에 보여요.`}
      cta={{ label: '매장 만들기', onPress: () => router.push('/owner/create-store') }}
    />
  ) : (
    <EmptyState
      title="아직 매장이 없어요"
      body={`사장님께 받은 초대코드로 합류하면 ${what}이 여기에 보여요.`}
      cta={{ label: '매장 합류', onPress: () => router.push('/junior/hub') }}
    />
  );
}
