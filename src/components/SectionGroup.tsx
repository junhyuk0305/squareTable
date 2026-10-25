import { useId, type ReactNode } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CardStyles } from '@/lib/theme/card';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

/** A category owns its title, content and actions. Rows keep their own padding in flush mode. */
export function SectionGroup({
  title, description, icon, action, footer, children, flush = false, style, contentStyle, groupId,
}: {
  title?: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  groupId?: string;
}) {
  const instance = useId();
  const key = groupId ?? `section-${instance.replace(/[^A-Za-z0-9_-]/g, '')}`;
  // Untitled containers are surfaces, not independently labelled category groups.
  const marker = title ? key : undefined;
  return (
    <View style={[styles.group, style]} testID={marker && `design-group-${marker}`}>
      {title && (
        <View style={styles.header}>
          <View style={styles.heading}>
            <View style={styles.titleRow}>
              {icon && <Ionicons name={icon} size={20} color={InkColors.ink2} />}
              <Text accessibilityRole="header" style={styles.title} testID={`design-group-title-${key}`}>{title}</Text>
            </View>
            {description && <Text style={styles.description}>{description}</Text>}
          </View>
          {action && <View style={styles.action} testID={`design-group-action-${key}--header`}>{action}</View>}
        </View>
      )}
      <View style={[!flush && styles.content, contentStyle]}>{children}</View>
      {footer && (
        <View style={styles.footer} testID={marker && `design-group-action-${key}--footer`}>{footer}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { ...CardStyles.group },
  header: { padding: Space.lg, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.md },
  heading: { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  title: { flex: 1, minWidth: 0, fontSize: 18, lineHeight: 26, fontWeight: '800', color: InkColors.ink },
  description: { fontSize: 15, lineHeight: 23, color: InkColors.ink2, marginTop: Space.xs },
  action: { minHeight: 48, justifyContent: 'center', flexShrink: 1, maxWidth: '100%' },
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.lg },
  footer: { borderTopWidth: 1, borderTopColor: InkColors.line },
});
