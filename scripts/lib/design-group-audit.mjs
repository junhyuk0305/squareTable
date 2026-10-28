// SectionGroup v2 testID contract (React Native Web exposes testID as data-testid):
// root: design-group-<key>; title: design-group-title-<key>
// action: design-group-action-<key>--<actionId>; row: design-group-row-<key>--<rowId>
// Keys/IDs use letters, digits, '_' or '-'; reserve '--' for the separator.
// Group keys must not start with title-, action-, or row- (reserved marker roles).
// Only category rows use the row marker. Quiz choices and feedback are separate components.

/** Runs inside page.evaluate. Keep this function independent of module scope. */
export function collectDesignGroupSnapshot() {
  const prefix = 'design-group-';
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && css.visibility !== 'hidden' && css.display !== 'none';
  };
  const parse = (el) => {
    const id = el.getAttribute('data-testid') ?? '';
    if (!id.startsWith(prefix)) return null;
    const rest = id.slice(prefix.length);
    const part = /^(title|action|row)-(.+)$/.exec(rest);
    if (!part) return { kind: 'group', key: rest, id };
    const [key, item] = part[2].split('--');
    return { kind: part[1], key, item, id };
  };
  const parentGroup = (el) => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const marker = parse(parent);
      if (marker?.kind === 'group') return marker.key;
    }
    return null;
  };
  return [...document.querySelectorAll('[data-testid^="design-group-"]')]
    .filter(visible)
    .map((el) => {
      const marker = parse(el);
      const css = getComputedStyle(el);
      const hasSurface = css.backgroundColor !== 'transparent' && css.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const hasEdge = [css.borderTopWidth, css.borderBottomWidth, css.borderLeftWidth, css.borderRightWidth]
        .some((width) => parseFloat(width) > 0) || css.boxShadow !== 'none';
      return {
        ...marker,
        parentGroup: parentGroup(el),
        text: marker.kind === 'title' ? el.textContent.trim() : '',
        ownCard: marker.kind === 'row' && hasSurface && hasEdge && parseFloat(css.borderRadius) >= 10,
        nestedGroup: marker.kind === 'row' && [...el.querySelectorAll('[data-testid^="design-group-"]')]
          .some((child) => parse(child)?.kind === 'group' && visible(child)),
      };
    });
}

/** Structural contract only. Does not prove visual quality, reading order, or complete screen migration. */
export function auditDesignGroups(markers) {
  const groups = markers.filter((marker) => marker.kind === 'group');
  const errors = [];
  const validKey = (key) => typeof key === 'string' && /^[A-Za-z0-9_-]+$/.test(key) && !key.includes('--');
  const keys = new Set();
  for (const marker of markers) {
    const itemKind = ['action', 'row'].includes(marker.kind);
    const expectedId = marker.kind === 'group' ? `design-group-${marker.key}`
      : `design-group-${marker.kind}-${marker.key}${itemKind ? `--${marker.item}` : ''}`;
    if (!['group', 'title', 'action', 'row'].includes(marker.kind)
      || !validKey(marker.key) || /^(title|action|row)-/.test(marker.key)
      || (itemKind && !validKey(marker.item)) || marker.id !== expectedId) {
      errors.push(`Invalid marker: ${marker.id}`);
    }
    if (marker.kind === 'group') {
      if (keys.has(marker.key)) errors.push(`Duplicate group: ${marker.key}`);
      keys.add(marker.key);
    }
  }
  for (const marker of markers.filter((item) => item.kind !== 'group')) {
    if (!keys.has(marker.key) || marker.parentGroup !== marker.key) {
      errors.push(`Outside its group: ${marker.id}`);
    }
  }
  for (const group of groups) {
    const titles = markers.filter((marker) => marker.kind === 'title' && marker.key === group.key
      && marker.parentGroup === group.key && marker.text);
    if (titles.length !== 1) errors.push(`Expected one visible title inside: ${group.key}`);
    const rows = markers.filter((marker) => marker.kind === 'row' && marker.parentGroup === group.key);
    if (rows.length >= 2) {
      for (const row of rows) {
        if (row.ownCard || row.nestedGroup) errors.push(`Repeated row has another card: ${row.id}`);
      }
    }
  }
  return {
    status: errors.length ? 'fail' : groups.length ? 'pass' : 'unverified',
    groups: groups.length,
    errors,
  };
}
