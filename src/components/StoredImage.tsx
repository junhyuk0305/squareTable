import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolvePhotoUri } from '@/lib/db';
import { HEADER_EDGE_GUTTER, modalFrameStyle, Space } from '@/lib/theme/layout';

// 비공개 버킷 사진 전용 표시 컴포넌트.
// DB엔 '오브젝트 경로'(신규) 또는 레거시 공개URL이 저장돼 있고, 표시 직전에
// resolvePhotoUri 로 단기 서명URL을 발급받아 렌더한다(공개읽기 제거 후에도 본인 매장 사진만 열림).
// 해석 전에는 자리를 지키는 스켈레톤을 그려 레이아웃 점프를 막는다.
//
// 뷰어(PhotoViewerModal)를 같은 파일에 두는 이유: StoredImage(viewOnPress)↔뷰어가 서로를
// 쓰므로 파일을 나누면 순환 import — 사진 표시/열람의 SSOT를 이 모듈 하나로 유지한다.

/** stored(경로|레거시URL) → 단기 서명URL. stored 가 바뀌면 자동으로 스켈레톤 상태로 복귀. */
function useStoredPhotoUri(stored?: string | null) {
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
  return resolved && resolved.src === key ? resolved.uri : null;
}

type Props = {
  stored?: string | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'center' | 'stretch';
  viewOnPress?: boolean; // 탭하면 인앱 사진 뷰어(검정 배경 모달)로 크게 보기
  /** @deprecated 뷰어 도입 전 동작(새 탭/외부로 원본 열기). 남은 사용처가 viewOnPress 로 옮겨지면 제거. */
  openOnPress?: boolean;
  accessibilityLabel?: string;
};

export function StoredImage({ stored, style, resizeMode, viewOnPress, openOnPress, accessibilityLabel }: Props) {
  const uri = useStoredPhotoUri(stored);
  const [viewerOpen, setViewerOpen] = useState(false);
  if (!uri) return <View style={[style as StyleProp<ViewStyle>, { backgroundColor: 'rgba(0,0,0,0.05)' }]} />;
  const img = <Image source={{ uri }} style={style} resizeMode={resizeMode} />;
  if (openOnPress && !viewOnPress) {
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
  if (!viewOnPress) return img;
  return (
    <>
      <Pressable
        onPress={() => setViewerOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={accessibilityLabel ?? '사진 크게 보기'}
      >
        {img}
      </Pressable>
      {viewerOpen && <PhotoViewerModal stored={stored} onClose={() => setViewerOpen(false)} />}
    </>
  );
}

/**
 * 인앱 사진 뷰어 — 카톡/iOS 사진 뷰어 문법(검정 배경 + 이미지 contain 중앙 + 상단 닫기/원본 + 배경 탭 닫기).
 * RN Modal 은 프레임(ResponsiveShell) 밖으로 렌더되므로 검정 배경까지 modalFrameStyle 로 프레임 안에 가둔다.
 */
export function PhotoViewerModal({ stored, onClose }: { stored?: string | null; onClose: () => void }) {
  const uri = useStoredPhotoUri(stored);
  const openOriginal = () => {
    if (!uri) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(uri, '_blank');
    else void Linking.openURL(uri);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[modalFrameStyle, vs.frame]}>
        <View style={vs.topBar}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {uri && (
            <Pressable onPress={openOriginal} hitSlop={8} accessibilityRole="button" accessibilityLabel="원본 열기">
              <Ionicons name="open-outline" size={22} color="#fff" />
            </Pressable>
          )}
        </View>
        {/* 이미지 영역 — 카톡처럼 사진 바깥(배경) 탭으로도 닫힌다. */}
        <Pressable style={vs.body} onPress={onClose} accessibilityLabel="사진 닫기">
          {uri ? (
            <Image source={{ uri }} style={vs.image} resizeMode="contain" />
          ) : (
            <ActivityIndicator color="#fff" />
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const vs = StyleSheet.create({
  frame: { backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HEADER_EDGE_GUTTER,
    paddingVertical: Space.md,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
