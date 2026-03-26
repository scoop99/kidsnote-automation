const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

// 작업 디렉토리 설정
const SYSTEM_DIR = path.join(__dirname, '..');
const PKG_PATH = path.join(SYSTEM_DIR, 'package.json');
const CONFIG_PATH = path.join(SYSTEM_DIR, 'config.json');

async function checkAndUpdate() {
  const tmpZip = path.join(SYSTEM_DIR, 'update.zip');
  const tmpDir = path.join(SYSTEM_DIR, 'update_tmp');
  const backupDir = path.join(SYSTEM_DIR, 'system_backup_tmp');

  try {
    // 1. 설정 및 패키지 정보 로드
    const pkg = await fs.readJson(PKG_PATH);
    const config = await fs.readJson(CONFIG_PATH).catch(() => ({}));

    const currentVersion = pkg.version || '0.0.0';
    const repo = config.github_repo;

    if (!repo) {
      console.log('[UPDATER] GitHub 저장소 정보가 config.json에 설정되지 않아 건너뜁니다.');
      return;
    }

    console.log(`[UPDATER] 현재 버전: v${currentVersion} (저장소: ${repo})`);
    console.log('[UPDATER] 최신 버전 확인 중...');

    // 2. GitHub 최신 릴리스 정보 가져오기
    const res = await axios.get(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      timeout: 10000
    });

    const latestVersion = res.data.tag_name.replace(/^v/, '');
    const zipUrl = res.data.zipball_url;

    if (isNewerVersion(currentVersion, latestVersion)) {
      console.log(`[UPDATER] 새 버전 발견! (v${currentVersion} -> v${latestVersion})`);
      
      try {
        console.log('[UPDATER] 업데이트 다운로드 중...');
        const response = await axios({
          method: 'get',
          url: zipUrl,
          responseType: 'arraybuffer',
          timeout: 60000
        });
        await fs.writeFile(tmpZip, response.data);

        console.log('[UPDATER] 업데이트 준비 중... (백업 생성)');
        await fs.copy(SYSTEM_DIR, backupDir, {
          filter: (src) => !src.includes('update_tmp') && !src.includes('update.zip') && !src.includes('system_backup_tmp')
        }).catch(() => {});

        console.log('[UPDATER] 파일 압축 해제 및 교체 중...');
        const zip = new AdmZip(tmpZip);
        const zipEntries = zip.getEntries();
        const firstEntry = zipEntries[0].entryName.split('/')[0];
        
        await fs.ensureDir(tmpDir);
        zip.extractAllTo(tmpDir, true);

        const sourceDir = path.join(tmpDir, firstEntry, 'system');
        if (await fs.pathExists(sourceDir)) {
          const protectFiles = ['config.json', 'session.json', 'logs'];
          const files = await fs.readdir(sourceDir);
          for (const file of files) {
            if (protectFiles.includes(file)) continue;
            const srcPath = path.join(sourceDir, file);
            const destPath = path.join(SYSTEM_DIR, file);
            await fs.remove(destPath).catch(() => {});
            await fs.move(srcPath, destPath, { overwrite: true });
          }

          pkg.version = latestVersion;
          await fs.writeJson(PKG_PATH, pkg, { spaces: 2 });
          console.log(`[UPDATER] 업데이트 완료! v${latestVersion}로 갱신되었습니다.`);
        } else {
          throw new Error('업데이트 패키지 구조가 올바르지 않습니다. (system 폴더 없음)');
        }
      } catch (innerError) {
        console.error('[UPDATER] 업데이트 적용 중 오류 발생:', innerError.message);
        if (await fs.pathExists(backupDir)) {
          console.log('[UPDATER] 이전 버전으로 복구 시도 중...');
          await fs.copy(backupDir, SYSTEM_DIR, { overwrite: true }).catch(() => {});
        }
        throw innerError;
      } finally {
        await fs.remove(tmpZip).catch(() => {});
        await fs.remove(tmpDir).catch(() => {});
        await fs.remove(backupDir).catch(() => {});
      }
    } else {
      console.log('[UPDATER] 이미 최신 버전입니다.');
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('[UPDATER] 릴리스 정보를 찾을 수 없습니다.');
    } else {
      console.error('[UPDATER] 오류 발생:', error.message);
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
