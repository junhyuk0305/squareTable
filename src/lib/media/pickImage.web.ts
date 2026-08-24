// lib/media/pickImage.web.ts — 웹 no-op. 웹 사진 선택은 coachUtils.ts 의 pickImageWeb 이 담당한다.
// 여기는 expo-image-picker 를 웹 번들에 정적 import 하지 않기 위한 자리(platform.md).
export type PickedNativeImage = { uri: string; mimeType?: string | null; fileName?: string | null };

export const IMAGE_PICK_SUPPORTED = false;

export async function pickImagesNative(_opts?: {
  multiple?: boolean;
  limit?: number;
}): Promise<PickedNativeImage[]> {
  return [];
}

export async function pickImageNative(): Promise<PickedNativeImage | null> {
  return null;
}
