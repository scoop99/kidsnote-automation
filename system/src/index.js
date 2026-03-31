const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const cron = require('node-cron');
const KidsNoteScraper = require('./scraper');
const KidsNoteDownloader = require('./downloader');
const { notify } = require('./notifier');
const { fmtElapsed, sanitizeSegment } = require('./utils');
const { syncCollection } = require('./core/syncer');

const CONFIG_FILE = path.join(__dirname, '../config.json');
const LOCK_FILE = path.join(__dirname, '../.lock');
const LAST_SYNC_FILE = path.join(__dirname, '../last_sync.json');

async function checkLock() {
  if (await fs.pathExists(LOCK_FILE)) {
    const stats = await fs.stat(LOCK_FILE);
    if (Date.now() - stats.mtimeMs < 600000) {
      throw new Error('프로그램이 이미 실행 중입니다.\n잠시 후 다시 시도하거나, 문제가 지속되면 관리자에게 연락하세요.');
    }
    await fs.remove(LOCK_FILE);
  }
  await fs.writeFile(LOCK_FILE, String(process.pid));
}

async function releaseLock() {
  await fs.remove(LOCK_FILE).catch(() => {});
}

async function handleExit() {
  await releaseLock();
  process.exit(0);
}
process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

function sanitizeLog(msg) {
  if (typeof msg !== 'string') return msg;
  return msg.replace(/sessionid=[a-zA-Z0-9]+/g, 'sessionid=***')
            .replace(/csrftoken=[a-zA-Z0-9]+/g, 'csrftoken=***');
}

async function loadConfig() {
  if (await fs.pathExists(CONFIG_FILE)) { return await fs.readJson(CONFIG_FILE); }
  return {};
}

async function saveLastSync(success, stats) {
  const data = {
    timestamp: new Date().toISOString(),
    success,
    newItems: stats.newItems || 0,
    updatedItems: stats.updatedItems || 0,
  };
  await fs.writeJson(LAST_SYNC_FILE, data, { spaces: 2 }).catch(() => {});
}



async function runSync() {
  const startTime = Date.now();
  let scraper = null;
  const syncStats = { newItems: 0, updatedItems: 0 };

  try {
    await checkLock();
    const config = await loadConfig();
    scraper = new KidsNoteScraper();
    const downloader = new KidsNoteDownloader(config);

    await downloader.init();
    await scraper.init(true);
    const isLoggedIn = await scraper.checkLogin();
    if (!isLoggedIn) { await scraper.performManualLogin(); }

    if (await scraper.isSessionExpired()) {
      throw new Error('세션이 만료되었습니다. 프로그램을 다시 실행하고 로그인해 주세요.');
    }

    const info = await scraper.getChildInfo();
    console.log(`[AUTH] 로그인 사용자: ${info.name} (${info.childId})`);

    // 기존 영문 폴더 마이그레이션
    const reportsOld = path.join(downloader.downloadBase, 'Reports');
    const reportsNew = path.join(downloader.downloadBase, '알림장');
    if (await fs.pathExists(reportsOld) && !(await fs.pathExists(reportsNew))) {
      await fs.move(reportsOld, reportsNew);
    }
    const albumsOld = path.join(downloader.downloadBase, 'Albums');
    const albumsNew = path.join(downloader.downloadBase, '앨범');
    if (await fs.pathExists(albumsOld) && !(await fs.pathExists(albumsNew))) {
      await fs.move(albumsOld, albumsNew);
    }

    // 기존 평면 구조 → YYYY/MM 계층 구조 자동 마이그레이션
    console.log('[MIGRATE] 폴더 구조 최신화 확인 중...');
    await downloader.migrateToHierarchy(path.join(downloader.downloadBase, '알림장'));
    await downloader.migrateToHierarchy(path.join(downloader.downloadBase, '앨범'));

    const filter = process.argv[2];
    await syncCollection(scraper, downloader, 'album', info, config, filter, syncStats);
    await syncCollection(scraper, downloader, 'report', info, config, filter, syncStats);

    const elapsed = fmtElapsed(Date.now() - startTime);
    const summary = `신규 ${syncStats.newItems}개, 업데이트 ${syncStats.updatedItems}개 (소요: ${elapsed})`;
    notify('✅ 백업 완료!', summary, 'ok');
    console.log(`\n[완료] ${summary}`);

    await saveLastSync(true, syncStats);

    const folderPath = downloader.downloadBase;
    exec(`explorer.exe "${folderPath}"`);

  } catch (e) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const logPath = path.join(__dirname, `../logs/error-${dateStr}.txt`);
    const errorMsg = sanitizeLog(`[${new Date().toISOString()}] ${e.stack}\n\n`);
    await fs.appendFile(logPath, errorMsg).catch(() => {});

    const userMsg = sanitizeLog(e.message);
    console.error('\n[오류] 백업 중 문제가 발생했습니다.');
    console.error(`원인: ${userMsg}`);
    console.error('문제가 반복되면 관리자에게 화면을 캡처해서 보내주세요.\n');
    notify('❌ 백업 실패', `${userMsg}\n관리자에게 연락해 주세요.`, 'err');
    await saveLastSync(false, syncStats);
  } finally {
    if (scraper) await scraper.close();
    await releaseLock();
  }
}



(async () => { await runSync(); })();
