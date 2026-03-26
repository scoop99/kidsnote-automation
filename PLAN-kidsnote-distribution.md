# PLAN-kidsnote-distribution.md

## Overview
키즈노트 자동화 툴을 비전문가("컴맹") 사용자들이 쉽게 설치하고, 사이트 구조 변경 시 자동으로 업데이트된 로직을 적용받을 수 있도록 하는 배포 및 관리 전략입니다.

## 관리자 vs 사용자 역할 및 계정 (중요!)

이 시스템은 '관리자(본인)'와 '실제 사용자(지인)'의 역할을 구분합니다.

| 구분 | 역할 | 계정 필요 여부 |
| :--- | :--- | :--- |
| **관리자 (본인)** | 코드 수정, 업데이트 버전 배포(Upload), 이슈 관리 | **GitHub 계정 필요** (무료) |
| **사용자 (지인)** | 프로그램 다운로드, 실행, 자동 업데이트 받기 | **계정 불필요** (그냥 다운로드만 함) |

> [!NOTE]
> - 관리자만 GitHub 계정을 가지고 있으면 됩니다.
> - 사용자는 GitHub에 접속할 필요도 없으며, 프로그램이 내부적으로 관리자의 GitHub에서 최신 파일을 알아서 가져옵니다.

## Proposed Changes

### 1. 배포 패키지 구조 (ZIP)
사용자에게 제공될 압축 파일의 구조입니다. 사용자는 압축을 풀고 `[여기를_더블클릭하세요].bat`만 실행하면 됩니다.

#### [NEW] `launcher.bat` (Root)
- 실행 시 먼저 `updater.js`를 호출하여 최신 코드를 체크합니다.
- 업데이트가 완료되면 `index.js`를 실행합니다.

#### [NEW] `system/src/updater.js`
- GitHub API (`/releases/latest`)를 호출하여 현재 버전(`package.json`)과 비교합니다.
- 새 버전이 있으면 최신 소스 코드(ZIP)를 다운로드하여 `system/` 폴더 내의 파일을 교체합니다.

### 2. 자동 세션 및 로그인 관리
- `index.js` 실행 시 `session.json`이 없거나 로그인이 만료된 경우:
    - `headless: false` 모드로 브라우저를 자동 실행합니다.
    - 사용자가 직접 로그인하면 세션을 가로채서 `session.json`에 저장하고 브라우저를 닫습니다.
    - 이후 작업은 다시 백그라운드(`headless: true`)에서 진행됩니다.

### 3. 기술 스택
- **Distribution:** GitHub Releases
- **Update Logic:** Node.js `https` module + `adm-zip` (최소 의존성)
- **Runtime:** Windows Winget (Node.js 자동 설치 지원) 또는 Portable Node

## Task Breakdown

### Phase 1: 자동 업데이트 시스템 구축
- [ ] **Task 1: `package.json` 버전 관리 설정**
    - `agent`: `backend-specialist`
    - `INPUT`: 현재 코드
    - `OUTPUT`: `version` 필드가 포함된 `package.json`
- [ ] **Task 2: `updater.js` 구현**
    - `agent`: `backend-specialist`
    - `skills`: `api-patterns`, `nodejs-best-practices`
    - `VERIFY`: 가상의 로컬 서버에서 새 버전을 내려받는지 테스트
- [ ] **Task 3: `launcher.bat` 통합**
    - `agent`: `orchestrator`
    - `VERIFY`: 배치를 실행했을 때 업데이트 -> 실행 흐름 확인

### Phase 2: 세션 관리 및 사용자 경험 최적화
- [ ] **Task 1: 자동 로그인 브라우저 팝업 로직 개선**
    - `agent`: `frontend-specialist`
    - `INPUT`: `src/downloader.js` 또는 `src/index.js`
    - `OUTPUT`: 세션 만료 시 브라우저 자동 호출 로직
- [ ] **Task 2: 배포용 ZIP 생성 스크립트 작성**
    - `agent`: `devops-engineer`
    - `OUTPUT`: `build-dist.js` (필요한 파일만 추려 ZIP으로 압축)

## Verification Plan

### Automated Tests
- `node system/src/updater.js --test`: 업데이트 서버(GitHub) 연결 및 버전 비교 로직 검증.
- `npm run test:session`: 세션 유효성 검사 및 자동 브라우저 팝업 트리거 테스트.

### Manual Verification
- **업데이트 테스트:** `package.json` 버전을 낮게 설정하고 프로그램을 실행했을 때, GitHub의 최신 코드로 파일이 교체되는지 확인.
- **최초 실행 테스트:** 깨끗한 환경(세션 없음)에서 실행 시 브라우저가 뜨고, 로그인을 완료하면 자동으로 닫히는지 확인.
