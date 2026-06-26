import { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { frameCapStyle } from '@/lib/theme/layout';
import { hhmm } from '@/lib/utils/attendance';
import {
  SECTION_LABEL,
  type TaskTemplate,
  type TaskSection,
  type DoneMark,
} from '@/lib/store/useWorkStore';

/**
 * DaypartChecklist — 오픈/미들/마감(+기타) 데이파트로 묶는 체크리스트.
 *
 * 02 컴포넌트계약 §14의 동작 계약을 따르되, 데이터는 스토어 모델(TaskTemplate/DoneMark)에
 * 그대로 맞춘 **순수 프레젠테이션** 컴포넌트다. 스토어를 직접 import 하지 않고,
 * 부모가 templates + doneMap + 콜백을 내려준다(WorkBoard 재작성과 디커플).
 *
 * - 섹션 헤더: 라벨 + 완료/전체 분수("오픈 2/4") + 옐로 진행 게이지.
 * - 행: 체크박스(ON=옐로 체크) · 할일 텍스트 · 완료 시 완료자·시각 · 사진 썸네일 · "사진" 첨부.
 * - 빈 상태: 03 카피카탈로그 tasks.empty.{junior|senior}.
 * - 색/그림자/라디우스는 DS 토큰만 사용. 모바일 프레임 폭으로 캡.
 */

/** 데이파트 표시 순서 — 'etc'는 항목이 있을 때만 '기타/예정'으로 노출. */
const DAYPART_ORDER: TaskSection[] = ['open', 'mid', 'close', 'etc'];

export interface DaypartChecklistProps {
  /** 그날의 할일 템플릿(섹션 구분 포함). */
  templates: TaskTemplate[];
  /** templateId → 완료 표시(완료자·시각). 없는 키 = 미완료. */
  doneMap: Record<string, DoneMark>;
  /** 체크 토글. 사진 인증 완료 시 photoUrl을 함께 넘길 수 있음. */
  onToggle: (templateId: string, photoUrl?: string) => void;
  /** "사진" 어포던스 탭 — 사진 첨부 플로우 호출(미지정 시 사진 버튼 숨김). */
  onAttachPhoto?: (templateId: string) => void;
  /** true면 체크/사진 비활성(과거 기록 열람 등). */
  readOnly?: boolean;
  /** 빈 상태 카피 분기(기본 junior). */
  role?: 'owner' | 'junior';
  /** 빈 상태에서 보여줄 이름(주니어 격려 문구의 "{이름}님"). */
  emptyName?: string;
}

interface Group {
  key: TaskSection;
  label: string;
  tasks: TaskTemplate[];
  done: number;
}

export function DaypartChecklist({
  templates,
  doneMap,
  onToggle,
  onAttachPhoto,
  readOnly = false,
  role = 'junior',
  emptyName,
}: DaypartChecklistProps) {
  const groups: Group[] = useMemo(() => {
    return DAYPART_ORDER.map((key) => {
      const tasks = templates.filter((t) => t.section === key);
      const done = tasks.filter((t) => doneMap[t.id]).length;
      // 'etc'(기타/예정)는 항목이 있을 때만 노출.
      return { key, label: SECTION_LABEL[key], tasks, done };
    }).filter((g) => (g.key === 'etc' ? g.tasks.length > 0 : true));
  }, [templates, doneMap]);

  const hasAny = templates.length > 0;

  if (!hasAny) {
    const name = emptyName ?? '민지';
    const body =
      role === 'owner'
        ? '지금 직원에게 내려둔 할 일이 없어요. 체크리스트를 하나 만들어 두면 매일 자동으로 떠요.'
        : `오늘 할 일을 다 끝냈어요. 수고했어요, ${name}님! 새 할 일이 생기면 알려드릴게요.`;
    return (
      <View
        style={[styles.empty, frameCapStyle]}
        accessibilityRole="summary"
        accessibilityLabel={body}
      >
        <Ionicons name="checkmark-done-circle-outline" size={30} color={InkColors.ink3} />
        <Text style={styles.emptyText}>{body}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, frameCapStyle]}>
      {groups.map((g) => {
        const total = g.tasks.length;
        const ratio = total > 0 ? g.done / total : 0;
        return (
          <View key={g.key} style={styles.group}>
            <View
              style={styles.groupHead}
              accessibilityRole="header"
              accessibilityLabel={`${g.label} ${g.done}/${total} 완료`}
            >
              <Text style={styles.groupTitle}>{g.label}</Text>
              <Text style={styles.groupFraction}>
                {g.done}/{total}
              </Text>
              <View style={styles.gauge}>
                <View style={[styles.gaugeFill, { width: `${Math.round(ratio * 100)}%` }]} />
              </View>
            </View>

            <View style={styles.card}>
              {total === 0 && <Text style={styles.rowEmpty}>항목 없음</Text>}
              {g.tasks.map((t, i) => {
                const mark = doneMap[t.id];
                const on = !!mark;
                const photoUrl = pickPhoto(mark);
                return (
                  <View key={t.id} style={[styles.row, i === total - 1 && styles.rowLast]}>
                    <PressableScale
                      scaleTo={0.97}
                      onPress={readOnly ? undefined : () => onToggle(t.id)}
                      disabled={readOnly}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: readOnly }}
                      accessibilityLabel={t.text}
                      style={styles.rowMain}
                    >
                      <View style={[styles.box, on ? styles.boxOn : readOnly && styles.boxMuted]}>
                        {on && <Ionicons name="checkmark" size={15} color={InkColors.ink} />}
                      </View>
                      <View style={styles.rowBody}>
                        <Text style={[styles.taskText, on && styles.taskTextOn]}>{t.text}</Text>
                        {on && mark ? (
                          <Text style={styles.taskMeta}>
                            {mark.byName} 완료 · {hhmm(mark.at)}
                          </Text>
                        ) : t.dueDate ? (
                          <Text style={styles.taskPlanned}>예정</Text>
                        ) : null}
                      </View>
                    </PressableScale>

                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.thumb} accessibilityLabel="완료 인증 사진" />
                    ) : null}

                    {onAttachPhoto && !readOnly ? (
                      <PressableScale
                        scaleTo={0.92}
                        onPress={() => onAttachPhoto(t.id)}
                        accessibilityRole="button"
                        accessibilityLabel={photoUrl ? '사진 다시 첨부하기' : '사진 첨부하기'}
                        style={styles.photoBtn}
                      >
                        <Ionicons name="camera-outline" size={15} color={InkColors.ink2} />
                        <Text style={styles.photoBtnText}>사진</Text>
                      </PressableScale>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** DoneMark에 photoUrl이 실려 올 수 있으나 타입엔 없어, 있으면 안전하게 읽는다. */
function pickPhoto(mark?: DoneMark): string | undefined {
  const v = (mark as (DoneMark & { photoUrl?: string }) | undefined)?.photoUrl;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 32, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 21 },

  group: { gap: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  groupFraction: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },
  gauge: {
    flex: 1,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.line,
    overflow: 'hidden',
  },
  gaugeFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: BrandColors.yellow },

  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    paddingHorizontal: 14,
    ...Elevation.e1,
  },
  rowEmpty: { fontSize: 13, color: InkColors.ink3, paddingVertical: 14 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBody: { flex: 1 },

  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: InkColors.bg,
  },
  boxOn: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  boxMuted: { borderStyle: 'dashed', backgroundColor: InkColors.bgSoft },

  taskText: { fontSize: 15, color: InkColors.ink, fontWeight: '500' },
  taskTextOn: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  taskMeta: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
  taskPlanned: { fontSize: 11, color: BrandColors.accent, fontWeight: '700', marginTop: 2 },

  thumb: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: InkColors.bgSoft,
  },
  photoBtnText: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
});
