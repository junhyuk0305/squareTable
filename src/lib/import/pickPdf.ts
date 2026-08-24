// lib/import/pickPdf.ts — 네이티브 기본판(모듈 통째 분기: pickPdf.web.ts 가 웹판).
// expo-document-picker 로 선택 → expo-file-system(legacy)으로 base64 읽기.
// document-picker 는 네이티브에서 base64 옵션을 안 주므로(웹 전용 옵션) 직접 읽어야 한다.
// 플랫폼 예외표: 00_핵심/플랫폼_배포현황_LIVE.md §2
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

export type PickedPdf = { base64: string; name: string; size: number };

export const PDF_PICK_SUPPORTED = true;

export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  try {
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // asset.size 가 없을 때만 base64 길이에서 역산(base64 는 원본보다 ~4/3배 커진다).
    const size = asset.size ?? Math.round((base64.length * 3) / 4);
    return { base64, name: asset.name, size };
  } catch {
    return null;
  }
}
