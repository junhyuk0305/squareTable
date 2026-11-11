/**
 * 매장 교육 링크(M06 · 0555) 전용 조각 — 스위치 읽기 · 노하우 탭 위 "교육 링크" 줄 · 본사 노하우 안내 한 줄.
 *
 * 스위치 = my_kind_features 의 ('store','edu_links'). 서버가 계정 판정(허용 목록 또는 edu_links + edu_guest)을 이미 적용했다.
 * 꺼진 계정(허용 목록 밖)은 줄이 없다 = 지금 노하우 탭 그대로. 읽기 전·못 읽음 = 꺼짐으로 그린다.
 * 사장·매니저만(결정 134 · 서버 auth_can('manage_links')). 직원은 /owner/* 에 못 들어오지만 역할로 한 번 더 막는다.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { SettingsRow, SettingsSection } from '@/components/settings/SettingsKit';
import { eduLinksOpenOf, fetchEduLinks, myKindFeatures, storeHasBrandEntries } from '@/lib/db';
import { daysLeft } from '@/lib/edu/link';
import { STORE_LINK } from '@/lib/place/words';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { canManage } from '@/lib/utils/roles';
import { Layout, Space } from '@/lib/theme/layout';

/** 매장 교육 링크 스위치. null = 아직 모름(꺼짐처럼 그린다). */
export function useStoreEduLinksOn(): boolean | null {
  const uid = useSessionStore((s) => s.userId);
  const [on, setOn] = useState<{ uid: string; on: boolean } | null>(null);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void myKindFeatures().then(({ data }) => {
      if (alive) setOn({ uid, on: data ? eduLinksOpenOf(data, 'store') : false });
    });
    return () => { alive = false; };
  }, [uid]);
  return on && on.uid === uid ? on.on : null;
}

/** 본사 노하우가 있는 매장에만 고르기 아래 안내 한 줄. */
export function useStorePickNote(unitId: string): string | undefined {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!unitId) return;
    let alive = true;
    void storeHasBrandEntries(unitId).then((v) => { if (alive) setHas(v); });
    return () => { alive = false; };
  }, [unitId]);
  return has ? STORE_LINK.pickNoBrand : undefined;
}

export const isOpenLink = (l: { closedAt: string | null; expiresAt: string }) => !l.closedAt && daysLeft(l.expiresAt) > 0;

/** 노하우 탭(`/owner/categories`) 맨 위 "교육 링크" 줄. 스위치가 꺼졌거나 사장·매니저가 아니면 아무것도 그리지 않는다. */
export function StoreEduLinkRow() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId);
  const role = useSessionStore((s) => s.role);
  const on = useStoreEduLinksOn();
  const show = !!on && !!unitId && canManage(role);
  const [openN, setOpenN] = useState<number | null>(null);

  // 링크를 만들고 돌아오면 숫자가 바로 맞게 화면에 올 때마다 다시 센다.
  useFocusEffect(
    useCallback(() => {
      if (!show || !unitId) return;
      let alive = true;
      void fetchEduLinks(unitId).then((r) => {
        if (alive) setOpenN(r.data ? r.data.filter(isOpenLink).length : null);
      });
      return () => { alive = false; };
    }, [show, unitId]),
  );

  if (!show) return null;
  return (
    <View style={st.wrap}>
      <SettingsSection>
        <SettingsRow
          first
          icon="link-outline"
          label={STORE_LINK.rowTitle}
          hint={STORE_LINK.rowHint}
          value={openN ? STORE_LINK.openCount(openN) : undefined}
          onPress={() => router.push('/owner/edu-link')}
        />
      </SettingsSection>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginHorizontal: Space.gutter, marginTop: Layout.screenTop },
});
