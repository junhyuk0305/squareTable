import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BottomSheet } from '@/components/BottomSheet';
import { StoredImage } from '@/components/StoredImage';
import { pickImageWeb } from '@/components/coach/coachUtils';
import { uploadPhoto } from '@/lib/db';
import { showToast } from '@/lib/store/useToastStore';
import { useSyncStore } from '@/lib/store/useSyncStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { ROOM_COLORS } from '@/lib/utils/room';
import { roleNoun } from '@/lib/utils/roles';
import type { Member } from '@/components/work/MentionInput';

export type RoomLookDraft = { name: string; imageUrl?: string; color?: string };

/**
 * RoomComposer — 방 만들기(전역) / 방 모습 바꾸기(개인) 공용 시트.
 *
 * ★두 모드의 차이는 **저장 범위**다(카톡 규칙 · 판정 ⑥·⑦).
 *   · 만들기: 이름·사진·색이 work_rooms 에 들어가 **전원에게** 보인다. 초대할 사람도 여기서 고른다.
 *   · 바꾸기: work_room_prefs 에 들어가 **나에게만** 보인다. 되돌리기로 전역 값에 복귀한다.
 *   그래서 '바꾸기'에는 초대 목록이 없다 — 인원은 서랍에서 관리한다.
 */
export function RoomComposer({
  mode,
  initial,
  candidates,
  hasPersonalLook,
  onClose,
  onCreate,
  onSaveLook,
  onResetLook,
}: {
  mode: 'create' | 'look';
  initial?: RoomLookDraft;
  /** 초대 후보(만들기 모드에서만 쓴다). */
  candidates?: Member[];
  /** 개인 덮어쓰기가 이미 있는지 — 있으면 '되돌리기'를 띄운다. */
  hasPersonalLook?: boolean;
  onClose: () => void;
  /** 서버 확인까지 기다린 결과를 돌려준다(낙관적 토스트 금지). */
  onCreate?: (draft: RoomLookDraft, memberIds: string[]) => Promise<boolean>;
  onSaveLook?: (draft: RoomLookDraft) => void;
  onResetLook?: () => void;
}) {
  const isCreate = mode === 'create';
  const [name, setName] = useState(initial?.name ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl);
  const [color, setColor] = useState(initial?.color);
  const [picked, setPicked] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const noteError = useSyncStore((s) => s.noteError);

  const canSave = name.trim().length > 0 && !uploading && !saving;

  function pickPhoto() {
    if (uploading) return;
    pickImageWeb(async (file) => {
      setUploading(true);
      try {
        // 기존 uploadPhoto 재사용 — WebP 변환 + EXIF 제거가 이미 들어 있다(새 버킷 만들지 않는다).
        const url = await uploadPhoto(file);
        if (url) setImageUrl(url);
        else noteError('사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      } catch {
        noteError('사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      } finally {
        setUploading(false);
      }
    });
  }

  async function save() {
    if (!canSave) return;
    const draft: RoomLookDraft = {
      name: name.trim(),
      ...(imageUrl ? { imageUrl } : null),
      ...(color ? { color } : null),
    };
    if (isCreate) {
      setSaving(true);
      const ok = await onCreate?.(draft, picked);
      setSaving(false);
      if (!ok) return; // 입력은 남긴다 — 다시 시도할 수 있어야 한다(실패 문구는 guardWrite 가 낸다)
      showToast('채팅방을 만들었어요', 'good');
      onClose();
      return;
    }
    onSaveLook?.(draft);
    onClose();
  }

  const initial1 = (name.trim() || '방').slice(0, 1);

  return (
    <BottomSheet visible onClose={onClose} sheetStyle={s.sheet}>
      <Text style={s.title}>{isCreate ? '채팅방 만들기' : '이 방 모습 바꾸기'}</Text>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {!isCreate && (
          <View style={s.personalNote}>
            <Ionicons name="information-circle" size={17} color={InkColors.ink2} />
            <Text style={s.personalNoteText}>여기서 바꾼 이름과 사진은 나에게만 보여요.</Text>
          </View>
        )}

        {/* 사진 · 색 */}
        <View style={s.lookRow}>
          <Pressable onPress={pickPhoto} accessibilityRole="button" accessibilityLabel="방 사진 고르기" style={({ pressed }) => [s.avatarBtn, pressed && { opacity: 0.85 }]}>
            {imageUrl ? (
              <StoredImage stored={imageUrl} style={s.avatar} />
            ) : (
              <View style={[s.avatar, { backgroundColor: color ?? InkColors.bgSoft }]}>
                <Text style={[s.avatarText, !color && { color: InkColors.ink3 }]}>{initial1}</Text>
              </View>
            )}
            <View style={s.camera}>
              <Ionicons name="camera" size={13} color={InkColors.bubbleText} />
            </View>
          </Pressable>
          <View style={s.colors}>
            <Text style={s.colorLabel}>{uploading ? '사진 올리는 중…' : '색'}</Text>
            <View style={s.colorRow}>
              {ROOM_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`색 ${c}`}
                  style={[s.swatch, { backgroundColor: c }, color === c && s.swatchOn]}
                />
              ))}
            </View>
            {imageUrl && (
              <Pressable onPress={() => setImageUrl(undefined)} hitSlop={6} style={({ pressed }) => pressed && { opacity: 0.6 }}>
                <Text style={s.clearPhoto}>사진 지우기</Text>
              </Pressable>
            )}
          </View>
        </View>

        <Field label="방 이름">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="예) 주방, 홀, 매니저"
            placeholderTextColor={InkColors.ink3}
            style={s.inp}
            maxLength={20}
            autoFocus
          />
        </Field>

        {isCreate && (
          <Field label="초대할 사람">
            {(candidates ?? []).length === 0 ? (
              <Text style={s.empty}>아직 합류한 사람이 없어요. 나중에 방 안에서 초대할 수 있어요.</Text>
            ) : (
              (candidates ?? []).map((m) => {
                const on = picked.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                    style={({ pressed }) => [s.memberRow, pressed && { backgroundColor: InkColors.paper }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={m.name}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={19} color={on ? InkColors.ink : InkColors.ink3} />
                    <Text style={s.memberName} numberOfLines={1}>{m.name}</Text>
                    <Text style={s.memberRole}>{roleNoun(m.role)}</Text>
                  </Pressable>
                );
              })
            )}
            <Text style={s.hint}>사장님도 고른 방에만 들어와요.</Text>
          </Field>
        )}

        {!isCreate && hasPersonalLook && (
          <Pressable
            onPress={() => { onResetLook?.(); onClose(); }}
            style={({ pressed }) => [s.reset, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="되돌리기"
          >
            <Ionicons name="refresh" size={15} color={InkColors.ink2} />
            <Text style={s.resetText}>되돌리기 — 처음 정한 이름·사진으로</Text>
          </Pressable>
        )}
      </ScrollView>

      <Pressable onPress={save} disabled={!canSave} style={({ pressed }) => [s.cta, !canSave && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
        <Text style={s.ctaText}>{saving ? '만드는 중…' : isCreate ? '채팅방 만들기' : '저장'}</Text>
      </Pressable>
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  // ★BottomSheet 은 좌우 패딩을 주지 않는다 — 내용이 직접 넣는다(TaskComposerModal 과 같은 규칙).
  //   안 넣으면 글자가 시트 모서리에 붙는다(2026-08-19 실측).
  sheet: { maxHeight: '86%', paddingBottom: Space.lg },
  title: { fontSize: 17, fontWeight: '800', color: InkColors.ink, paddingHorizontal: Space.gutter, paddingBottom: Space.md },
  scroll: { flexGrow: 0, paddingHorizontal: Space.gutter },

  // 안내박스는 기존 형태(TaskComposerModal.infoNote)를 그대로 쓴다 — 새 색을 만들지 않는다.
  personalNote: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: Space.md, marginBottom: Space.lg },
  personalNoteText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink2, lineHeight: 21 },

  lookRow: { flexDirection: 'row', alignItems: 'center', gap: Space.lg, paddingBottom: Space.lg },
  avatarBtn: { width: 64, height: 64 },
  avatar: { width: 64, height: 64, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 26, fontWeight: '800', color: InkColors.bubbleText },
  camera: { position: 'absolute', right: -3, bottom: -3, width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  colors: { flex: 1, gap: Space.sm },
  colorLabel: { fontSize: 12, fontWeight: '800', color: InkColors.ink2 },
  colorRow: { flexDirection: 'row', gap: Space.sm },
  swatch: { width: 28, height: 28, borderRadius: Radius.pill, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: InkColors.ink },
  clearPhoto: { fontSize: 12.5, fontWeight: '700', color: InkColors.ink3, paddingVertical: Space.xs },

  field: { paddingBottom: Space.lg, gap: Space.sm },
  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: InkColors.ink2 },
  inp: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: Space.md, paddingVertical: Space.md, fontSize: 15, color: InkColors.ink, backgroundColor: InkColors.bg },
  empty: { fontSize: 15, color: InkColors.ink3, fontWeight: '600' },
  hint: { fontSize: 15, lineHeight: 21, color: InkColors.ink3, fontWeight: '600' },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, minHeight: 48 },
  memberName: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  memberRole: { fontSize: 12, fontWeight: '700', color: InkColors.ink3 },

  reset: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.md, minHeight: 48 },
  resetText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },

  cta: { backgroundColor: InkColors.ink, borderRadius: Radius.md, paddingVertical: Space.lg, alignItems: 'center', justifyContent: 'center', marginTop: Space.sm, marginHorizontal: Space.gutter, minHeight: 56 },
  ctaText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
});
