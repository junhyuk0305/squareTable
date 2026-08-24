// lib/media/pickImage.ts — 네이티브 사진 선택(expo-image-picker). 웹은 pickImage.web.ts(no-op).
// 웹의 사진 선택은 coachUtils.ts 의 pickImageWeb(DOM input) 이 담당 — 반환 모양이 완전히 달라(File
// vs 로컬 uri) 한 함수로 합칠 수 없다. 업로드도 db.ts 의 uploadPhoto(File) ↔ uploadPhotoNative(uri) 로 나뉜다.
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export type PickedNativeImage = { uri: string; mimeType?: string | null; fileName?: string | null };

export const IMAGE_PICK_SUPPORTED = true;

// db.ts 의 compressImage(웹)와 같은 문턱값 — 긴 변 1600px + 재인코딩. db.ts 는 canvas/document 를 써서
// 웹 전용이라 못 재사용한다(그 파일에 네이티브 모듈을 넣으면 웹 번들이 오염된다 — platform.md).
// 그래서 압축은 "선택 직후, 아직 네이티브 전용 파일 안"인 여기서 한다 — uploadPhotoNative(db.ts)는
// 압축된 결과를 그냥 업로드만 한다.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
const SKIP_BELOW_BYTES = 300_000; // 이미 충분히 작으면 재인코딩 이득<비용 → 스킵

async function compressAsset(a: ImagePicker.ImagePickerAsset): Promise<PickedNativeImage> {
  // GIF 는 재인코딩하면 애니메이션이 죽는다(웹의 compressImage 와 동일 이유) — 원본 그대로.
  if (a.mimeType === 'image/gif') return { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName };
  if ((a.fileSize ?? 0) > 0 && (a.fileSize as number) < SKIP_BELOW_BYTES) {
    return { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName };
  }
  try {
    const scale = a.width > 0 && a.height > 0 ? Math.min(1, MAX_DIMENSION / Math.max(a.width, a.height)) : 1;
    const actions: ImageManipulator.Action[] = scale < 1 ? [{ resize: { width: Math.round(a.width * scale) } }] : [];
    const result = await ImageManipulator.manipulateAsync(a.uri, actions, {
      compress: JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: result.uri, mimeType: 'image/jpeg', fileName: a.fileName };
  } catch {
    return { uri: a.uri, mimeType: a.mimeType, fileName: a.fileName }; // 실패해도 업로드는 막지 않는다(원본 통과)
  }
}

/** 갤러리에서 사진을 선택(취소·권한거부는 빈 배열 — 호출부가 별도 안내). multiple=true 면 여러 장.
 *  각 장을 업로드 전에 압축한다(웹의 compressImage 와 같은 문턱값). */
export async function pickImagesNative(opts?: {
  multiple?: boolean;
  limit?: number;
}): Promise<PickedNativeImage[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: !!opts?.multiple,
    selectionLimit: opts?.multiple ? (opts.limit ?? 0) : 1, // 0 = OS 기본 상한
  });
  if (result.canceled) return [];
  return Promise.all(result.assets.map(compressAsset));
}

/** 갤러리에서 사진 1장 선택. 취소하면 null. */
export async function pickImageNative(): Promise<PickedNativeImage | null> {
  const [a] = await pickImagesNative();
  return a ?? null;
}
