// 파괴적 동작 확인 — 웹은 window.confirm, 네이티브는 Alert. Promise<boolean> 반환.
import { Platform, Alert } from 'react-native';

export function confirmAction(title: string, message: string, confirmLabel = '확인'): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    // onDismiss: 안드로이드 뒤로가기/바깥 탭으로 닫으면 어느 버튼도 안 눌려
    // Promise가 영영 안 풀린다(호출부가 busy 상태로 영구 정지). '취소'로 안전하게 종료.
    Alert.alert(
      title,
      message,
      [
        { text: '취소', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
