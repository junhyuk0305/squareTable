import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Appear } from '@/components/Appear';
import { StoredImage } from '@/components/StoredImage';
import { DaypartSettingsSheet } from '@/components/work/DaypartSettingsSheet';
import { useDayparts, isRoutineTaskId, occursOn, taskVisibleTo, type TaskTemplate, type DoneMark } from '@/lib/store/useWorkStore';
import { InkColors, BrandColors, CategoryColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';
import { hhmm } from '@/lib/utils/attendance';
import { confirmAction } from '@/lib/utils/confirm';

const SHARED = CategoryColors.Routine; // 슬레이트 = 가게 전체
const MINE = CategoryColors.Event; // 테라코타 = 내가 등록(나만)
const WD = ['일', '월', '화', '수', '목', '금', '토'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * TodoScreen — 우상단 [할일]로 진입. 접이식 월 달력 + 선택일 데이파트 그룹.
 * 색 = 가게 전체(슬레이트) / 내가 등록(테라코타). 채팅 할일과 데이파트 통일.
 */
export function TodoScreen({
  templates,
  done,
  today,
  isOwner,
  me,
  nameOf,
  uploadingId,
  onToggle,
  onAttachPhoto,
  onAddForDate,
  onEditTask,
  knowhowOf,
  onOpenKnowhow,
  understoodNames,
  canSelfCheck,
  onSelfCheck,
}: {
  templates: TaskTemplate[];
  done: Record<string, Record<string, DoneMark>>;
  today: string;
  isOwner: boolean;
  me: string;
  nameOf?: (id: string) => string;
  uploadingId?: string | null;
  onToggle: (templateId: string, date: string) => void;
  onAttachPhoto?: (templateId: string, date: string) => void;
  onAddForDate: (date: string) => void;
  /** 연필 → 수정/삭제 시트. (X 즉시삭제를 대체 — 회의 반영) */
  onEditTask: (t: TaskTemplate) => void;
  /** 이 업무에 붙은 노하우(제목) — 카드에 칩으로 노출. 없으면 칩 안 뜸(0069). */
  knowhowOf?: (templateId: string) => { id: string; title: string }[];
  /** 칩 탭 → 노하우 원문 열람(EntryDetailModal). */
  onOpenKnowhow?: (entryId: string) => void;
  /** 이해 확인(④) 통과자 이름 — 배지 노출(사장=전체, 직원=본인만). 없으면 배지 안 뜸. */
  understoodNames?: (templateId: string) => string[];
  /** '혼자 할 수 있어요' 자청 노출 여부(직원·노하우 있음·미통과). */
  canSelfCheck?: (templateId: string) => boolean;
  /** 자청 → 이해 확인 퀴즈 시트(직원 전용, 사장이면 undefined). */
  onSelfCheck?: (t: TaskTemplate) => void;
}) {
  const dayparts = useDayparts();
  const [selected, setSelected] = useState(today);
  const [folded, setFolded] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(`${today}T00:00:00`)); // 보고 있는 월
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hideDone, setHideDone] = useState(false);
  const [setMenu, setSetMenu] = useState(false);
  const [daypartEditor, setDaypartEditor] = useState(false);

  // 내가 볼 수 있는 할일 — taskVisibleTo SSOT(0017 RLS 정합).
  const visible = useMemo(() => templates.filter((t) => taskVisibleTo(t, me)), [templates, me]);

  // 월 그리드
  const grid = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const lead = first.getDay(); // 0=일
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { date: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < lead; i++) {
      const d = new Date(y, m, 1 - (lead - i));
      cells.push({ date: ymd(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: ymd(new Date(y, m, d)), day: d, inMonth: true });
    while (cells.length % 7 !== 0) {
      const last = new Date(`${cells[cells.length - 1].date}T00:00:00`);
      last.setDate(last.getDate() + 1);
      cells.push({ date: ymd(last), day: last.getDate(), inMonth: false });
    }
    return cells;
  }, [cursor]);

  // 날짜별 점(가게/개인)
  function dotsFor(date: string): { shared: boolean; mine: boolean } {
    let shared = false;
    let mine = false;
    for (const t of visible) {
      if (!occursOn(t, date)) continue;
      if ((t.scope ?? 'shared') === 'private') mine = true;
      else shared = true;
      if (shared && mine) break;
    }
    return { shared, mine };
  }

  // 선택일 그룹 — 매장 카테고리(데이파트) 순서대로 + 삭제된 카테고리 할일 흡수용 말미 '기타' 그룹.
  const dayTasks = useMemo(() => visible.filter((t) => occursOn(t, selected)), [visible, selected]);
  const dayDone = done[selected] ?? {};
  const knownIds = new Set(dayparts.map((d) => d.id));
  const mkGroup = (key: string, label: string, secTasks: TaskTemplate[]) => {
    const tasks = secTasks.filter((t) => !hideDone || !dayDone[t.id]);
    const doneN = secTasks.filter((t) => dayDone[t.id]).length;
    return { key, label, tasks, total: secTasks.length, doneN };
  };
  const groups = [
    ...dayparts.map((d) => mkGroup(d.id, d.label, dayTasks.filter((t) => t.section === d.id))),
    // 알 수 없는 section(삭제된 카테고리)의 할일이 사라지지 않게 흡수.
    mkGroup('__orphan__', '기타', dayTasks.filter((t) => !knownIds.has(t.section))),
  ].filter((g) => g.total > 0);

  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
  const selDate = new Date(`${selected}T00:00:00`);
  const selLabel = `${selDate.getMonth() + 1}월 ${selDate.getDate()}일 (${WD[selDate.getDay()]})`;

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <View style={{ flex: 1 }}>
      {/* 접이식 캘린더 */}
      <View style={s.calWrap}>
        <View style={s.calBar}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={8}><Ionicons name="chevron-back" size={18} color={InkColors.ink2} /></Pressable>
          <Pressable onPress={() => setFolded((v) => !v)} style={s.monthTap}>
            <Text style={s.month}>{monthLabel}</Text>
            <Ionicons name={folded ? 'chevron-down' : 'chevron-up'} size={15} color={InkColors.ink2} />
          </Pressable>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={8}><Ionicons name="chevron-forward" size={18} color={InkColors.ink2} /></Pressable>
          <Pressable onPress={() => { setCursor(new Date(`${today}T00:00:00`)); setSelected(today); }} style={s.todayBtn}>
            <Text style={s.todayText}>오늘</Text>
          </Pressable>
          <Pressable onPress={() => setSetMenu((v) => !v)} hitSlop={8} style={{ marginLeft: 4 }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={InkColors.ink2} />
          </Pressable>
        </View>

        {!folded && (
          <View style={s.calGrid}>
            <View style={s.weekRow}>
              {WD.map((w, i) => (
                <Text key={w} style={[s.weekCell, i === 0 && { color: BrandColors.bad }]}>{w}</Text>
              ))}
            </View>
            <View style={s.daysWrap}>
              {grid.map((c) => {
                const d = dotsFor(c.date);
                const isSel = c.date === selected;
                const isToday = c.date === today;
                return (
                  <Pressable key={c.date} onPress={() => { setSelected(c.date); if (!c.inMonth) { const d = new Date(`${c.date}T00:00:00`); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); } }} style={[s.cell, isToday && !isSel && s.cellToday, isSel && s.cellSel]}>
                    <Text style={[s.cellNum, !c.inMonth && s.cellMute, isSel && { color: '#fff' }]}>{c.day}</Text>
                    <View style={s.dots}>
                      {d.shared && <View style={[s.dot, { backgroundColor: SHARED }]} />}
                      {d.mine && <View style={[s.dot, { backgroundColor: MINE }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* 접기/펴기 핸들 — 월 라벨 탭과 같은 토글. 작은 캐럿만으론 발견이 안 돼 전폭 핸들 병행. */}
        <Pressable
          onPress={() => setFolded((v) => !v)}
          hitSlop={{ top: 8, bottom: 8 }}
          style={({ pressed }) => [s.foldHandle, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={folded ? '달력 펴기' : '달력 접기'}
        >
          <Ionicons name={folded ? 'chevron-down' : 'chevron-up'} size={16} color={InkColors.ink3} />
        </Pressable>
      </View>

      {/* 설정 메뉴 */}
      {setMenu && (
        <>
          <Pressable style={s.menuBackdrop} onPress={() => setSetMenu(false)} />
          <View style={s.setMenu}>
            <Pressable onPress={() => setHideDone((v) => !v)} style={({ pressed }) => [s.setMi, pressed && { backgroundColor: InkColors.paper }]}>
              <Ionicons name={hideDone ? 'eye-off-outline' : 'checkmark-done-outline'} size={16} color={InkColors.ink2} />
              <Text style={s.setMiText}>완료 항목 숨기기</Text>
              <Text style={s.setMiTag}>{hideDone ? '켬' : '끔'}</Text>
            </Pressable>
            {isOwner && (
              <Pressable onPress={() => { setSetMenu(false); setDaypartEditor(true); }} style={({ pressed }) => [s.setMi, pressed && { backgroundColor: InkColors.paper }]}>
                <Ionicons name="pricetags-outline" size={16} color={InkColors.ink2} />
                <Text style={s.setMiText}>업무 카테고리 설정</Text>
                <Ionicons name="chevron-forward" size={14} color={InkColors.ink3} style={{ marginLeft: 'auto' }} />
              </Pressable>
            )}
            <View style={s.setSep} />
            <View style={s.legendRow}>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: SHARED }]} /><Text style={s.legendText}>매장 전체</Text></View>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: MINE }]} /><Text style={s.legendText}>내가 등록(나만)</Text></View>
            </View>
          </View>
        </>
      )}

      {/* 선택일 헤더 */}
      <View style={s.dayBar}>
        <Text style={s.dayTitle}>{selLabel}</Text>
        <Text style={s.dayCount}>· 할일 {dayTasks.length}</Text>
        <View style={s.legendInline}>
          <View style={s.legendChip}>
            <View style={[s.legendDot, { backgroundColor: SHARED }]} />
            <Text style={s.legendChipText}>매장 전체</Text>
          </View>
          <View style={s.legendChip}>
            <View style={[s.legendDot, { backgroundColor: MINE }]} />
            <Text style={s.legendChipText}>내 할일</Text>
          </View>
        </View>
      </View>

      {/* 데이파트 그룹 */}
      <ScrollView contentContainerStyle={s.listScroll} showsVerticalScrollIndicator={false}>
        {groups.length === 0 && <Text style={s.empty}>이 날 할일이 없어요.</Text>}
        {groups.map((g, gi) => {
          const isCol = collapsed[`${selected}:${g.key}`];
          return (
            <Appear key={g.key} delay={gi * 70} style={s.group}>
              <Pressable onPress={() => setCollapsed((c) => ({ ...c, [`${selected}:${g.key}`]: !isCol }))} style={s.groupHead}>
                <Text style={s.groupName}>{g.label}</Text>
                <Text style={s.groupCnt}>{g.doneN}/{g.total}</Text>
                <Ionicons name={isCol ? 'chevron-down' : 'chevron-up'} size={14} color={InkColors.ink3} style={{ marginLeft: 'auto' }} />
              </Pressable>
              {!isCol && (
                <View style={s.groupList}>
                  {g.tasks.map((t, i) => {
                    const mark = dayDone[t.id];
                    const on = !!mark;
                    const isMine = (t.scope ?? 'shared') === 'private';
                    // 매장 전체 공용 루틴(dpr_) — 수정/삭제는 '업무 카테고리 설정'에서(합성 항목이라 여기선 연필 숨김).
                    const isRoutine = isRoutineTaskId(t.id);
                    // 배정된 할일(개인인데 주인이 내가 아님) → 사장 시점에서 "담당 ○○"로 표시.
                    const assignedName = isMine && t.ownerId && t.ownerId !== me ? nameOf?.(t.ownerId) : undefined;
                    const photoUrl = (mark as (DoneMark & { photoUrl?: string }) | undefined)?.photoUrl;
                    // 수정/삭제 권한 = 사장 or 본인이 등록/배정받은 개인 할일. (X 즉시삭제 → 연필로 수정·삭제)
                    const canManage = (isOwner || (isMine && (t.ownerId === me || t.createdBy === me))) && !isRoutine;
                    const khs = knowhowOf?.(t.id) ?? [];
                    const uNames = understoodNames?.(t.id) ?? [];
                    const selfCheckable = !!onSelfCheck && !!canSelfCheck?.(t.id);
                    return (
                      <View key={t.id} style={[s.item, isMine && s.itemMine, i === g.tasks.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={[s.scopeBar, { backgroundColor: isMine ? MINE : SHARED }]} />
                        <Pressable onPress={() => {
                          // 완료 취소 시 첨부한 완료 사진이 함께 삭제되므로 미리 경고(파괴적 동작).
                          if (on && photoUrl) {
                            void confirmAction('완료를 취소할까요?', '체크를 풀면 이 업무에 첨부한 완료 사진도 함께 삭제돼요.', '취소하고 사진 삭제', { destructive: true, icon: 'image-outline' }).then((ok) => { if (ok) onToggle(t.id, selected); });
                            return;
                          }
                          onToggle(t.id, selected);
                        }} style={[s.box, on && s.boxOn]}>
                          {on && <Ionicons name="checkmark" size={13} color={InkColors.ink} />}
                        </Pressable>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.itemText, on && s.itemTextOn]}>{t.sectionNote ? `${t.sectionNote} · ${t.text}` : t.text}</Text>
                          {mark && <Text style={s.itemMeta}>{mark.byName} 완료 · {hhmm(mark.at)}</Text>}
                          {khs.length > 0 && (
                            <View style={s.khRow}>
                              {khs.map((k) => (
                                <Pressable key={k.id} onPress={() => onOpenKnowhow?.(k.id)} style={({ pressed }) => [s.khChip, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`노하우 보기: ${k.title}`}>
                                  <Ionicons name="document-text-outline" size={11} color={InkColors.ink2} />
                                  <Text style={s.khChipText} numberOfLines={1}>{k.title}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                          {uNames.length > 0 && (
                            <View style={s.uBadge}>
                              <Ionicons name="ribbon-outline" size={11} color={BrandColors.good} />
                              <Text style={s.uBadgeText} numberOfLines={1}>{uNames.join('·')} 이해 확인</Text>
                            </View>
                          )}
                          {selfCheckable && (
                            <Pressable onPress={() => onSelfCheck?.(t)} style={({ pressed }) => [s.selfBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${t.text} 혼자 할 수 있어요`}>
                              <Ionicons name="school-outline" size={12} color={InkColors.ink} />
                              <Text style={s.selfBtnText}>혼자 할 수 있어요</Text>
                            </Pressable>
                          )}
                        </View>
                        {photoUrl ? <StoredImage stored={photoUrl} style={s.thumb} viewOnPress accessibilityLabel="완료 사진 크게 보기" /> : null}
                        {isRoutine ? <Text style={s.routineTag}>루틴</Text> : assignedName ? <Text style={s.assignTag}>담당 {assignedName}</Text> : isMine ? <Text style={s.mineTag}>내 할일</Text> : null}
                        {onAttachPhoto && !on && (
                          <Pressable onPress={() => onAttachPhoto(t.id, selected)} hitSlop={6} disabled={!!uploadingId} accessibilityRole="button" accessibilityLabel={`${t.text} 사진으로 완료`}>
                            <Ionicons name={uploadingId === t.id ? 'cloud-upload-outline' : 'camera-outline'} size={16} color={InkColors.ink3} />
                          </Pressable>
                        )}
                        {canManage && (
                          <Pressable onPress={() => onEditTask(t)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${t.text} 수정`}>
                            <Ionicons name="create-outline" size={17} color={InkColors.ink3} />
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </Appear>
          );
        })}
        <Pressable onPress={() => onAddForDate(selected)} style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.7 }]}>
          <Ionicons name="add" size={17} color={InkColors.ink} />
          <Text style={s.addText}>이 날 할일 추가</Text>
        </Pressable>
        <View style={{ height: 20 }} />
      </ScrollView>

      {daypartEditor && <DaypartSettingsSheet onClose={() => setDaypartEditor(false)} />}
    </View>
  );
}

const s = StyleSheet.create({
  calWrap: { backgroundColor: InkColors.cream, borderBottomWidth: 1, borderBottomColor: InkColors.line },
  calBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  monthTap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  month: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  todayBtn: { marginLeft: 'auto', borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg, borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  todayText: { fontSize: 11, fontWeight: '700', color: InkColors.ink2 },

  calGrid: { paddingHorizontal: 10, paddingBottom: 8 },
  weekRow: { flexDirection: 'row', paddingVertical: 4 },
  weekCell: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '800', color: InkColors.ink3 },
  daysWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, minHeight: 42, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: Radius.sm, paddingVertical: 3 },
  cellToday: { backgroundColor: InkColors.bg, ...Elevation.e1 },
  cellSel: { backgroundColor: InkColors.ink },
  cellNum: { fontSize: 13, fontWeight: '600', color: InkColors.ink },
  cellMute: { color: InkColors.ink3, opacity: 0.45 },
  dots: { flexDirection: 'row', gap: 2.5, height: 6 },
  dot: { width: 5, height: 5, borderRadius: Radius.pill },
  foldHandle: { alignItems: 'center', justifyContent: 'center', minHeight: 32 },

  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 },
  setMenu: { position: 'absolute', right: 12, top: 44, backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: 6, width: 220, zIndex: 6, ...Elevation.e3 },
  setMi: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: Radius.sm },
  setMiText: { fontSize: 13, fontWeight: '600', color: InkColors.ink },
  setMiTag: { marginLeft: 'auto', fontSize: 11, color: InkColors.ink3 },
  setSep: { height: 1, backgroundColor: InkColors.line, marginVertical: 4, marginHorizontal: 8 },
  legendRow: { flexDirection: 'row', gap: 14, padding: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 11, fontWeight: '700', color: InkColors.ink2 },

  dayBar: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 15, paddingTop: 11, paddingBottom: 4, backgroundColor: InkColors.paper },
  dayTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  dayCount: { fontSize: 12, fontWeight: '700', color: InkColors.ink2 },
  legendInline: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  legendChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendChipText: { fontSize: 10.5, fontWeight: '700', color: InkColors.ink2 },

  listScroll: { paddingHorizontal: 13, paddingTop: 8, gap: 11 },
  empty: { textAlign: 'center', color: InkColors.ink3, fontSize: 15, marginTop: 30 },
  group: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, ...Elevation.e1 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 46 },
  groupName: { fontWeight: '800', fontSize: 13.5, color: InkColors.ink },
  groupCnt: { fontSize: 11, fontWeight: '700', color: InkColors.ink3 },
  groupList: { paddingHorizontal: 10, paddingBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: InkColors.paper },
  // 내 할일 = 옅은 테라코타 틴트로 한눈에 구분(스코프 바·태그와 같은 색 계열).
  itemMine: { backgroundColor: CategoryColors.Event + '12', borderRadius: Radius.sm },
  scopeBar: { width: 4, height: 22, borderRadius: Radius.pill },
  box: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.6, borderColor: InkColors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.bg },
  boxOn: { backgroundColor: BrandColors.yellow, borderColor: BrandColors.yellowDeep },
  itemText: { fontSize: 15, fontWeight: '500', color: InkColors.ink },
  itemTextOn: { color: InkColors.ink3, textDecorationLine: 'line-through' },
  itemMeta: { fontSize: 11, color: InkColors.ink3, marginTop: 2 },
  // 첨부 노하우 칩 — 카드 본문 아래, 탭하면 원문 열람. 옅은 크림 필로 업무 텍스트와 구분.
  khRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  khChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: InkColors.cream },
  khChipText: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: InkColors.ink2 },
  // ④ 이해 확인 배지(통과자) — 초록 톤, 카드 본문 아래. 노하우 칩과 구분.
  uBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 5, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#E6F1EA' },
  uBadgeText: { flexShrink: 1, fontSize: 10.5, fontWeight: '800', color: BrandColors.good },
  // ④ '혼자 할 수 있어요' 자청 버튼(직원, 미통과) — 옅은 노랑 필로 눈에 띄되 가볍게.
  selfBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 5, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: BrandColors.yellowSoft, borderWidth: 1, borderColor: BrandColors.yellowDeep },
  selfBtnText: { fontSize: 11.5, fontWeight: '800', color: InkColors.ink },
  thumb: { width: 32, height: 32, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bgSoft },
  mineTag: { fontSize: 10, fontWeight: '800', color: MINE, backgroundColor: CategoryColors.Event + '1f', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },
  assignTag: { fontSize: 10, fontWeight: '800', color: SHARED, backgroundColor: CategoryColors.Routine + '1f', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },
  routineTag: { fontSize: 10, fontWeight: '800', color: InkColors.ink2, backgroundColor: InkColors.bgSoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5 },

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1.5, borderStyle: 'dashed', borderColor: InkColors.ink3, borderRadius: Radius.md, paddingVertical: 13 },
  addText: { fontSize: 13, fontWeight: '700', color: InkColors.ink },
});
