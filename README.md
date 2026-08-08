# 질문과 진실

마주 앉은 두 플레이어를 위한 실시간 보조 웹게임입니다. 앱은 질문을 만들거나 기록하지 않으며, 비밀 카드와 베팅, 칩, 행동 순서, TRUTH 판정만 관리합니다.

## 구조

- React/Vite: 기존 게임 UI
- Firebase Web SDK: 익명 인증, Firestore 실시간 구독
- Vercel Function `POST /api/game`: ID 토큰 검증과 신뢰 서버 작업
- Firebase Admin SDK: transaction을 통한 베팅, 정산, QUESTION/TRUTH 처리
- Firestore Rules: 방 참여자의 공개 상태 및 본인 private 문서만 읽기 허용

Firebase Cloud Functions와 Firebase Hosting은 사용하지 않습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

Firebase 환경 변수가 없으면 한 브라우저에서 전체 라운드 흐름을 확인할 수 있는 데모 모드로 실행됩니다. 실제 온라인 API까지 로컬에서 확인하려면 Vercel CLI의 `vercel dev`를 사용하고 아래 환경 변수를 설정합니다.

## 환경 변수

브라우저에서 사용하는 Firebase Web Config:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Vercel Function에서만 사용하는 서버 비밀값:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

실제 값은 GitHub에 커밋하지 않습니다. 로컬 값은 `.env.local`, 배포 값은 Vercel 프로젝트의 Settings > Environment Variables에 등록합니다. 서버 비밀값에는 절대로 `VITE_` 접두사를 붙이지 않습니다.

## Firebase Admin 설정

1. Firebase Console의 프로젝트 설정 > 서비스 계정으로 이동합니다.
2. 새 비공개 키를 생성해 JSON 파일을 내려받습니다.
3. JSON의 `project_id`, `client_email`, `private_key`를 각각 위의 서버 환경 변수에 등록합니다.
4. JSON 파일은 프로젝트 폴더에 두거나 GitHub에 올리지 않습니다.
5. Vercel 환경 변수를 저장한 뒤 새 배포를 실행합니다.

`FIREBASE_PRIVATE_KEY`는 여러 줄 그대로 등록하거나 줄바꿈을 `\n`으로 이스케이프해 등록할 수 있습니다.

## Firestore Rules 배포

Firebase CLI에서 Google 계정 로그인이 필요한 단계입니다. 저장소 루트에서 다음 명령을 직접 실행합니다.

```bash
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

배포 대상 프로젝트를 선택할 때 이 앱에 연결한 Firebase 프로젝트를 선택합니다. Cloud Functions 배포 명령은 실행하지 않습니다.

## 데이터 보호

공개 room 문서에는 닉네임, 준비/제출 상태, 경고등, 현재 단계와 결과만 저장합니다. 비밀 카드, 정확한 칩 수, 현재 베팅은 `rooms/{roomCode}/private/{uid}`에 저장되며 본인만 읽을 수 있습니다. 모든 클라이언트 쓰기는 거부되고, Vercel Function이 검증된 Firebase UID를 기준으로 transaction을 실행합니다.

## 검증

```bash
npm test
npm run lint
npm run build
```

Spark 무료 요금제를 유지하며 Firebase Cloud Functions, Firebase App Hosting, Blaze 업그레이드, Cloud Billing 연결은 필요하지 않습니다. Firestore와 Authentication의 Spark 무료 할당량은 Firebase Console에서 계속 확인해야 합니다.
