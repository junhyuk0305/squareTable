import { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, frameCapStyle } from '@/lib/theme/layout';

/**
 * 전역 안전망 — 하위 트리에서 던져진 렌더 예외를 잡아 앱 전체 화이트아웃을 막는다.
 * 한 화면의 버그가 전체 React 트리를 언마운트시키는 대신, 프레임 안에 폴백 + 재시도를 보여준다.
 * (React error boundary 는 클래스 컴포넌트로만 구현 가능 — 함수형 훅에는 대응 API 없음.)
 */
interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // 운영 관측용. 추후 원격 로깅(Sentry 등) 연결 지점.
    console.error('[ErrorBoundary]', error?.message ?? error);
  }

  private handleRetry = () => {
    // 웹은 새로고침이 가장 확실. 네이티브는 상태 리셋으로 재마운트 시도.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={frameCapStyle}>
          <View style={styles.card}>
            <Text style={styles.emoji}>😵‍💫</Text>
            <Text style={styles.title}>문제가 생겼어요</Text>
            <Text style={styles.body}>화면을 그리다 오류가 났어요.{'\n'}다시 시도하면 대부분 해결돼요.</Text>
            <Pressable
              onPress={this.handleRetry}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.btnText}>다시 시도</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: InkColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.gutter,
  },
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.xl,
    alignItems: 'center',
    gap: Space.md,
    ...Elevation.e2,
  },
  emoji: { fontSize: 40 },
  title: { fontSize: 18, fontWeight: '800', color: InkColors.ink },
  body: { fontSize: 14, color: InkColors.ink2, textAlign: 'center', lineHeight: 20 },
  btn: {
    marginTop: Space.xs,
    backgroundColor: BrandColors.brand,
    paddingVertical: 13,
    paddingHorizontal: Space.xl,
    borderRadius: Radius.md,
  },
  btnText: { color: InkColors.bubbleText, fontSize: 15, fontWeight: '800' },
});
