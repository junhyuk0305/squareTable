import { Redirect } from 'expo-router';

// '내 노하우'(전체 목록)는 노하우 탭의 '둘러보기'로 통합됐다.
// 홈·설정·코치 저장 등 기존 진입점 링크가 깨지지 않도록 둘러보기(=categories)로 리다이렉트한다.
export default function OwnerKnowledgeRedirect() {
  return <Redirect href="/owner/categories" />;
}
