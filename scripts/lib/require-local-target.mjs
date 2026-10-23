// 접속 대상 가드 — 셸 env 를 먼저 읽는 스크립트용. 규칙·이유 = local-target-guard.mjs 머리말.
// 사용: 스크립트 맨 위 import 줄에 `import './lib/require-local-target.mjs';` 한 줄. 라이브는 --allow-remote.
import { guardLocalTarget } from './local-target-guard.mjs';

guardLocalTarget({ filesFirst: false });
