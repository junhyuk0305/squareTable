import { Platform, type ViewStyle, type TextStyle, type ImageStyle } from 'react-native';
import { InkColors, BrandColors } from './colors';
import { Radius } from './elevation';
import { Space } from './layout';

// Local Expo comparison only. No query parameter can enable this in a release build.
export const designComparisonEnabled = __DEV__ && Platform.OS === 'web'
  && process.env.EXPO_PUBLIC_DESIGN_COMPARE === '1'
  && typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');

export type DesignCategory = 'surface' | 'type' | 'spacing' | 'header';
const selected = new Set(designComparisonEnabled
  ? (new URLSearchParams(window.location.search).get('design') ?? '').split(',') : []);
export const designSelected = (category: DesignCategory) => selected.has(category);

type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;
export function compareStyles<T extends Styles>(base: T, groups: Partial<Record<DesignCategory, Partial<Record<keyof T, ViewStyle | TextStyle | ImageStyle>>>>): T {
  const result = { ...base };
  for (const [category, overrides] of Object.entries(groups)) {
    if (!designSelected(category as DesignCategory)) continue;
    for (const key of Object.keys(overrides)) {
      const name = key as keyof T;
      result[name] = { ...result[name], ...overrides[name] };
    }
  }
  return result;
}

export const DesignTokens = {
  screen: { backgroundColor: InkColors.bgSoft } as ViewStyle,
  card: { backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 0, shadowOpacity: 0, elevation: 0, boxShadow: 'none' } as ViewStyle,
  primary: { backgroundColor: BrandColors.yellow } as ViewStyle,
  primaryText: { color: InkColors.ink } as TextStyle,
  buttonText: { fontSize: 16, lineHeight: 24, fontWeight: '800' } as TextStyle,
  title: { fontSize: 24, lineHeight: 32, fontWeight: '800' } as TextStyle,
  group: { fontSize: 18, lineHeight: 26, fontWeight: '800' } as TextStyle,
  body: { fontSize: 16, lineHeight: 25, fontWeight: '700', color: InkColors.ink } as TextStyle,
  detail: { fontSize: 15, lineHeight: 23, fontWeight: '400', color: InkColors.ink2 } as TextStyle,
  meta: { fontSize: 13, lineHeight: 20, fontWeight: '700', color: InkColors.ink2 } as TextStyle,
  stack: { gap: Space.lg } as ViewStyle,
  row: { paddingHorizontal: Space.lg, paddingVertical: Space.sm, minHeight: 52 } as ViewStyle,
};
