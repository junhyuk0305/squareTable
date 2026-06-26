import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { WorkBoard } from '@/components/WorkBoard';
import { AttendancePanel } from '@/app/junior/attendance';
import { RoleTabBar } from '@/components/RoleTabBar';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';

type Seg = 'work' | 'attendance';

/**
 * 직원 '업무' 탭 — 출퇴근과 업무(할일·소통)를 한 화면으로 통합.
 * 상단 세그먼트로 [업무 | 출퇴근] 전환. 업무는 채팅 입력바가 바닥에 고정돼야 해서
 * WorkBoard를 embedded(크롬 없는 콘텐츠)로 받아 이 화면이 SafeArea·탭바를 소유한다.
 */
export default function JuniorWorkScreen() {
  const [seg, setSeg] = useState<Seg>('work');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: '업무',
          headerRight: () => (
            <Pressable onPress={() => void logout()} hitSlop={8} style={({ pressed }) => [{ paddingHorizontal: 8 }, pressed && { opacity: 0.6 }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: BrandColors.brand }}>로그아웃</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.segWrap}>
        <Segment label="업무" active={seg === 'work'} onPress={() => setSeg('work')} />
        <Segment label="출퇴근" active={seg === 'attendance'} onPress={() => setSeg('attendance')} />
      </View>

      {seg === 'work' ? <WorkBoard role="junior" embedded /> : <AttendancePanel />}

      <RoleTabBar role="junior" />
    </SafeAreaView>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.seg, active && styles.segOn]}>
      <Text style={[styles.segText, active && styles.segTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  segWrap: {
    flexDirection: 'row',
    gap: 4,
    margin: 16,
    marginBottom: 8,
    padding: 4,
    backgroundColor: InkColors.bgSoft,
    borderRadius: 12,
  },
  seg: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segOn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  segText: { fontSize: 14, fontWeight: '700', color: InkColors.ink3 },
  segTextOn: { color: InkColors.ink },
});
