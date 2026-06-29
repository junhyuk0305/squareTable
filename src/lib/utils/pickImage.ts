import { Platform } from 'react-native';

/** 웹 파일 선택 → object URL (저장·표시용, AI 해석 없음). 네이티브는 추후 image-picker. */
export function pickImage(onPick: (uri: string) => void) {
  if (Platform.OS !== 'web') return;
  const g = globalThis as any;
  const doc = g.document;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file && g.URL?.createObjectURL) onPick(g.URL.createObjectURL(file));
  };
  input.click();
}
