const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

// 작업 디렉토리 설정
const SYSTEM_DIR = path.join(__dirname, '..');
const PKG_PATH = path.join(SYSTEM_DIR, 'package.json');
const CONFIG_PATH = path.join(SYSTEM_DIR, 'config.json');

async function checkAndUpdate() {
  try {
    // 1. 설정 및 패키지 정보 로드
    const pkg = await fs.readJson(PKG_PATH);
    const config = await fs.readJson(CONFIG_PATH).catch(() => ({}));

    const currentVersion = pkg.version || '0.0.0';
    const repo = config.github_repo; // 예: "owner/repo"

    if (!repo) {
      console.log('[UPDATER] GitHub 저장소 정보가 config.json에 설정되지 않아 건너뜁니다.');
      return;
    }

    console.log(`[UPDATER] 현재 버전: v${currentVersion} (저장소: ${repo})`);
    console.log('[UPDATER] 최신 버전 확인 중...');

    // 2. GitHub 최신 릴리스 정보 가져오기
    const res = await axios.get(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      timeout: 5000
    });

    const latestVersion = res.data.tag_name.replace(/^v/, '');
    const zipUrl = res.data.zipball_url;

    if (isNewerVersion(currentVersion, latestVersion)) {
      console.log(`[UPDATER] 새 버전 발견! (v${currentVersion} -> v${latestVersion})`);
      console.log('[UPDATER] 업데이트를 다운로드 중입니다...');

      const tmpZip = path.join(SYSTEM_DIR, 'update.zip');
      const response = await axios({
        method: 'get',
        url: zipUrl,
        responseType: 'arraybuffer'
      });

      await fs.writeFile(tmpZip, response.data);

      console.log('[UPDATER] 파일 압축 해제 및 교체 중...');
      const zip = new AdmZip(tmpZip);
      const zipEntries = zip.getEntries();

      // GitHub ZIP은 보통 'owner-repo-hash/' 폴더가 최상위임
      const firstEntry = zipEntries[0].entryName.split('/')[0];
      
      // 임시 폴더에 압축 해제
      const tmpDir = path.join(SYSTEM_DIR, 'update_tmp');
      zip.extractAllTo(tmpDir, true);

      // 실제 소스 코드가 들어있는 폴더 경로
      const sourceDir = path.join(tmpDir, firstEntry, 'system');
      
      if (await fs.pathExists(sourceDir)) {
        // config.json, session.json, logs는 덮어쓰지 않도록 보호
        const protectFiles = ['config.json', 'session.json', 'logs'];
        
        const files = await fs.readdir(sourceDir);
        for (const file of files) {
          if (protectFiles.includes(file)) continue;
          
          const srcPath = path.join(sourceDir, file);
          const destPath = path.join(SYSTEM_DIR, file);
          
          await fs.remove(destPath);
          await fs.move(srcPath, destPath);
        }

        // 패키지 버전 업데이트 (보호 대상이 아니지만 명시적으로 최신화)
        pkg.version = latestVersion;
        await fs.writeJson(PKG_PATH, pkg, { spaces: 2 });

        console.log(`[UPDATER] 업데이트 완료! v${latestVersion}로 갱신되었습니다.`);
      } else {
        throw new Error('업데이트 패키지 구조가 올바르지 않습니다. (system 폴더 없음)');
      }

      // 임시 파일 삭제
      await fs.remove(tmpZip);
      await fs.remove(tmpDir);

    } else {
      console.log('[UPDATER] 이미 최신 버전입니다.');
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('[UPDATER] GitHub 릴리스를 찾을 수 없습니다. (아직 배포된 버전이 없거나 비공개 저장소일 수 있음)');
    } else {
      console.error('[UPDATER] 업데이트 체크 중 오류 발생:', error.message);
    }
  }
}

function isNewerVersion(current, latest) {
  const cArr = current.split('.').map(Number);
  const lArr = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((lArr[i] || 0) > (cArr[i] || 0)) return true;
    if ((lArr[i] || 0) < (cArr[i] || 0)) return false;
  }
  return false;
}

(async () => {
  await checkAndUpdate();
})();
