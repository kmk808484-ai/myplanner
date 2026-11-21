# 🧠 Second Brain OS — Multi-AI

기존 `Second brain v4.html`의 탐색기형 지식 관리 컨셉을 유지하면서, **GitHub Pages(외부 도메인 포함)**에 올려 바로 사용할 수 있고 **Grok · Gemini · Anthropic(Claude) · OpenAI(GPT)** API를 실시간으로 선택 호출해 대화할 수 있는 웹 앱입니다.

## ✨ 주요 기능

1. **탐색기형 세컨드 브레인**
   - 좌측 폴더 트리, 중앙 파일/메모 그리드, 우측 상세/AI 패널 (크기 자유 조절)
   - 드래그 앤 드롭 폴더 이동, `.md` / `.txt` / 코드 파일 드롭 시 본문 자동 읽기
   - 단축키 지원: `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+Z`(실행 취소 30단계), `Delete`, `Ctrl+K`(통합 검색), `Ctrl+S`(편집 저장)
   - 마크다운 미리보기 & 라이트/다크 모드 지원

2. **4대 AI API 선택 호출 (대화 중 실시간 모델 전환 가능)**
   - ✨ **Google Gemini** (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash` + 커스텀 모델명)
   - 🟢 **OpenAI** (`gpt-4o`, `gpt-4o-mini`, `o3-mini` + 커스텀 모델명)
   - 🟠 **Anthropic Claude** (`claude-sonnet-4-20250514`, `claude-3-7-sonnet-latest`, `claude-3-5-haiku-latest` + 커스텀 모델명)
   - ⚡ **xAI Grok** (`grok-3`, `grok-3-mini`, `grok-2-latest` + 커스텀 모델명)

3. **세컨드 브레인 × AI 연동**
   - `📎 현재 메모` / `📂 현재 폴더` 버튼으로 내 메모를 AI 컨텍스트에 즉시 첨부
   - AI 답변을 클릭 한 번으로 `💾 메모로 저장`하여 현재 폴더에 보관
   - `✨ AI 자동 요약`으로 선택한 메모를 핵심 정리

4. **보안 및 데이터 백업**
   - 모든 API 키는 **현재 브라우저의 `localStorage`에만 저장**되며 코드나 GitHub 저장소에 절대 포함되지 않습니다.
   - `⚙️ API 설정`에서 JSON 백업/복원으로 다른 기기와 데이터를 옮길 수 있습니다.

---

## 🚀 GitHub Pages 배포 방법

별도의 빌드 과정(Node.js 등) 없이 정적 파일 그대로 배포됩니다.

1. GitHub에서 새 저장소(Repository)를 생성합니다. (예: `second-brain`)
2. 이 폴더(`second-brain-web`) 안의 모든 파일을 저장소 루트에 업로드(push)합니다.
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Second Brain OS Multi-AI"
   git branch -M main
   git remote add origin https://github.com/<본인아이디>/<저장소이름>.git
   git push -u origin main
   ```
3. GitHub 저장소 페이지에서 **Settings → Pages**로 이동합니다.
4. **Build and deployment → Source**를 `Deploy from a branch`로 선택하고, Branch를 `main` / `/ (root)`로 저장합니다.
5. 1~2분 후 `https://<본인아이디>.github.io/<저장소이름>/` 주소로 접속할 수 있습니다.

---

## 🌐 외부 커스텀 도메인 연결 방법

개인 도메인(예: `brain.mydomain.com`)을 연결하려면:

1. **도메인 등록업체(Cloudflare, 가비아, Namecheap 등) DNS 설정**
   - **서브도메인(예: `brain.mydomain.com`) 사용 시**:
     - Type: `CNAME`
     - Name(Host): `brain`
     - Value(Target): `<본인아이디>.github.io`
   - **루트 도메인(예: `mydomain.com`) 사용 시**:
     - Type: `A` 레코드 4개 추가:
       - `185.199.108.153`
       - `185.199.109.153`
       - `185.199.110.153`
       - `185.199.111.153`
2. **GitHub 저장소 → Settings → Pages → Custom domain**에 연결할 도메인을 입력하고 **Save**를 누릅니다.
3. DNS 전파가 완료되면 **Enforce HTTPS**를 체크합니다.

---

## ⚠️ 참고 사항 (브라우저 직접 호출)

- **Anthropic(Claude)**는 브라우저 직접 호출용 공식 헤더(`anthropic-dangerous-direct-browser-access: true`)를 포함해 동작합니다.
- **xAI(Grok), OpenAI, Gemini** 모두 브라우저 `fetch`로 직접 호출됩니다.
- 혹시 API 제공자 측 CORS 정책이나 사내 방화벽으로 특정 API가 차단되는 환경이라면, Cloudflare Workers 같은 가벼운 프록시를 앞단에 두는 방식으로 확장할 수 있습니다.
