// 파괴적 동작 확인 — 웹은 window.confirm, 네이티브는 Alert. Promise<boolean> 반환.
import { Platform, Alert } from 'react-native';

export function confirmAction(title: string, message: string, confirmLabel = '확인'): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
