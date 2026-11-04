/**
 * 껍데기 업무 정리 시트(0110, 기획 1단계) — /owner/training 안의 시트다. 새 라우트를 만들지 않는다.
 *
 * 무엇을 치우나: 예전 퀴즈 화면이 "노하우 고르기 → 업무 자동 생성"을 하면서 만든 work_templates 행.
 * 그 행에 반복도 날짜도 없어 occursOn 이 매일 루틴으로 판정했고, 담은 개수만큼 할일이 영구히 늘었다.
 *
 * 지우지 않고 **숨긴다** — 지우면 딸린 노하우 링크·통과 기록까지 cascade 로 사라진다.
 * 다시 띄우는 자리는 두지 않는다(2026-11-03 사용자 결정 · 되돌리기 없음). 고르고 버튼을 누르는 이 시트가 확인 단계다.
 *
 * 이 시트는 2단계 이후에도 남는다 — 축을 옮겨도 이미 생긴 껍데기는 사라지지 않기 때문이다(이사 도구).
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useWorkStore } from '@/lib/store/useWorkStore';
import { showToast } from '@/lib/store/useToastStore';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { SheetHead, PrimaryButton, qst } from './kit';

export type ShellTask = { id: string; text: string; hidden: boolean };

export function ShellTaskCleanupSheet({ tasks, onClose }: { tasks: ShellTask[]; onClose: () => void }) {
  const hideTasks = useWorkStore((s) => s.hideTasks);
  const [busy, setBusy] = useState(false);
  // 기본값 = 전부 체크. 여기 오는 건 "코스에 담겼고 한 번도 체크된 적 없는" 업무라 치우는 게 기본이고,
  // 남기고 싶은 것만 사장이 푼다(전부 직접 고르게 하면 N번 탭이 필요하다).
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tasks.filter((t) => !t.hidden).map((t) => t.id)));

  const left = useMemo(() => tasks.filter((t) => !t.hidden), [tasks]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const apply = async () => {
    const ids = [...picked].filter((id) => left.some((t) => t.id === id));
    if (ids.length === 0 || busy) return;
    setBusy(true);
    const ok = await hideTasks(ids);
    setBusy(false);
    if (ok) {
      showToast(`할일 ${ids.length}개를 숨겼어요`, 'good');
      onClose();
    }
  };

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '80%' }}>
      <SheetHead title="퀴즈 때문에 생긴 할일" onClose={onClose} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} showsVerticalScrollIndicator={false}>
        <Text style={cst.lead}>
          퀴즈에 담으면서 만들어진 할일이에요. 한 번도 체크된 적이 없어요.
          숨기면 할일 목록에서만 빠지고 퀴즈와 노하우는 그대로예요. 한번 숨기면 다시 띄울 수 없어요.
        </Text>

        {/* 반복되는 동종 항목이라 카드가 아니라 행으로 쌓는다(R3-3). 카드는 이 시트에 0개. */}
        <View style={cst.list}>
          {left.map((t, i) => {
            const on = picked.has(t.id);
            return (
              <Pressable
                key={t.id}
                onPress={() => toggle(t.id)}
                style={({ pressed }) => [cst.row, i > 0 && cst.rowTop, pressed && { opacity: 0.85 }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={t.text}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={on ? InkColors.ink : InkColors.ink3}
                />
                <Text style={cst.rowText} numberOfLines={2}>{t.text}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={qst.foot}>
        <PrimaryButton
          label={busy ? '정리하는 중…' : `${picked.size}개 숨기기`}
          disabled={busy || picked.size === 0}
          onPress={() => void apply()}
        />
      </View>
    </BottomSheet>
  );
}

const cst = StyleSheet.create({
  lead: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 23, marginBottom: Space.sm },
  list: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.lg,
    backgroundColor: '#FFFFFF', paddingHorizontal: Space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 52, paddingVertical: Space.sm },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 21 },
});
