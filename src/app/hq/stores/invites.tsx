// /hq/stores/invites — 초대 대기(정본 §5-2): 점주 전화번호로 보낸 초대 중 아직 수락 전인 것.
//
// 2026-10-02 하위 메뉴 개편으로 전체 매장 화면 아래에서 자기 화면으로 나왔다(한 화면에 기능 하나).
// 수락 전에는 매장명이 없다(번호만 · brand-boundary "수락 전 매장명·계정 노출 금지"). 만료는 서버가 status 로 준다.
// `?add=1` 로 들어오면 매장 추가 창을 바로 연다(하위 메뉴의 +).
// ★재료는 이 화면이 직접 받는다(초대 목록 RPC 하나). 전체 매장 화면의 쪽 스토어를 같이 쓰면, 그 화면이
//   떠나며 부르는 reset 이 이 화면의 첫 조회 응답을 버려 로딩에 갇힐 수 있다(두 화면이 replace 로 갈마든다).
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { HqPage, HqButton, HqPill, HqEmpty, HqLoadError, HqNotice } from '@/components/hq/HqKit';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { AddStoreModal } from '@/components/hq/AddStoreModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear } from '@/components/Appear';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { revokeInvite, fetchBrandInvites, type BrandInviteRow } from '@/lib/brand/brandDb';
import { reportError } from '@/lib/analytics/track';
import { brandErrorMessage } from '@/lib/brand/errors';
import { payerLabel } from '@/lib/brand/visibility';
import { formatPhone } from '@/lib/utils/validation';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');

export default function HqStoreInvitesScreen() {
  const router = useRouter();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [invites, setInvites] = useState<BrandInviteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 실패해도 loaded 는 선다(ui.md 게이트 계약). 이전 목록은 그대로 둔다 — 비우면 '초대 없음'으로 읽힌다.
  const refresh = useCallback(async () => {
    const r = await fetchBrandInvites();
    if (r.error) {
      reportError('hqInvites.load', r.error);
      setError(r.error.message);
    } else {
      setInvites(r.data ?? []);
      setError(null);
    }
    setLoaded(true);
  }, []);
  const brand = useBrandStore((s) => s.brand);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const ready = loaded && brandLoaded;
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // 하위 메뉴 + 로 들어오면 창을 연 채로 시작한다. 닫으면 주소에서도 뺀다(새로고침에 다시 열리지 않게).
  const [addOpen, setAddOpen] = useState(add === '1');
  const [seenAdd, setSeenAdd] = useState(add);
  if (add !== seenAdd) {
    setSeenAdd(add);
    if (add === '1') setAddOpen(true);
  }
  const closeAdd = () => {
    setAddOpen(false);
    if (add) router.setParams({ add: undefined });
  };

  const pending = useMemo(() => invites.filter((i) => i.kind === 'store' && i.status === 'pending'), [invites]);

  return (
    <HqPage
      title="초대 대기"
      count={ready && !error ? pending.length : undefined}
      sub="점주가 앱에서 수락하면 전체 매장에 올라와요. 14일이 지나면 만료돼요."
      actions={<HqButton label="매장 추가" icon="add" variant="pri" testID="hq-add-store" onPress={() => setAddOpen(true)} />}
      testID="hq-invites"
    >
      {!ready ? (
        <ScreenLoading label="초대 목록을 불러오고 있어요…" />
      ) : error ? (
        <HqLoadError title="초대 목록을 불러오지 못했어요" onRetry={refresh} testID="hq-invites-error" />
      ) : (
        <Appear>
          <HqTable
            columns={[
              { key: 'phone', label: '점주 전화번호', width: 180, render: (i) => <Cell kind="name">{formatPhone(i.phone ?? '')}</Cell> },
              { key: 'payer', label: '요금 부담', width: 120, render: (i) => <HqPill tone={i.payer === 'brand' ? 'y' : 'n'} label={i.payer ? payerLabel(i.payer) : '—'} /> },
              { key: 'status', label: '상태', width: 110, render: () => <HqPill tone="w" label="대기" /> },
              { key: 'sent', label: '보낸 날', render: (i) => <Cell kind="muted">{fmtDay(i.created_at)}</Cell> },
              { key: 'exp', label: '만료', render: (i) => <Cell kind="muted">{fmtDay(i.expires_at)}</Cell> },
              {
                key: 'act',
                label: '',
                width: 120,
                align: 'right',
                // 취소(0214) — 점주 카드는 즉시 사라진다. 잘못 보낸 번호를 14일 동안 못 거두던 것(사용자 결정 09-23).
                render: (i) => (
                  <HqButton
                    label="초대 취소"
                    testID={`hq-invite-revoke-${i.id}`}
                    onPress={() => {
                      void (async () => {
                        const ok = await confirmAction('초대 취소', `${formatPhone(i.phone ?? '')} 번호로 보낸 초대를 거둘까요? 점주 앱의 요청 카드가 바로 사라져요.`, '취소하기', { destructive: true, icon: 'close-circle-outline' });
                        if (!ok) return;
                        const err = await revokeInvite(i.id);
                        if (err) showToast(brandErrorMessage(err), 'warn');
                        else {
                          showToast('초대를 취소했어요.', 'good');
                          void refresh();
                        }
                      })();
                    }}
                  />
                ),
              },
            ]}
            rows={pending}
            rowKey={(i) => i.id}
            footer={`${pending.length}건`}
            empty={<HqEmpty text="기다리는 초대가 없어요. 점주 전화번호로 매장을 추가할 수 있어요." action={<HqButton label="매장 추가" variant="pri" onPress={() => setAddOpen(true)} />} />}
            testID="hq-invites-table"
          />
          <HqNotice>수락 전에는 매장 이름이 보이지 않아요. 점주가 매장과 공개 수준을 골라 수락하면 그때 보여요.</HqNotice>
        </Appear>
      )}

      {addOpen ? (
        <AddStoreModal
          defaultPayer={brand?.default_payer ?? 'brand'}
          onClose={closeAdd}
          onDone={() => {
            closeAdd();
            void refresh();
          }}
        />
      ) : null}
    </HqPage>
  );
}
