/**
 * 교육 링크 줄 목록 — 매장 링크 목록(`/owner/edu-link`)과 공간 교육 탭(`/space/teach`)이 같이 쓴다(2026-11-16 · R-4).
 * 열린 링크를 위로. 같은 칸 안에서는 서버 순서(최근 만든 것 먼저)를 지킨다. 줄 = 제목(비면 "교육 링크") + 상태.
 */
import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';

import { SettingsRow, SettingsSection } from '@/components/settings/SettingsKit';
import { Layout } from '@/lib/theme/layout';
import { isOpenLink } from '@/components/edu/LinkFormStore';
import type { EduLinkRow } from '@/lib/db';
import { daysLeft } from '@/lib/edu/link';
import { SPACE_WORDS, STORE_LINK_LIST } from '@/lib/place/words';

const statusOf = (l: EduLinkRow) => {
  const left = daysLeft(l.expiresAt);
  return l.closedAt
    ? STORE_LINK_LIST.closed
    : left !== null
      ? `${STORE_LINK_LIST.open} · ${STORE_LINK_LIST.daysLeft(left)}`
      : STORE_LINK_LIST.expired;
};

/** top = 카드 안 맨 위에 둘 것(공간 교육 탭의 노란 [새 교육 링크] · 화면조립표 2026-11-17 10절 1번). */
export function EduLinkRows({ links, onOpen, top }: { links: EduLinkRow[]; onOpen: (id: string) => void; top?: ReactNode }) {
  const sorted = [...links].sort((a, b) => Number(isOpenLink(b)) - Number(isOpenLink(a)));
  return (
    <SettingsSection>
      {top ? <View style={styles.top}>{top}</View> : null}
      {sorted.map((l, i) => (
        <SettingsRow key={l.id} first={i === 0 && !top} label={l.title.trim() || SPACE_WORDS.link} hint={statusOf(l)} onPress={() => onOpen(l.id)} />
      ))}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  top: { padding: Layout.cardPad },
});
