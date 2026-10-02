import { useEffect, useState, type ReactNode } from 'react';
import { View, TextInput, Text, StyleSheet, type ViewStyle } from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqRail, HqSubNav, SubLeaf, type RailItem, type SubItem } from '@/components/shell/HqNav';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { fetchBrandOverviewPage, fetchBrandInvites, type BrandOverviewPageRow } from '@/lib/brand/brandDb';
import { confirmAction } from '@/lib/utils/confirm';
import { logout } from '@/lib/auth';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * 본사 대시보드 5메뉴 — 이름은 기획정본 §5-2 그대로(일반 SaaS 어휘).
 * 순서도 정본 순서다: 대시보드 · 매장 · 노하우 · 퀴즈 · 설정.
 */
const HQ_NAV: { path: string; label: string; icon: IconName }[] = [
  { path: '/hq', label: '대시보드', icon: 'grid-outline' },
  { path: '/hq/stores', label: '매장', icon: 'storefront-outline' },
  { path: '/hq/knowhow', label: '노하우', icon: 'bulb-outline' },
  { path: '/hq/quizzes', label: '퀴즈', icon: 'school-outline' },
  { path: '/hq/settings', label: '설정', icon: 'settings-outline' },
];

/** 매장 바로가기 목록 상한 — 넘으면 '전체 매장에서 찾기'로 넘긴다(검색은 서버가 한다). */
const STORE_TREE_LIMIT = 100;

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * 본사 담당자의 데스크톱 셸 — **웹 전용이고 넓은 레이아웃 전용**이다(기획정본 §5-1).
 * 폰 프레임(460)을 쓰지 않고, 매장 앱 화면을 여기 끼워 넣지 않는다.
 *
 * 2단 메뉴(2026-10-02): 아이콘 줄(큰 메뉴) + 하위 메뉴(그 메뉴 안의 화면들 · 매장은 이름 트리까지).
 * 한 화면에 기능 하나 — 예전에 한 화면에 몰려 있던 것(매장 목록 + 초대 대기, 노하우 표 + 배포 상태,
 * 설정 카드 4장)을 하위 메뉴로 나눴다. 대시보드는 한 장이라 하위 메뉴가 없다.
 */
export function HqShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stores = useSessionStore((s) => s.stores);
  const brandName = useBrandStore((s) => s.brand?.brand_name ?? null);
  const hydrateBrand = useBrandStore((s) => s.hydrate);
  // 브랜드 이름은 my_brand 확장 행에서. ★이 스토어는 브랜드 정체성만 받는다 — 매장 축(overview)은
  //   그걸 그리는 화면이 자기 포커스에서 부른다(useBrandUnitsStore). 셸이 부르면 모든 화면에 따라붙는다.
  useEffect(() => { void hydrateBrand(); }, [hydrateBrand]);

  const go = (href: Href) => router.replace(href);
  const rail: RailItem[] = HQ_NAV.map((n) => ({
    key: n.path,
    label: n.label,
    icon: n.icon,
    // '/hq' 는 대시보드라 하위 경로까지 활성으로 보면 전부 켜진다 — 자기 경로만 본다.
    active: n.path === '/hq' ? pathname === '/hq' : under(pathname, n.path),
    onPress: () => go(n.path as Href),
  }));

  // 담당자가 자기 매장도 갖고 있으면(직영 점주 겸직) '내 매장으로' — 아이콘 줄 아래 묶음.
  // ★`unitId` 를 보지 않는다. 노하우 편집기가 작업실을 활성 매장으로 세우므로(0215) 순수 담당자도
  //   `unitId` 가 작업실 id 로 차 있다. 자격의 정본은 `stores` = `my_units()`(`kind='store'` 로 작업실을 뺀다 · 0209).
  const footer: RailItem[] = [];
  if (stores.length > 0) {
    footer.push({ key: 'switch-my-stores', label: '내 매장', icon: 'swap-horizontal-outline', active: false, onPress: () => router.replace('/stores') });
  }
  footer.push({
    key: 'logout',
    label: '로그아웃',
    icon: 'log-out-outline',
    active: false,
    onPress: () => {
      void (async () => {
        if (await confirmAction('로그아웃', '로그아웃하시겠어요?', '로그아웃', { icon: 'log-out-outline' })) {
          await logout();
        }
      })();
    },
  });

  return (
    <View style={styles.outer}>
      <HqRail brandName={brandName ?? '본사'} onBrandPress={() => go('/hq')} items={rail} footer={footer} />
      <SectionNav pathname={pathname} />
      <View testID="hq-main" style={styles.main}>{children}</View>
    </View>
  );
}

/** 지금 큰 메뉴의 하위 메뉴. 대시보드(/hq)는 한 장이라 없다. */
function SectionNav({ pathname }: { pathname: string }) {
  const router = useRouter();
  const push = (href: Href) => router.push(href);
  const item = (key: string, label: string, href: string, active: boolean, count?: number): SubItem => ({
    key, label, count, active, onPress: () => router.replace(href as Href),
  });

  if (under(pathname, '/hq/stores')) return <StoresNav pathname={pathname} />;

  if (under(pathname, '/hq/knowhow')) {
    const status = pathname === '/hq/knowhow/status';
    return (
      <HqSubNav
        title="노하우"
        add={{ label: '노하우 쓰기', testID: 'subnav-add', onPress: () => push({ pathname: '/hq/knowhow/[id]', params: { id: 'new' } }) }}
        // 편집기(/hq/knowhow/<id>)는 '전체 노하우' 안의 화면이다.
        items={[item('knowhow-all', '전체 노하우', '/hq/knowhow', !status), item('knowhow-status', '매장별 배포 상태', '/hq/knowhow/status', status)]}
      />
    );
  }
  if (under(pathname, '/hq/quizzes')) {
    const status = pathname === '/hq/quizzes/status';
    return (
      <HqSubNav
        title="퀴즈"
        add={{ label: '퀴즈 만들기', testID: 'subnav-add', onPress: () => push({ pathname: '/hq/quizzes/[id]', params: { id: 'new' } }) }}
        items={[item('quizzes-all', '전체 퀴즈', '/hq/quizzes', !status), item('quizzes-status', '매장별 배포 상태', '/hq/quizzes/status', status)]}
      />
    );
  }
  if (under(pathname, '/hq/settings')) {
    return (
      <HqSubNav
        title="설정"
        items={[
          item('settings-brand', '브랜드 정보', '/hq/settings', pathname === '/hq/settings'),
          item('settings-members', '구성원', '/hq/settings/members', pathname === '/hq/settings/members'),
          item('settings-billing', '결제', '/hq/settings/billing', pathname === '/hq/settings/billing'),
        ]}
      />
    );
  }
  return null;
}

/**
 * 매장 하위 메뉴 — 전체 매장 · 초대 대기 + 매장 이름 트리(누르면 그 매장 상세).
 *
 * ★전 매장 요약(brand_overview)을 받지 않는다(R1 — 셸이 무거운 집계를 끌고 오지 않는다).
 *   이름 목록은 쪽 입구(0228)로 이름순 앞 100곳만, 검색은 서버가 한다. 초대 수는 초대 목록 RPC 하나.
 * 목록·초대 화면에 있을 때만 다시 받는다 — 매장을 추가·해제하는 곳이 거기다. 상세를 넘겨 볼 때마다 받지 않는다.
 */
function StoresNav({ pathname }: { pathname: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<BrandOverviewPageRow[] | null>(null);
  const [treeErr, setTreeErr] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const atRoot = pathname === '/hq/stores' || pathname === '/hq/stores/invites';
  const [tick, setTick] = useState(0);
  const [lastRoot, setLastRoot] = useState(atRoot);
  // 목록·초대 화면으로 **돌아올 때마다** 한 번 다시 받는다(렌더 중 보정 — effect 안 동기 setState 금지 규칙).
  if (atRoot !== lastRoot) {
    setLastRoot(atRoot);
    if (atRoot) setTick((t) => t + 1);
  }

  // 검색은 멈추고 0.3초 뒤 한 번.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    void fetchBrandOverviewPage({ limit: STORE_TREE_LIMIT, offset: 0, sort: 'name', desc: false, q: query || null }).then((r) => {
      if (!alive) return;
      // 못 읽으면 '불러오지 못했어요' 한 줄 — 빈 목록으로 두면 '매장 없음'으로 읽힌다. 알던 목록은 그대로 둔다.
      setTreeErr(!!r.error);
      if (!r.error) setRows(r.data ?? []);
      if (!r.error && !query) setTotal(r.data?.[0]?.total_all ?? 0);
    });
    return () => { alive = false; };
  }, [query, tick]);

  useEffect(() => {
    let alive = true;
    void fetchBrandInvites().then((r) => {
      if (!alive || r.error) return;
      setPending((r.data ?? []).filter((i) => i.kind === 'store' && i.status === 'pending').length);
    });
    return () => { alive = false; };
  }, [tick]);

  const detailId = pathname.startsWith('/hq/stores/') && pathname !== '/hq/stores/invites'
    ? decodeURIComponent(pathname.slice('/hq/stores/'.length))
    : null;
  const open = (id: string) => router.replace({ pathname: '/hq/stores/[id]', params: { id } });

  return (
    <HqSubNav
      title="매장"
      add={{ label: '매장 추가', testID: 'subnav-add', onPress: () => router.replace({ pathname: '/hq/stores/invites', params: { add: '1' } }) }}
      items={[
        { key: 'stores-all', label: '전체 매장', count: total ?? undefined, active: pathname === '/hq/stores', onPress: () => router.replace('/hq/stores') },
        { key: 'stores-invites', label: '초대 대기', count: pending ?? undefined, active: pathname === '/hq/stores/invites', onPress: () => router.replace('/hq/stores/invites') },
      ]}
    >
      <Text style={styles.treeLabel}>매장 바로가기</Text>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={14} color={InkColors.ink3} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="매장 이름 검색"
          placeholderTextColor={InkColors.ink3}
          style={styles.searchInput}
          accessibilityLabel="매장 이름 검색"
        />
      </View>
      {treeErr ? (
        <Text style={styles.treeNote}>목록을 불러오지 못했어요.</Text>
      ) : rows === null ? null : rows.length === 0 ? (
        <Text style={styles.treeNote}>{query ? '찾는 매장이 없어요.' : '연결된 매장이 없어요.'}</Text>
      ) : (
        <View testID="hq-store-tree">
          {rows.map((r) => (
            <SubLeaf key={r.unit_id} label={r.store_name} active={detailId === r.unit_id} onPress={() => open(r.unit_id)} testID={`hq-tree-${r.unit_id}`} />
          ))}
          {(rows[0]?.total_count ?? 0) > rows.length ? (
            <Text style={styles.treeNote}>앞 {rows.length}곳만 보여요. 이름으로 찾아 주세요.</Text>
          ) : null}
        </View>
      )}
    </HqSubNav>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, flexDirection: 'row', backgroundColor: InkColors.bg },
  // ★폭 캡이 없다 — 본사 화면은 넓은 레이아웃 전용이다(정본 §5-1).
  // ★한글은 어절(띄어쓰기) 단위로만 줄바꿈 — 기본값은 글자 단위라 "본사 부 / 담"처럼 단어 가운데서 끊겼다(10-01).
  //   글자가 상속하므로 본문 전체에 한 번 건다. 띄어쓰기 없는 긴 글자(링크·번호)는 넘치지 않게 anywhere 로 끊는다.
  //   웹 전용 CSS 속성이라 ViewStyle 타입에 없다(본사 셸은 웹 전용).
  main: { flex: 1, minWidth: 0, backgroundColor: InkColors.paper, wordBreak: 'keep-all', overflowWrap: 'anywhere' } as ViewStyle,
  treeLabel: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, paddingHorizontal: Space.sm, marginBottom: Space.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: 10, height: 36, marginBottom: Space.sm },
  searchInput: { flex: 1, fontSize: 14, color: InkColors.ink, paddingVertical: 0, minWidth: 0 },
  treeNote: { fontSize: 13, color: InkColors.ink3, paddingHorizontal: Space.sm, paddingVertical: Space.xs, lineHeight: 18 },
});
