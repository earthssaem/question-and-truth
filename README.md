# 질문과 진실

마주 앉은 두 플레이어를 위한 실시간 보조 웹게임입니다. 앱은 질문을 만들거나 기록하지 않으며, 비밀 카드와 베팅, 칩, 행동권, TRUTH 판정만 관리합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

Firebase 환경변수가 없으면 한 브라우저에서 전체 라운드 흐름을 확인할 수 있는 데모 모드로 실행됩니다.

## Firebase 연결

1. Firebase 프로젝트에서 익명 인증과 Cloud Firestore를 활성화합니다.
2. `.env.example`을 참고해 `.env.local`에 웹 앱 설정을 입력합니다.
3. Firebase CLI로 로그인한 뒤 프로젝트를 연결합니다.
4. Functions, Firestore Rules, Hosting을 배포합니다.

```bash
cd functions
npm install
npm run build
cd ..
firebase use --add
firebase deploy
```

비밀 카드, 정확한 칩 수, 현재 베팅은 플레이어별 private 문서에 저장됩니다. 다른 플레이어의 private 문서는 Security Rules로 읽을 수 없습니다. 공개 room 문서에는 닉네임, 준비/제출 상태, 5칩 이하 경고 여부처럼 상대에게 보여도 되는 정보만 저장합니다.

베팅 비교와 칩 차감, 동점 처리, QUESTION/TRUTH 이후 라운드 정산은 callable Cloud Functions의 transaction에서 처리합니다. TRUTH 성공을 제외한 라운드 종료에서는 양쪽에 2칩을 한 번만 지급하고 즉시 다음 라운드로 이동합니다.

## 검증

```bash
npm test
npm run build
cd functions && npm run build
```
