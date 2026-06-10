# 스퀘어테이블 (SquareTable)

현장 매장 운영 AI — 사장님의 노하우를 구조화해 알바·직원이 즉시 꺼내 쓰게 하는 B2B SaaS 데모.

- **알바(junior)** : 클린 AI 어시스턴트. 매장 노하우를 바로 검색, 없으면 사장님께 자동 라우팅.
- **사장(owner)** : 미답변 질문 인박스 → 음성 답변 → 노하우(플레이북) 자동 생성 → 직원·근태·급여 관리.

## 기술 스택

- Expo SDK 56 + Expo Router (file-based routing, typed routes)
- React Native 0.85 / React 19 / react-native-web
- Zustand (상태) · 로컬 RAG 모킹(`src/lib/rag.ts`) · mock AI 어댑터(`src/lib/ai`)
- 디자인 토큰: 웜 뉴트럴 모노크롬 + Pretendard

## 실행

```bash
npm install
npm run web      # 웹 우선 데모 (expo start --web)
# npm start      # iOS/Android 포함 dev 서버
```

웹이 기본 시연 타깃입니다. 좁은 화면에서는 풀폭, 넓은 화면에서는 모바일 폭으로 중앙 정렬됩니다(`ResponsiveShell`).

## 디렉터리 구조

```
src/
  app/                 # 화면 (expo-router)
    index.tsx          # 로그인
    signup.tsx         # 회원가입
    junior/            # 알바: chat · attendance · work
    owner/             # 사장: dashboard · inbox · answer · knowledge · staff · payroll · ...
  components/          # 재사용 UI (SquareCard, RoleTabBar, wizard/ 등)
  lib/
    ai/                # AI 어댑터 (mock / 실제 엔드포인트 분기)
    rag/ rag.ts        # 한국어 RAG 모킹 (키워드 + n-gram + 태그 가중 합산)
    store/             # Zustand 스토어
    theme/colors.ts    # 디자인 토큰 (단일 진실 공급원)
    utils/             # attendance · category · buildEntry · pickImage ...
  data/                # 시드 JSON (users, context-pack, playbook-entries, ...)
  types/               # 전 타입 단일 진입점
```

## AI 설정

기본은 mock 모드입니다(비용 0). 실제 엔드포인트를 쓰려면 `.env.example`를 복사해 `.env`로 두고 값을 채우세요.

```bash
cp .env.example .env
```

`src/lib/ai/config.ts`가 `AI_ENDPOINT` 유무로 mock/real을 자동 분기합니다.

---

팀 스퀘어테이블 · contact@team-roundtable.com
