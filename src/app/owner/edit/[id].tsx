import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';

export default function EditKnowledgeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const entry = usePlaybookStore((s) => (id ? s.getById(id) : undefined));
  const update = usePlaybookStore((s) => s.update);
  const remove = usePlaybookStore((s) => s.remove);

  const [title, setTitle] = useState(entry?.title ?? '');
  const [situation, setSituation] = useState(entry?.square.situation ?? '');
  const [quagmire, setQuagmire] = useState(entry?.square.quagmire ?? '');
  const [uncover, setUncover] = useState(entry?.square.uncover ?? '');
  const [steps, setSteps] = useState((entry?.square.action.steps ?? []).join('\n'));
  const [scripts, setScripts] = useState((entry?.square.action.scripts ?? []).join('\n'));
  const [before, setBefore] = useState(entry?.square.result?.before ?? '');
  const [after, setAfter] = useState(entry?.square.result?.after ?? '');
  const [metric, setMetric] = useState(entry?.square.result?.metric ?? '');
  const [doText, setDoText] = useState(entry?.square.extract.do ?? '');
  const [dontText, setDontText] = useState(entry?.square.extract.dont ?? '');
  const [toast, setToast] = useState<string | null>(null);

  const meta = useMemo(() => (entry ? getCategoryMeta(entry.category) : null), [entry]);

  if (!entry) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ title: '노하우 수정' }} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>이미 삭제된 노하우예요.</Text>
          <Pressable onPress={() => router.back()} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
    });
    setToast('수정 저장됨 (v' + (entry.version + 1) + ')');
    setTimeout(() => router.back(), 900);
  };

  const doDelete = () => {
    remove(entry.id);
    router.back();
  };
  const del = () => {
    // 되돌릴 수 없는 작업 → 삭제 전 확인. 웹은 confirm, 네이티브는 Alert.
    if (Platform.OS === 'web') {
      const ok = (globalThis as any).confirm?.('이 노하우를 삭제할까요? 되돌릴 수 없어요.');
      if (ok) doDelete();
      return;
    }
    Alert.alert('노하우 삭제', '이 노하우를 삭제할까요? 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: doDelete },
    ]);
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
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },
  inputMulti: { minHeight: 84, textAlignVertical: 'top' },
  save: { marginTop: 8, backgroundColor: BrandColors.brand, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  del: { alignItems: 'center', paddingVertical: 12 },
  delText: { color: BrandColors.warn, fontSize: 14, fontWeight: '700' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: InkColors.ink3 },
  emptyBtn: { paddingVertical: 12, paddingHorizontal: 22, backgroundColor: InkColors.ink, borderRadius: 12 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800' },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  toast: { backgroundColor: InkColors.ink, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14 },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
