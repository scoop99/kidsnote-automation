const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const cron = require('node-cron');
const KidsNoteScraper = require('./scraper');
const KidsNoteDownloader = require('./downloader');
const { notify } = require('./notifier');
const { fmtElapsed, sanitizeSegment } = require('./utils');

const CONFIG_FILE = path.join(__dirname, '../config.json');
const LOCK_FILE = path.join(__dirname, '../.lock');
const LAST_SYNC_FILE = path.join(__dirname, '../last_sync.json'); // #8

async function checkLock() {
  if (await fs.pathExists(LOCK_FILE)) {
    const stats = await fs.stat(LOCK_FILE);
    // #3: 타임아웃 1시간 → 10분으로 단축
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

// #2: 강제 종료(Ctrl+C) 시에도 lock 파일 삭제
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

// #8: 마지막 백업 기록 저장
async function saveLastSync(success, stats) {
  const data = {
    timestamp: new Date().toISOString(),
    success,
    newItems: stats.newItems || 0,
    updatedItems: stats.updatedItems || 0,
  };
  await fs.writeJson(LAST_SYNC_FILE, data, { spaces: 2 }).catch(() => {});
}

function formatDateKST(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes('오전') || dateStr.includes('오후')) return dateStr;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    if (dateStr.includes('T') || dateStr.includes('Z')) {
      const kstDate = new Date(d.getTime() + (9 * 60 * 60 * 1000));
      return kstDate.toISOString().replace('T', ' ').split('.')[0];
    }
    return dateStr;
  } catch (e) { return dateStr; }
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

    // #11: 세션 만료 확인
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

    const filter = process.argv[2];
    await syncCollection(scraper, downloader, 'album', info, config, filter, syncStats);
    await syncCollection(scraper, downloader, 'report', info, config, filter, syncStats);

    const elapsed = fmtElapsed(Date.now() - startTime);
    const summary = `신규 ${syncStats.newItems}개, 업데이트 ${syncStats.updatedItems}개 (소요: ${elapsed})`;
    notify('✅ 백업 완료!', summary, 'ok');
    console.log(`\n[완료] ${summary}`);

    // #8: 백업 결과 저장
    await saveLastSync(true, syncStats);

    // #6: 완료 후 저장 폴더 자동 열기
    const folderPath = downloader.downloadBase;
    exec(`explorer.exe "${folderPath}"`);

  } catch (e) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const logPath = path.join(__dirname, `../logs/error-${dateStr}.txt`);
    const errorMsg = sanitizeLog(`[${new Date().toISOString()}] ${e.stack}\n\n`);
    await fs.appendFile(logPath, errorMsg).catch(() => {});

    // #7: 에러 메시지 한글화
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

async function tryApi(scraper, url, info) {
  const { childId, centerId, classId } = info;
  try {
    const allParams = new URLSearchParams({ page_size: '10', child: childId, cls: classId || '', center_id: centerId || '', tz: 'Asia/Seoul' });
    const minParams = new URLSearchParams({ page_size: '10', cls: classId || '', tz: 'Asia/Seoul' });
    const noParams = new URLSearchParams({ page_size: '10' });
    const base = url.replace(/\/$/, '') + '/';
    const variations = [{ u: base, p: noParams }, { u: base, p: minParams }, { u: base, p: allParams }];
    for (const { u, p } of variations) {
      const fullUrl = `${u}?${p.toString()}`;
      const result = await scraper.fetchApi(fullUrl);
      if (result.ok) {
        const json = result.json;
        const items = json.results || json.activities || json.notices || json.posts || json.reports || json.albums || [];
        const count = json.count || items.length || 0;
        if (count > 0) return { ok: true, count, url: u, params: p };
      }
    }
    return { ok: false };
  } catch (e) { return { ok: false }; }
}

async function syncCollection(scraper, downloader, type, info, config, filter, syncStats) {
  const { childId, centerId, classId } = info;
  let baseUrl = '';
  let finalParams = null;
  let success = false;
  let finalRes = null;
  const testPaths = [];
  const versions = ['v1_3', 'v1_2', 'v1_1', 'v1'];
  const collections = type === 'album' ? ['albums', 'album', 'notices', 'activities'] : ['reports', 'report', 'records/posts', 'notices', 'activities'];
  for (const v of versions) {
    for (const col of collections) {
      testPaths.push(`https://www.kidsnote.com/api/${v}/children/${childId}/${col}/`);
      if (centerId) testPaths.push(`https://www.kidsnote.com/api/${v}/centers/${centerId}/${col}/`);
    }
  }
  if (type === 'album' && scraper.detectedUrls.album) testPaths.unshift(scraper.detectedUrls.album);
  if (type === 'report' && scraper.detectedUrls.report) testPaths.unshift(scraper.detectedUrls.report);
  if (scraper.detectedUrls.activities) testPaths.unshift(scraper.detectedUrls.activities);
  for (const testUrl of [...new Set(testPaths)]) {
    const res = await tryApi(scraper, testUrl, info);
    if (res.ok) {
      baseUrl = res.url.replace(/\/$/, '') + '/';
      finalParams = res.params;
      finalRes = res;
      success = true;
      break;
    }
  }
  if (!success) { if (type === 'album') return; throw new Error(`자료를 가져오는 API 주소를 찾지 못했습니다. (${type})`); }

  let page = 1;
  let hasNext = true;
  let currentNum = 0;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const syncAll = filter === 'all' || config.sync_all === true;
  const targetMonth = (filter && filter !== 'all') ? filter : null;
  const typeName = type === 'album' ? '앨범' : '알림장';
  
  // 전체 개수가 명확하지 않을 경우를 위한 처리
  const isTotalValid = typeof finalRes.count === 'number' && finalRes.count > 0;
  const totalDisplay = isTotalValid ? finalRes.count : '?';

  console.log(`\n[SYNC] ${typeName} 탐색 시작... (대상: ${targetMonth ? targetMonth + ' 자료만' : (syncAll ? '전체 백업 모드' : '이번 달 데이터만')})`);

  while (hasNext) {
    const params = new URLSearchParams(finalParams);
    params.set('page_size', '20');
    if (page > 1) params.set('page', String(page));
    const url = `${baseUrl}?${params.toString()}`;
    const result = await scraper.fetchApi(url);
    if (!result.ok) break;
    const json = result.json;
    const items = json.results || json.activities || json.notices || json.posts || json.reports || json.albums || [];

    if (items.length > 0) {
      for (const [idx, item] of items.entries()) {
        const created = item.created || item.date_written || item.date_at || '';
        const itemDate = created.slice(0, 10) || '0000-00-00';
        const itemYM = created.slice(0, 7);

        if (targetMonth && itemYM !== targetMonth) {
          if (itemYM < targetMonth) { hasNext = false; break; }
          continue;
        } else if (!syncAll && !targetMonth && itemYM && itemYM < currentMonth) {
          hasNext = false;
          break;
        }

        const itemId = item.id;
        const ym = itemYM || 'etc';
        const title = sanitizeSegment(item.title || item.class_name || item.content?.slice(0, 20) || '제목없음', 60);
        const folderName = `${itemDate}-${title}-${itemId}`;
        const baseDir = path.join(downloader.downloadBase, type === 'album' ? '앨범' : '알림장');
        const targetDir = path.join(baseDir, folderName);

        const existingPath = await downloader.findFolderById(baseDir, itemId);
        if (existingPath && existingPath !== targetDir) {
          await downloader.renameFolder(existingPath, targetDir);
        }

        const images = item.attached_images || (item.image ? [item.image] : []) || [];
        const videos = item.attached_videos || (item.attached_video ? [item.attached_video] : []) || [];
        const serverCount = images.length + videos.length;
        const commentCount = item.num_comments || 0;
        const contentSize = (item.content || '').length;

        const syncLog = await downloader.getSyncLog(ym);
        const localEntry = syncLog[itemId];

        if (localEntry &&
          localEntry.fileCount === serverCount &&
          localEntry.commentCount === commentCount &&
          localEntry.contentSize === contentSize &&
          await fs.pathExists(targetDir)) {
          currentNum++;
          process.stdout.write(`\r[SYNC] ${typeName} 확인 중...`);
          continue;
        }

        currentNum++;
        const isNew = !localEntry;
        if (isNew) syncStats.newItems++;
        else syncStats.updatedItems++;

        const status = isNew ? '신규 발견' : '내용 업데이트';
        const itemHeader = `[SYNC] ${typeName} [${itemDate}] ${status}`;
        process.stdout.write(`\r${itemHeader} 준비 중...`);
        await processItem(downloader, item, type, targetDir, serverCount, itemHeader, baseUrl, scraper);
        process.stdout.write('\n');
      }
    }
    if (!hasNext) break;
    hasNext = !!(json.next || json.has_next);
    page++;
    if (!items.length || page > 1000) break;
  }
  if (currentNum > 0) process.stdout.write('\n');
}

async function processItem(downloader, item, type, targetDir, serverCount, itemHeader, baseUrl, scraper) {
  const created = item.created || item.date_written || item.date_at || '';
  const dateStr = created.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const ym = created.slice(0, 7) || 'etc';
  const title = sanitizeSegment(item.title || item.class_name || item.content?.slice(0, 20) || '제목없음', 60);
  const itemId = item.id;
  if (!itemId) return;

  const images = item.attached_images || (item.image ? [item.image] : []) || [];
  const videos = item.attached_videos || (item.attached_video ? [item.attached_video] : []) || [];
  const allVideos = [...videos];
  if (item.material_video) allVideos.push(item.material_video);

  // #10: 댓글 수집 진행 메시지
  let commentsBlock = '';
  try {
    process.stdout.write(`\r${itemHeader} 댓글 불러오는 중...`);
    const detailUrl = `${baseUrl}${itemId}/`;
    const detailPage = await scraper.context.newPage();
    const discoveredComments = [];

    detailPage.on('response', async res => {
      const u = res.url();
      if (u.includes('api')) {
        try {
          const json = await res.json().catch(() => null);
          if (!json) return;
          const list = json.comments || json.comment_list || json.replies || json.results || json.items || (Array.isArray(json) ? json : null);
          if (Array.isArray(list) && list.length > 0) {
            const first = list[0];
            if (first && (first.content || first.body || first.author || first.author_name)) {
              discoveredComments.push(...list);
            }
          }
        } catch (e) { }
      }
    });

    const serviceUrl = type === 'album' ? `https://www.kidsnote.com/service/album/${itemId}/` : `https://www.kidsnote.com/service/report/${itemId}/`;
    await detailPage.goto(serviceUrl, { waitUntil: 'load' });
    await detailPage.waitForTimeout(3000);

    if (discoveredComments.length === 0) {
      const domComments = await detailPage.evaluate(() => {
        const results = [];
        const candidates = document.querySelectorAll('div, li, section');
        candidates.forEach(el => {
          const text = el.innerText || '';
          if (text.length > 5 && text.length < 1000) {
            const hasAuthor = el.querySelector('.name, .author, .nickname, b, strong');
            const hasDate = el.querySelector('.date, .time, .created-at, span');
            const hasContent = el.querySelector('p, .content, .text, .body');
            if (hasAuthor && hasDate && hasContent) {
              results.push({
                author_name: hasAuthor.innerText.trim(),
                created: hasDate.innerText.trim(),
                content: hasContent.innerText.trim()
              });
            }
          }
        });
        return results.filter((item, index, self) =>
          index === self.findIndex((t) => t.content === item.content)
        );
      });
      if (domComments.length > 0) {
        discoveredComments.push(...domComments);
      }
    }
    await detailPage.close();

    const comments = discoveredComments;
    if (comments && comments.length > 0) {
      const mainContent = (item.content || item.description || '').trim();
      const uniqueComments = [];
      const seenContent = new Set();
      for (const c of comments) {
        const text = (c.content || c.body || '').trim();
        if (text && !seenContent.has(text) && text !== mainContent) {
          uniqueComments.push(c);
          seenContent.add(text);
        }
      }

      uniqueComments.sort((a, b) => {
        const da = new Date(a.created || a.date_written || 0);
        const db = new Date(b.created || b.date_written || 0);
        return da - db;
      });

      commentsBlock = `\n\n${'='.repeat(50)}\n[댓글 목록: ${uniqueComments.length}개]\n${'='.repeat(50)}\n`;
      for (const c of uniqueComments) {
        const cAuthor = c.author?.name || c.author_name || c.user?.name || '작성자';
        const role = c.author?.type || c.user?.role || '';
        const roleStr = role ? ` (${role === 'teacher' ? '교사' : (role === 'parent' ? '학부모' : role)})` : '';
        const cDate = formatDateKST(c.created || c.date_written || '');
        const cContent = c.content || c.body || '내용 없음';
        commentsBlock += `\n▶ [${cAuthor}${roleStr}] ${cDate}\n: ${cContent}\n${'-'.repeat(40)}\n`;
      }
    }
  } catch (e) { /* 댓글 수집 실패 시 무시 */ }

  await fs.ensureDir(targetDir);

  const authorName = item.author?.name || item.author_name || '작성자';
  const postDate = formatDateKST(item.created || item.date_written || '');
  const postHeader = `${'='.repeat(50)}\n[본문 게시글]\n작성자: ${authorName}\n작성일: ${postDate}\n${'='.repeat(50)}\n\n`;

  const fullContent = postHeader + (item.content || item.description || '') + commentsBlock;
  await fs.writeFile(path.join(targetDir, '내용.txt'), fullContent);

  let currentFile = 0;
  for (const [i, img] of images.entries()) {
    currentFile++;
    const url = img.original || img.large || img.url || img.file;
    if (url) {
      const filePath = path.join(targetDir, 'photos', `${String(i + 1).padStart(3, '0')}${path.extname(new URL(url).pathname) || '.jpg'}`);
      if (!(await fs.pathExists(filePath))) {
        process.stdout.write(`\r${itemHeader} 다운로드 중... (${currentFile}/${serverCount})`);
        await downloader.downloadFile(url, filePath);
      } else {
        process.stdout.write(`\r${itemHeader} 확인 중... (${currentFile}/${serverCount})`);
      }
    }
  }

  for (const [i, vid] of allVideos.entries()) {
    currentFile++;
    const url = typeof vid === 'string' ? vid : (vid.high || vid.url || vid.file);
    if (url) {
      const filePath = path.join(targetDir, 'videos', `${String(i + 1).padStart(3, '0')}${path.extname(new URL(url).pathname) || '.mp4'}`);
      if (!(await fs.pathExists(filePath))) {
        process.stdout.write(`\r${itemHeader} 다운로드 중... (${currentFile}/${serverCount})`);
        await downloader.downloadFile(url, filePath);
      } else {
        process.stdout.write(`\r${itemHeader} 확인 중... (${currentFile}/${serverCount})`);
      }
    }
  }

  const commentCount = item.num_comments || 0;
  const contentSize = (item.content || '').length;
  await downloader.updateSyncLog(ym, itemId, title, serverCount, commentCount, contentSize, type);
}

(async () => { await runSync(); })();
