import { useEffect, useState } from 'react';
import { Image, View, Pressable, Platform, Linking } from 'react-native';
import type { StyleProp, ImageStyle, ViewStyle } from 'react-native';
import { resolvePhotoUri } from '@/lib/db';

// 비공개 버킷 사진 전용 표시 컴포넌트.
// DB엔 '오브젝트 경로'(신규) 또는 레거시 공개URL이 저장돼 있고, 이 컴포넌트가 표시 직전에
// resolvePhotoUri 로 단기 서명URL을 발급받아 렌더한다(공개읽기 제거 후에도 본인 매장 사진만 열림).
// 해석 전에는 자리를 지키는 스켈레톤을 그려 레이아웃 점프를 막는다.
type Props = {
  stored?: string | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'center' | 'stretch';
  openOnPress?: boolean; // 탭하면 원본을 새 탭/외부로 열기(채팅 사진 크게 보기)
  accessibilityLabel?: string;
};

export function StoredImage({ stored, style, resizeMode, openOnPress, accessibilityLabel }: Props) {
  // { src, uri } 로 묶어 저장 — stored 가 바뀌면 src 불일치로 자동 스켈레톤(동기 setState 없이).
  const [resolved, setResolved] = useState<{ src: string; uri: string | null } | null>(null);
  const key = stored ?? '';
  useEffect(() => {
    let alive = true;
    resolvePhotoUri(stored)
      .then((u) => { if (alive) setResolved({ src: key, uri: u }); })
      .catch(() => { if (alive) setResolved({ src: key, uri: null }); });
    return () => { alive = false; };
  }, [key, stored]);

  const uri = resolved && resolved.src === key ? resolved.uri : null;
  if (!uri) return <View style={[style as StyleProp<ViewStyle>, { backgroundColor: 'rgba(0,0,0,0.05)' }]} />;
  const img = <Image source={{ uri }} style={style} resizeMode={resizeMode} />;
  if (!openOnPress) return img;
  return (
    <Pressable
      onPress={() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(uri, '_blank');
        else void Linking.openURL(uri);
      }}
      accessibilityRole="imagebutton"
      accessibilityLabel={accessibilityLabel}
    >
      {img}
    </Pressable>
  );
}
