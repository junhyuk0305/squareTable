import type { PlaybookEntry } from '@/types';

/**
 * 매뉴얼(챕터별 노하우 묶음) → 붙여넣기용 평문.
 *
 * 매뉴얼은 저장물이 아니라 파생 뷰라, 내보내기도 화면이 이미 만든 그룹을 그대로 직렬화한다
 * (여기서 다시 묶지 않는다 — 화면과 순서가 갈리면 "보이는 것과 다른 게 복사되는" 상태가 된다).
 *
 * 사장이 카톡·메모장에 붙여넣는 용도라 마크다운이 아니라 평문이다.
 * 필드는 사용자 표면 3핵심(상황·할 일·금지)만 — 내부 비계(quagmire/uncover/result)는 뺀다.
 */
export function manualToText(
  groups: { name: string; items: PlaybookEntry[] }[],
  meta: { storeName?: string; date?: string },
): string {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const head = [
    `${meta.storeName?.trim() || '우리 매장'} 운영 매뉴얼`,
    [meta.date, `노하우 ${total}개`].filter(Boolean).join(' · '),
  ].join('\n');

  const body = groups
    .map((g) => {
      const items = g.items
        .map((e, i) => {
          const lines = [`${i + 1}. ${e.title}`];
          const push = (label: string, v?: string) => {
            const t = v?.trim();
            if (t) lines.push(`   ${label}: ${t}`);
          };
          push('상황', e.square?.situation);
          const steps = (e.square?.action?.steps ?? []).map((s) => s.trim()).filter(Boolean);
          if (steps.length === 1) push('할 일', steps[0]);
          else if (steps.length > 1) lines.push('   할 일:', ...steps.map((s) => `     - ${s}`));
          push('금지', e.square?.extract?.dont);
          return lines.join('\n');
        })
        .join('\n\n');
      return `■ ${g.name}\n\n${items}`;
    })
    .join('\n\n\n');

  return `${head}\n\n\n${body}\n`;
}
