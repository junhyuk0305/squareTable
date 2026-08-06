import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Appear } from '@/components/Appear';
import { Avatar } from '@/components/Avatar';
import { StoredImage } from '@/components/StoredImage';
import { occursOn, taskVisibleTo, useDaypartLabels, isRoutineTaskId, type TaskTemplate, type DoneMark } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors, CategoryColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { hhmm } from '@/lib/utils/attendance';

const SHARED = CategoryColors.Routine; // 슬레이트 = 가게 공통
const MINE = CategoryColors.Event; // 테라코타 = 개인 담당

type Group = { key: string; name: string; shared: boolean; tasks: TaskTemplate[]; done: number };

/**
 * AssignBoard — 업무 탭 '배정' 세그먼트(사장 전용). 오늘 할일을 **담당자별**로 모아 보여준다.
 * "누가 무슨 일"을 채팅 되짚기 없이 위임 상태로. 데이터·모델·완료토글·사진은 TodoScreen과 동일 재사용
 * (occursOn·taskVisibleTo SSOT). 유일한 차이는 그룹핑 축 = 데이파트 → 담당자(ownerId).
 */
export function AssignBoard({
  templates,
  done,
  today,
  me,
  nameOf,
  uploadingId,
  onToggle,
  onAttachPhoto,
  onAssign,
  onEditTask,
}: {
  templates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  today: string;
  me: string;
  nameOf: (id: string) => string;
  uploadingId?: string | null;
  onToggle: (templateId: string, date: string) => void;
  onAttachPhoto?: (templateId: string, date: string) => void;
  /** 담당자 지정해 컴포저 열기. assigneeId 없으면 가게 전체(shared)로 연다. */
  onAssign: (assigneeId?: string) => void;
  onEditTask: (t: TaskTemplate) => void;
}) {
  const DL = useDaypartLabels();
  const dayDone = useMemo(() => done[today] ?? {}, [done, today]);

  // 오늘 떠야 하는 것 중 내가 볼 수 있는 것만(taskVisibleTo SSOT) → 담당자별 그룹.
  const { groups, total, doneTotal } = useMemo(() => {
    const day = templates.filter((t) => occursOn(t, today) && taskVisibleTo(t, me));
    const map = new Map<string, Group>();
    for (const t of day) {
      const isPrivate = (t.scope ?? 'shared') === 'private';
      const key = isPrivate ? (t.ownerId ?? me) : 'shared';
      const name = key === 'shared' ? '매장 공통' : key === me ? '나' : nameOf(key);
      const g = map.get(key) ?? { key, name, shared: !isPrivate, tasks: [], done: 0 };
      g.tasks.push(t);
      if (dayDone[t.id]) g.done += 1;
      map.set(key, g);
    }
    // 미완료 많은 담당자 먼저, 공통은 뒤로.
    const groups = [...map.values()].sort((a, b) => {
      if (a.shared !== b.shared) return a.shared ? 1 : -1;
      return (b.tasks.length - b.done) - (a.tasks.length - a.done);
    });
    return { groups, total: day.length, doneTotal: [...map.values()].reduce((s, g) => s + g.done, 0) };
  }, [templates, today, me, nameOf, dayDone]);

  const remain = total - doneTotal;

  return (
    <View style={{ flex: 1 }}>
      {/* 요약 바 */}
      <View style={st.summary}>
        <Text style={st.summaryText}>
          오늘 배정 {total}건
          {total > 0 && (remain > 0 ? <Text style={st.rest}> · 남음 {remain}</Text> : <Text style={st.donec}> · 모두 완료</Text>)}
        </Text>
        <Pressable onPress={() => onAssign(undefined)} style={({ pressed }) => [st.assignBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="일 맡기기">
          <Ionicons name="add" size={15} color={InkColors.ink} />
          <Text style={st.assignBtnText}>일 맡기기</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {groups.length === 0 && (
          <Text style={st.empty}>오늘 배정된 일이 없어요. ‘일 맡기기’로 담당을 정해보세요.</Text>
        )}
        {groups.map((g, gi) => (
          <Appear key={g.key} delay={gi * 70} style={st.group}>
            <View style={st.groupHead}>
              {g.shared ? (
                <View style={st.sharedAvatar}><Ionicons name="people" size={14} color={InkColors.bubbleText} /></View>
              ) : (
                <Avatar name={g.name} size={26} />
              )}
              <Text style={st.groupName} numberOfLines={1}>{g.name}</Text>
              <Text style={st.groupCnt}>{g.done}/{g.tasks.length} 완료</Text>
              <Pressable
                onPress={() => onAssign(g.shared ? undefined : g.key)}
                hitSlop={6}
                style={({ pressed }) => [st.addMini, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`${g.name}에게 일 맡기기`}
              >
                <Ionicons name="add" size={16} color={InkColors.ink} />
              </Pressable>
            </View>
            <View style={st.groupList}>
              {g.tasks.map((t, i) => {
                const mark = dayDone[t.id];
                const on = !!mark;
                const photoUrl = (mark as (DoneMark & { photoUrl?: string }) | undefined)?.photoUrl;
                const dp = DL[t.section];
                return (
                  <View key={t.id} style={[st.item, i === g.tasks.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={[st.scopeBar, { backgroundColor: g.shared ? SHARED : MINE }]} />
                    <Pressable onPress={() => onToggle(t.id, today)} style={[st.box, on && st.boxOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      {on && <Ionicons name="checkmark" size={13} color={InkColors.ink} />}
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.itemText, on && st.itemTextOn]}>{t.sectionNote ? `${t.sectionNote} · ${t.text}` : t.text}</Text>
                      {mark ? <Text style={st.itemMeta}>{mark.byName} 완료 · {hhmm(mark.at)}</Text> : dp ? <Text style={st.itemDp}>{dp}</Text> : null}
                    </View>
                    {photoUrl ? <StoredImage stored={photoUrl} style={st.thumb} viewOnPress accessibilityLabel="완료 사진 크게 보기" /> : null}
                    {onAttachPhoto && !on && (
                      <Pressable onPress={() => onAttachPhoto(t.id, today)} hitSlop={6} disabled={!!uploadingId} accessibilityRole="button" accessibilityLabel={`${t.text} 사진으로 완료`}>
                        <Ionicons name={uploadingId === t.id ? 'cloud-upload-outline' : 'camera-outline'} size={16} color={InkColors.ink3} />
                      </Pressable>
                    )}
                    {/* 매장 전체 공용 루틴(dpr_)은 '업무 카테고리 설정'에서 수정 — 여기선 연필 숨김. */}
                    {!isRoutineTaskId(t.id) && (
                      <Pressable onPress={() => onEditTask(t)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${t.text} 수정`}>
                        <Ionicons name="create-outline" size={17} color={InkColors.ink3} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </Appear>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: InkColors.paper,
    borderBottomWidth: 1,
    borderBottomColor: InkColors.line,
  },
  summaryText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  rest: { color: BrandColors.badText },
  donec: { color: BrandColors.goodText },
  assignBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: BrandColors.yellow,
    ...Elevation.ey,
  },
  assignBtnText: { fontSize: 12.5, fontWeight: '900', color: InkColors.ink },

  scroll: { paddingHorizontal: 13, paddingTop: 10, gap: 11 },
  empty: { textAlign: 'center', color: InkColors.ink3, fontSize: 15, marginTop: 30 },
  group: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, ...Elevation.e1 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 48 },
  sharedAvatar: { width: 26, height: 26, borderRadius: Radius.pill, backgroundColor: InkColors.ink3, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontWeight: '900', fontSize: 13.5, color: InkColors.ink, flexShrink: 1 },
  groupCnt: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink2, backgroundColor: InkColors.paper, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 9, paddingVertical: 2, borderRadius: Radius.pill },
  addMini: { marginLeft: 'auto', width: 28, height: 28, borderRadius: 8, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center' },
  groupList: { paddingHorizontal: 10, paddingBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: InkColors.paper },
  scopeBar: { width: 4, height: 22, borderRadius: Radius.pill },
  box: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.6, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  boxOn: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  itemText: { fontSize: 15, fontWeight: '500', color: InkColors.ink },
  itemTextOn: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  itemMeta: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
  itemDp: { fontSize: 11, fontWeight: '700', color: InkColors.ink3, marginTop: 2 },
  thumb: { width: 32, height: 32, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bgSoft },
});
