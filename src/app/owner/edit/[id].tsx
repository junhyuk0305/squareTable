import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter, useNavigation } from 'expo-router';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { EmptyState } from '@/components/EmptyState';
import { RoleTabBar } from '@/components/RoleTabBar';
import { getCategoryMeta } from '@/lib/utils/category';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import type { PlaybookEntry } from '@/types';

export default function EditKnowledgeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const loaded = usePlaybookStore((s) => s.loaded);
  const entry = usePlaybookStore((s) => (id ? s.getById(id) : undefined));

  // 스토어 hydrate 전(콜드 진입/새로고침)엔 '삭제됨' 대신 로딩 표시 — 데이터 도착 후에 판단한다.
  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <View style={styles.empty}>
          <ActivityIndicator color={InkColors.ink3} />
        </View>
        <RoleTabBar role="owner" />
      </SafeAreaView>
    );
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <EmptyState
          title="이미 삭제된 노하우예요."
          cta={{ label: '돌아가기', onPress: () => router.back() }}
        />
        <RoleTabBar role="owner" />
      </SafeAreaView>
    );
  }

  // entry 확정 후에만 폼을 마운트 → useState가 항상 올바른 초기값으로 시드된다(빈 폼 방지).
  // key=id로 다른 노하우로 파라미터가 바뀌면 폼이 재마운트돼 새 값으로 시드된다.
  return <EditForm key={entry.id} entry={entry} />;
}

function EditForm({ entry }: { entry: PlaybookEntry }) {
  const router = useRouter();
  const update = usePlaybookStore((s) => s.update);
  const remove = usePlaybookStore((s) => s.remove);
  const userName = useSessionStore((s) => s.userName);

  const [title, setTitle] = useState(entry.title ?? '');
  const [situation, setSituation] = useState(entry.square.situation ?? '');
  const [quagmire, setQuagmire] = useState(entry.square.quagmire ?? '');
  const [uncover, setUncover] = useState(entry.square.uncover ?? '');
  const [steps, setSteps] = useState((entry.square.action.steps ?? []).join('\n'));
  const [scripts, setScripts] = useState((entry.square.action.scripts ?? []).join('\n'));
  const [before, setBefore] = useState(entry.square.result?.before ?? '');
  const [after, setAfter] = useState(entry.square.result?.after ?? '');
  const [metric, setMetric] = useState(entry.square.result?.metric ?? '');
  const [doText, setDoText] = useState(entry.square.extract.do ?? '');
  const [dontText, setDontText] = useState(entry.square.extract.dont ?? '');
  const [toast, setToast] = useState<string | null>(null);
  const navigation = useNavigation();
  const allowLeave = useRef(false); // 저장/삭제로 인한 의도적 이탈은 확인창 생략

  const meta = useMemo(() => (entry ? getCategoryMeta(entry.category) : null), [entry]);

  // 입력이 초기값과 달라졌는지 — 저장 안 한 변경이 있으면 뒤로가기 시 확인.
  const dirty = useMemo(
    () =>
      title !== (entry?.title ?? '') ||
      situation !== (entry?.square.situation ?? '') ||
      quagmire !== (entry?.square.quagmire ?? '') ||
      uncover !== (entry?.square.uncover ?? '') ||
      steps !== (entry?.square.action.steps ?? []).join('\n') ||
      scripts !== (entry?.square.action.scripts ?? []).join('\n') ||
      before !== (entry?.square.result?.before ?? '') ||
      after !== (entry?.square.result?.after ?? '') ||
      metric !== (entry?.square.result?.metric ?? '') ||
      doText !== (entry?.square.extract.do ?? '') ||
      dontText !== (entry?.square.extract.dont ?? ''),
    [title, situation, quagmire, uncover, steps, scripts, before, after, metric, doText, dontText, entry],
  );

  // 저장하지 않은 변경이 있을 때 뒤로가기(헤더·제스처·하드웨어)를 가로채 확인.
  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (!dirty || allowLeave.current) return;
      e.preventDefault();
      confirmAction('나가기', '저장하지 않은 변경이 있어요. 저장 없이 나갈까요?', '나가기', { icon: 'exit-outline' }).then((ok) => {
        if (ok) {
          allowLeave.current = true;
          navigation.dispatch(e.data.action);
        }
      });
    });
    return unsub;
  }, [navigation, dirty]);

  const save = () => {
    update(entry.id, {
      title: title.trim() || entry.title,
      square: {
        ...entry.square,
        situation: situation.trim(),
        quagmire: quagmire.trim(),
        uncover: uncover.trim(),
        action: {
          steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
          scripts: scripts.split('\n').map((s) => s.trim()).filter(Boolean),
        },
        result: { before: before.trim(), after: after.trim(), metric: metric.trim() },
        extract: { ...entry.square.extract, do: doText.trim(), dont: dontText.trim() },
      },
      version: entry.version + 1,
      updated_at: new Date().toISOString(),
      // 사장이 직접 다듬어 저장 = 우리 매장 기준 검증 완료. 미검증(업종 표준값) 꼬리표를 뗀다.
      needs_review: false,
      verification: { state: 'owner_verified', verified_by: userName, verified_at: new Date().toISOString() },
    });
    setToast('수정 저장됨 (v' + (entry.version + 1) + ')');
    allowLeave.current = true; // 저장 완료 → 이탈 확인 생략
    setTimeout(() => router.back(), 900);
  };

  const doDelete = () => {
    allowLeave.current = true; // 삭제 → 이탈 확인 생략
    remove(entry.id);
    router.back();
  };
  const del = async () => {
    // 되돌릴 수 없는 작업 → 삭제 전 확인(앱 내 빨강 모달).
    if (await confirmAction('노하우 삭제', '이 노하우를 삭제할까요? 되돌릴 수 없어요.', '삭제', { destructive: true, icon: 'trash-outline' }))
      doDelete();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '노하우 수정' }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {meta && (
          <Text style={[styles.cat, { color: meta.color }]}>
            {meta.label} · 현재 v{entry.version}
          </Text>
        )}

        <Field label="제목" value={title} onChange={setTitle} />

        <Text style={styles.group}>상황 이해</Text>
        <Field label="상황" value={situation} onChange={setSituation} multiline />
        <Field label="딜레마 (뭐가 어려운지)" value={quagmire} onChange={setQuagmire} multiline />
        <Field label="핵심 통찰 (진짜 이유)" value={uncover} onChange={setUncover} multiline />

        <Text style={styles.group}>행동</Text>
        <Field label="행동 순서 (한 줄에 하나씩)" value={steps} onChange={setSteps} multiline />
        <Field label="고객 멘트 (한 줄에 하나씩)" value={scripts} onChange={setScripts} multiline />

        <Text style={styles.group}>결과</Text>
        <Field label="이전엔 (Before)" value={before} onChange={setBefore} multiline />
        <Field label="이후엔 (After)" value={after} onChange={setAfter} multiline />
        <Field label="수치·효과" value={metric} onChange={setMetric} />

        <Text style={styles.group}>핵심</Text>
        <Field label="꼭 할 것 (Do)" value={doText} onChange={setDoText} multiline />
        <Field label="하지 말 것 (Don't)" value={dontText} onChange={setDontText} multiline />

        <Pressable onPress={save} style={({ pressed }) => [styles.save, pressed && { opacity: 0.88 }]}>
          <Text style={styles.saveText}>저장 (버전 올림)</Text>
        </Pressable>
        <Pressable onPress={del} style={({ pressed }) => [styles.del, pressed && { opacity: 0.7 }]}>
          <Text style={styles.delText}>이 노하우 삭제</Text>
        </Pressable>
        <View style={{ height: 12 }} />
      </ScrollView>

      {toast && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      )}
      <RoleTabBar role="owner" />
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholderTextColor={InkColors.ink3}
        style={[styles.input, multiline && styles.inputMulti]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: 20, gap: 14 },
  cat: { fontSize: 13, fontWeight: '800' },
  group: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, letterSpacing: 1, marginTop: 8, textTransform: 'uppercase' },
  label: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  input: {
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  inputMulti: { minHeight: 84, textAlignVertical: 'top' },
  save: { marginTop: 8, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: Radius.md, alignItems: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  del: { alignItems: 'center', paddingVertical: 12 },
  delText: { color: BrandColors.warn, fontSize: 14, fontWeight: '700' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  // 하단 탭바(약 60px) 위로 띄운다 — 저장 토스트가 탭바에 가리지 않도록.
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 80, alignItems: 'center' },
  toast: { backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 20, borderRadius: Radius.md },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
