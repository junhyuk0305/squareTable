import { Platform } from 'react-native';

export function formatRelative(iso: string): string {
  try {
    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    return d === 1 ? '어제' : `${d}일 전`;
  } catch {
    return '방금 전';
  }
}

/** 웹 파일 선택 → File. 네이티브는 추후 image-picker. */
export function pickImageWeb(onPick: (file: File) => void) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as any).document;
  if (!doc) return;
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}
