// /hq/settings/members — 설정 > 구성원(정본 §5-2). 담당자는 전원 같은 권한이다(등급 없음 · 정본 §3).
// 셀프 가입이 없어서 초대 링크(7일)를 만들어 전달하면 그 사람이 가입한 뒤 이 브랜드에 합류한다(/hq/join).
// 재료 = useBrandStore(brand_members_list) + useBrandUnitsStore(구성원 초대 = brand_invites_list 의 kind='member').
// 설정류라 등장 애니메이션은 없다(ui.md 예외).
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HqPage, HqButton, HqPill, HqSlab, HqEmpty, HqLoadError } from '@/components/hq/HqKit';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { inviteBrandMember } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { useCopyToClipboard, canCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const joinUrl = (token: string) => {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}/hq/join?token=${token}`;
};

export default function HqSettingsMembersScreen() {
  const members = useBrandStore((s) => s.members);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const brandError = useBrandStore((s) => s.error);
  const hydrateBrand = useBrandStore((s) => s.hydrate);
  const invites = useBrandUnitsStore((s) => s.invites);
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const unitsError = useBrandUnitsStore((s) => s.error);
  const hydrateUnits = useBrandUnitsStore((s) => s.hydrate);
  const ready = brandLoaded && unitsLoaded;
  const error = brandError ?? unitsError;
  const refresh = useCallback(() => Promise.all([hydrateBrand(), hydrateUnits()]), [hydrateBrand, hydrateUnits]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const memberInvites = useMemo(() => invites.filter((i) => i.kind === 'member' && i.status === 'pending' && i.token), [invites]);

  const makeLink = async () => {
    setBusy(true);
    const r = await inviteBrandMember();
    setBusy(false);
    if (r.error || !r.data?.[0]) {
      showToast(brandErrorMessage(r.error), 'warn');
      return;
    }
    setLink({ url: joinUrl(r.data[0].token), expires: r.data[0].expires_at });
    void refresh();
  };

  const head = {
    title: '구성원',
    count: ready && !error ? members.length : undefined,
    sub: '담당자는 모두 같은 권한이에요. 초대 링크를 전달하면 그 사람이 가입한 뒤 합류해요.',
    // 로딩 중에는 잠근다 — 눌러도 아래 대기 목록이 늦게 바뀌어 만들어졌는지 헷갈린다.
    actions: <HqButton label="초대 링크 만들기" variant="pri" icon="link-outline" disabled={busy || !ready} testID="hq-member-invite" onPress={() => void makeLink()} />,
    testID: 'hq-settings-members',
  };
  if (!ready) return <HqPage {...head}><ScreenLoading label="구성원을 불러오고 있어요…" /></HqPage>;
  if (error) return <HqPage {...head}><HqLoadError title="구성원을 불러오지 못했어요" onRetry={refresh} testID="hq-settings-members-error" /></HqPage>;

  return (
    <HqPage {...head}>
      <HqTable
        columns={[
          { key: 'name', label: '이름', width: 240, render: (m) => <Cell kind="name">{m.name || '이름 없음'}</Cell> },
          { key: 'me', label: '', width: 100, render: (m) => (m.is_me ? <HqPill tone="y" label="나" /> : <Cell kind="muted"> </Cell>) },
          { key: 'role', label: '권한', render: () => <Cell kind="muted">담당자</Cell> },
          { key: 'joined', label: '합류일', render: (m) => <Cell kind="muted">{fmtDay(m.joined_at)}</Cell> },
        ]}
        rows={members}
        rowKey={(m) => m.user_id}
        empty={<HqEmpty text="구성원이 없어요." />}
        testID="hq-members-table"
      />

      <HqSlab title="아직 안 쓴 초대 링크" hint="7일이 지나면 만료돼요" />
      <HqTable
        columns={[
          { key: 'made', label: '만든 날', width: 140, render: (i) => <Cell kind="muted">{fmtDay(i.created_at)}</Cell> },
          { key: 'exp', label: '만료', width: 140, render: (i) => <Cell kind="muted">{fmtDay(i.expires_at)}</Cell> },
          { key: 'st', label: '상태', width: 110, render: () => <HqPill tone="w" label="대기" /> },
          {
            key: 'act',
            label: '',
            align: 'right',
            render: (i) =>
              canCopyToClipboard() ? (
                <HqButton label="링크 복사" onPress={() => void copy(joinUrl(i.token!)).then(() => showToast('링크를 복사했어요.', 'good'))} />
              ) : (
                <Cell kind="muted">{joinUrl(i.token!)}</Cell>
              ),
          },
        ]}
        rows={memberInvites}
        rowKey={(i) => i.id}
        empty={<HqEmpty text="기다리는 초대 링크가 없어요." />}
      />

      <HqModal open={!!link} title="초대 링크를 만들었어요" sub={link ? `${fmtDay(link.expires)}까지 쓸 수 있어요. 링크를 받은 사람이 가입하거나 로그인하면 이 브랜드 담당자가 돼요.` : undefined} onClose={() => setLink(null)}>
        {link ? (
          <>
            <View style={styles.linkBox}>
              <Text selectable style={styles.linkText} testID="hq-member-invite-link">{link.url}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: Space.sm, marginTop: Space.lg }}>
              {canCopyToClipboard() ? <HqButton label={copied ? '복사됨' : '링크 복사'} variant="pri" onPress={() => void copy(link.url)} /> : null}
              <HqButton label="닫기" onPress={() => setLink(null)} />
            </View>
          </>
        ) : null}
      </HqModal>
    </HqPage>
  );
}

const styles = StyleSheet.create({
  linkBox: { borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.paper, borderRadius: Radius.sm, padding: 12 },
  linkText: { fontSize: 14, color: InkColors.ink, fontFamily: 'monospace' },
});
