// /hq/knowhow/status — 노하우 매장별 배포 상태(하위 메뉴 · 2026-10-02 목록 화면에서 나왔다).
import { useMemo } from 'react';

import { HqDeployStatusPage } from '@/components/hq/HqDeployStatusPage';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import type { BrandDeployCell } from '@/lib/brand/brandDb';

const idOf = (c: BrandDeployCell) => c.entry_id;

export default function HqKnowhowStatusScreen() {
  const list = useBrandKnowhowStore((s) => s.list);
  const matrix = useBrandKnowhowStore((s) => s.matrix);
  const loaded = useBrandKnowhowStore((s) => s.loaded);
  const error = useBrandKnowhowStore((s) => s.error);
  const hydrate = useBrandKnowhowStore((s) => s.hydrate);
  const refresh = useBrandKnowhowStore((s) => s.refresh);
  const rows = useMemo(() => list.map((r) => ({ id: r.id, title: r.title })), [list]);
  return (
    <HqDeployStatusPage
      kind="노하우"
      rows={rows}
      cells={matrix}
      idOf={idOf}
      loaded={loaded}
      error={error}
      hydrate={hydrate}
      refresh={refresh}
      testID="hq-knowhow-status"
    />
  );
}
