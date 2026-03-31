# [프로젝트] 키즈노트 전용 프리미엄 뷰어 (KAV) 개발 플랜

> 📅 최종 업데이트: 2026-03-31 | ✅ **Phase 1~3 완료**

## 1. 개요
기존 키즈노트 백업 데이터를 사용자가 웹 브라우저를 통해 실제 키즈노트 앱처럼 미려하게 감상할 수 있는 **'단독 실행형 프리미엄 뷰어'**를 제작합니다.
단순 HTML 방식의 한계(보안 정책으로 인한 이미지 차단, 대용량 시 속도 저하)를 극복하기 위해 **Node.js/Express 미니 서버** 방식을 채택합니다.

---

## 2. 주요 개선 및 기능

### 📂 P1. 자료 구조 체계화 및 자동 마이그레이션 ✅
- **구조 변경**: `downloads/알림장/[날짜-제목-ID]` → `downloads/알림장/YYYY/MM/[날짜-제목-ID]`
- **자동 이동**: 백업 실행 시 기존의 평면적인 폴더들을 연도/월별 폴더로 자동 분류 및 이동.
- **구버전 호환**: 서버가 평면 구조와 계층 구조를 동시에 인식 가능.

### 📊 P2. 생활기록 메타데이터 수집 강화 ✅
- **상세 데이터 추출**: 기분, 건강, 체격, 식사, 수면, 배변 정보를 API에서 다중 필드명으로 추출.
- **구조화된 저장**: 각 포스트 폴더 내에 `metadata.json` 파일 생성 (ID, title, date, author, content, photos, videos, comments, lifeRecord).
- **댓글 구조화**: 댓글을 author/role/date/content 형식으로 metadata.json에 저장.

### 🚀 P3. Express 기반 로컬 뷰어 서버 ✅
- **보안 해결**: `localhost` 서버로 브라우저의 로컬 파일 접근 제한(CORS/file://) 원천 해결.
- **REST API**: `/api/reports`, `/api/albums`, `/api/item`, `/api/stats` 엔드포인트 제공.
- **자동 복구**: 포트 충돌 시 기존 프로세스를 자동 정리 후 재시작.
- **Node.js v24 호환**: Express 5.x `/{*splat}` 라우트 문법 적용.

### 🎨 P4. 프리미엄 UI/UX (라이트 & 다크 모드) ✅
- **듀얼 테마**: Coral+Teal 팔레트, CSS Variables 기반, localStorage 저장.
- **4열 카드 그리드**: 썸네일 이미지, 배지(📷영상💬댓글📊생활기록), 발췌문.
- **이미지 라이트박스**: 클릭 시 전체화면 뷰, 키보드 화살표/ESC 지원.
- **생활기록 테이블**: 기분/건강/식사/수면/배변을 컬러 카드로 시각화.
- **Lazy Loading**: IntersectionObserver 기반 이미지 지연 로딩.
- **월별 필터**: API 통계 기반 월별 chip 자동 생성.

---

## 3. 기술 스택
- **Backend**: Node.js v24+, Express.js 5.x (포트 충돌 자동 해결, REST API, 정적 서빙)
- **Frontend**: Vanilla JS (ES6+), Modern CSS (CSS Variables, Grid, IntersectionObserver)
- **Launcher**: `알림장보기.bat` (Node.js 확인 → Express 자동 설치 → 서버 구동 → 브라우저 실행)

---

## 4. 단계별 작업 목록

### Phase 1: 기반 인프라 및 데이터 구조 재편 ✅ 완료
- [x] `downloader.js` 수정: `migrateToHierarchy()` - 기존 평면 폴더 → YYYY/MM 계층 자동 이동.
- [x] `downloader.js` 수정: `getTargetDir()` - 신규 항목을 YYYY/MM 경로에 저장.
- [x] `downloader.js` 수정: `findFolderById()` - YYYY/MM 계층 구조에서 ID 검색.
- [x] `scraper.js` 수정: `extractLifeRecordMetadata()` - 기분/건강/식사/수면/배변/체온/투약 추출.
- [x] `index.js` 수정: `migrateToHierarchy()` 백업 시작 시 자동 실행.
- [x] `index.js` 수정: `processItem()` 내 `metadata.json` 생성 (lifeRecord 포함, 댓글 구조화).
- [x] `index.js` 수정: `getTargetDir()` 기반 YYYY/MM 폴더 저장 구조 적용.

### Phase 2: 로컬 서버 및 런처 개발 ✅ 완료
- [x] `express` 패키지 설치 (`npm install express --save`).
- [x] `system/viewer/server.js` 신규 생성: REST API 4종 + 정적 파일 서빙.
- [x] 포트 충돌 자동 해결 (`netstat` → `taskkill`) 로직 구현.
- [x] YYYY/MM 계층 + 구버전 평면 구조 동시 스캔 지원.
- [x] `알림장보기.bat` 작성 (Node.js 확인, express 자동 설치, 브라우저 자동 열기).

### Phase 3: 뷰어 프론트엔드 제작 ✅ 완료
- [x] `system/viewer/public/index.html` 개발 (시맨틱 HTML, 접근성, 모달/라이트박스).
- [x] `system/viewer/public/assets/style.css` - CSS Variables 듀얼 테마, 애니메이션, 반응형.
- [x] `system/viewer/public/assets/app.js` - 카드 목록, 무한 스크롤, 라이트박스, 생활기록 렌더링.
- [x] 라이트/다크 모드 토글 + localStorage 유지.
- [x] IntersectionObserver 기반 Lazy Loading + staggered 입장 애니메이션.
- [x] 상세 모달: 사진 갤러리, 영상 플레이어, 생활기록 카드, 댓글 목록.
- [x] 키보드 단축키 (ESC, ←/→) 라이트박스 지원.

### Phase 4: 검증 및 고도화
- [ ] 인쇄 화면 최적화 (`@media print` 적용 완료, 추가 스타일 고도화).
- [ ] 월별 캘린더 뷰 (보너스 기능).
- [ ] 대용량 자료 로딩 속도 최종 점검.

---

## 5. 단계별 검증 결과
| 검증 항목 | 결과 |
|-----------|------|
| 마이그레이션 | ✅ `migrateToHierarchy()` 구현, 기존 18개 자료 인식 정상 |
| 데이터 | ✅ `metadata.json` 생성 로직 완료 (다음 백업 시 적용) |
| 접근성 | ✅ 브라우저에서 모든 사진 정상 출력 확인 (localhost:3456) |
| 테마 | ✅ 라이트/다크 전환 실제 스크린샷으로 확인 |

---

## 6. 변경 파일 목록
| 파일 | 작업 | 상태 |
|------|------|------|
| `system/src/downloader.js` | YYYY/MM 구조 + 마이그레이션 로직 | ✅ |
| `system/src/scraper.js` | 생활기록 메타 추출 메서드 추가 | ✅ |
| `system/src/index.js` | 마이그레이션 자동 실행 + metadata.json 저장 | ✅ |
| `system/package.json` | express 의존성 추가 | ✅ |
| `system/viewer/server.js` | Express API 서버 (신규) | ✅ |
| `system/viewer/public/index.html` | 프론트엔드 메인 페이지 (신규) | ✅ |
| `system/viewer/public/assets/style.css` | 듀얼 테마 CSS 디자인 시스템 (신규) | ✅ |
| `system/viewer/public/assets/app.js` | 프론트엔드 앱 로직 (신규) | ✅ |
| `알림장보기.bat` | 원클릭 런처 (신규) | ✅ |

---

## 7. 사용 방법
```
알림장보기.bat 더블클릭 → 브라우저 자동 열림 → http://localhost:3456
```
