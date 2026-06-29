import { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, Platform, StyleSheet } from 'react-native';

import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Elevation, Radius } from '@/lib/theme/elevation';

export type Member = { id: string; name: string; role: 'owner' | 'junior' };

const ALL_TOKEN = '전체';

/**
 * 텍스트에서 멘션된 멤버 id를 추출(+@전체면 모든 멤버).
 * MentionText(강조 렌더)와 동일하게 "긴 이름 우선" 토큰 매칭을 써서
 * 접두어 false positive(예: '김'이 '@김영자'에 잘못 걸림)를 막고 렌더와 일치시킨다.
 */
export function extractMentions(text: string, members: Member[]): string[] {
  if (text.includes(`@${ALL_TOKEN}`)) return members.map((m) => m.id);
  if (members.length === 0) return [];
  const sorted = [...members].sort((a, b) => b.name.length - a.name.length);
  const esc = sorted.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${esc.join('|')})`, 'g');
  const byName = new Map(members.map((m) => [m.name, m.id]));
  const ids: string[] = [];
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(text))) {
    const id = byName.get(mt[1]);
    if (id) ids.push(id);
  }
  return Array.from(new Set(ids));
}

/**
 * @멘션 자동완성 입력 — 입력 끝의 `@쿼리`를 감지해 멤버 목록을 위로 띄운다.
 * 선택하면 `@이름 `으로 치환. 제출 시 mentions는 extractMentions로 계산(부모가).
 */
export function MentionInput({
  value,
  onChangeText,
  onSubmit,
  members,
  placeholder = '메시지 보내기',
  style,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit?: () => void;
  members: Member[];
  placeholder?: string;
  style?: object;
}) {
  const [focused, setFocused] = useState(false);

  // 입력 끝의 @쿼리 감지 (@뒤 공백 없는 토큰).
  const query = useMemo(() => {
    const m = /@([^\s@]*)$/.exec(value);
    return m ? m[1] : null;
  }, [value]);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    const list = members.filter((m) => m.name.toLowerCase().startsWith(q));
    // @전체 옵션 — 쿼리가 비었거나 '전'으로 시작할 때
    const showAll = q === '' || ALL_TOKEN.startsWith(q) || '전체'.includes(q);
    return showAll ? [{ id: '__all__', name: ALL_TOKEN, role: 'owner' as const }, ...list] : list;
  }, [query, members]);

  const open = focused && query !== null && suggestions.length > 0;

  function pick(name: string) {
    // 끝의 @쿼리를 @이름 + 공백으로 치환(@전체는 그대로 토큰명).
    const next = value.replace(/@([^\s@]*)$/, `@${name} `);
    onChangeText(next);
  }

  // 키 입력 — 자동완성 떠 있을 때 Tab/Enter는 맨 위 후보로 완성(카톡식). 웹 위주.
  function handleKeyPress(e: { nativeEvent: { key: string }; preventDefault?: () => void }) {
    if (!open) return;
    const k = e.nativeEvent?.key;
    if (k === 'Tab' || (k === 'Enter' && query)) {
      e.preventDefault?.();
      pick(suggestions[0].name);
    }
  }

  // 입력창 라이브 강조용 토큰 분해(웹 오버레이). @이름/@전체를 파란 span으로.
  const parts = useMemo(() => splitMentions(value, members), [value, members]);
  const hasMention = parts.some((p) => p.m);
  const webOverlay = Platform.OS === 'web' && hasMention;

  return (
    <View style={s.wrap}>
      {open && (
        <View style={s.pop}>
          <Text style={s.popHead}>멤버 멘션 — 누르거나 Tab으로 완성, 태그하면 알림이 가요</Text>
          {suggestions.slice(0, 5).map((m, i) => (
            <Pressable key={m.id} onPress={() => pick(m.name)} style={({ pressed }) => [s.row, i === 0 && s.rowTop, pressed && { backgroundColor: InkColors.paper }]}>
              <View style={[s.av, m.id === '__all__' && { backgroundColor: BrandColors.yellowSoft }]}>
                <Text style={s.avTx}>{m.id === '__all__' ? '@' : m.name.slice(-2)}</Text>
              </View>
              <Text style={s.name}>{m.id === '__all__' ? '@전체' : m.name}</Text>
              {i === 0 && <Text style={s.tabHint}>Tab</Text>}
              <Text style={s.role}>{m.id === '__all__' ? '모두에게' : m.role === 'owner' ? '사장' : '알바'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={s.field}>
        {/* 웹: 멘션이 있으면 TextInput 글자를 투명 처리하고 같은 자리에 색입힌 텍스트를 겹쳐 그린다. */}
        {webOverlay && (
          <Text style={[s.input, s.overlay, style]} numberOfLines={1} pointerEvents="none">
            {parts.map((p, i) => (p.m ? <Text key={i} style={s.mentionTok}>{p.t}</Text> : <Text key={i}>{p.t}</Text>))}
          </Text>
        )}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyPress={handleKeyPress as any}
          placeholder={placeholder}
          placeholderTextColor={InkColors.ink3}
          style={[s.input, style, webOverlay && (s.inputTransparent as object)]}
          onSubmitEditing={onSubmit}
          returnKeyType="send"
          blurOnSubmit={false}
        />
      </View>
    </View>
  );
}

/** 텍스트를 @멘션 토큰/일반 텍스트 조각으로 분해(렌더용). '긴 이름 우선' 매칭. */
function splitMentions(text: string, members: Member[]): { t: string; m: boolean }[] {
  const names = [...members.map((mm) => mm.name), ALL_TOKEN].sort((a, b) => b.length - a.length);
  if (!text || names.length === 0) return [{ t: text, m: false }];
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${esc.join('|')})`, 'g');
  const out: { t: string; m: boolean }[] = [];
  let last = 0;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(text))) {
    if (mt.index > last) out.push({ t: text.slice(last, mt.index), m: false });
    out.push({ t: mt[0], m: true });
    last = mt.index + mt[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), m: false });
  return out.length ? out : [{ t: text, m: false }];
}

const s = StyleSheet.create({
  wrap: { flex: 1, position: 'relative' },
  field: { flex: 1, position: 'relative', justifyContent: 'center' },
  input: {
    flex: 1,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 14,
    color: InkColors.ink,
  },
  // 웹 오버레이 — 아래층에서 박스(s.input의 배경·테두리)와 색입힌 글자를 그린다.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    color: InkColors.ink,
    zIndex: 1,
  },
  // 위층 입력창은 투명(배경·테두리·글자 모두) + caret만 보이게. 아래 오버레이가 비쳐 보인다.
  inputTransparent: ({ color: 'transparent', caretColor: InkColors.ink, backgroundColor: 'transparent', borderColor: 'transparent', zIndex: 2 } as unknown) as object,
  mentionTok: { color: '#2f6fd6', fontWeight: '800' },
  pop: {
    position: 'absolute',
    bottom: '110%',
    left: 0,
    right: 0,
    backgroundColor: InkColors.bg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    padding: 6,
    ...Elevation.e3,
  },
  popHead: { fontSize: 10.5, fontWeight: '800', color: InkColors.ink3, paddingHorizontal: 9, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: Radius.sm },
  rowTop: { backgroundColor: InkColors.paper },
  av: { width: 29, height: 29, borderRadius: 99, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  avTx: { fontSize: 11, fontWeight: '800', color: InkColors.ink2 },
  name: { fontSize: 13, fontWeight: '700', color: InkColors.ink },
  tabHint: { fontSize: 9.5, fontWeight: '800', color: InkColors.ink3, borderWidth: 1, borderColor: InkColors.line, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  role: { marginLeft: 'auto', fontSize: 10, fontWeight: '700', color: InkColors.ink3 },
});
