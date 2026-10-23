// 접속 대상 가드 — .env·.env.seed 파일 값을 셸 env 보다 먼저 쓰는 스크립트용. 규칙·이유 = local-target-guard.mjs 머리말.
// 사용: 스크립트 맨 위 import 줄에 `import './lib/require-local-target-files.mjs';` 한 줄. 라이브는 --allow-remote.
import { guardLocalTarget } from './local-target-guard.mjs';

guardLocalTarget({ filesFirst: true });
