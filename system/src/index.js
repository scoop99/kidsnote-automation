const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const KidsNoteScraper = require('./scraper');
const KidsNoteDownloader = require('./downloader');
const { notify } = require('./notifier');
const { fmtElapsed, sanitizeSegment } = require('./utils');

// system 폴더 내 위치
const CONFIG_FILE = path.join(__dirname, '../config.json');
const LOCK_FILE = path.join(__dirname, '../.lock');

async function checkLock() {
  if (await fs.pathExists(LOCK_FILE)) {
    const stats = await fs.stat(LOCK_FILE);
    // 1시간 이상 된 락 파일은 무시 (비정상 종료 대비)
    if (Date.now() - stats.mtimeMs < 3600000) {
      throw new Error('프로그램이 이미 실행 중입니다. (중복 실행 방지)');
    }
    await fs.remove(LOCK_FILE);
  }
  await fs.writeFile(LOCK_FILE, String(process.pid));
}

async function releaseLock() {
  await fs.remove(LOCK_FILE).catch(() => {});
}

function sanitizeLog(msg) {
  if (typeof msg !== 'string') return msg;
  // 세션 ID 및 민감 쿠키 마스킹
  return msg.replace(/sessionid=[a-zA-Z0-9]+/g, 'sessionid=***')
            .replace(/csrftoken=[a-zA-Z0-9]+/g, 'csrftoken=***');
}

async function loadConfig() {
  if (await fs.pathExists(CONFIG_FILE)) { return await fs.readJson(CONFIG_FILE); }
  return {};
}

function formatDateKST(dateStr) {
  if (!dateStr) return '';
  // 이미 한국어 형식이거나 (오전/오후), ISO 형식이 아니면 그대로 반환
  if (dateStr.includes('오전') || dateStr.includes('오후')) return dateStr;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    // UTC 기준일 경우 KST(+9)로 변환 (문자열에 Z나 T가 포함된 경우)
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

  try {
    await checkLock();
    const config = await loadConfig();
    scraper = new KidsNoteScraper();
    const downloader = new KidsNoteDownloader(config);

    await downloader.init();
    await scraper.init(true);
    const isLoggedIn = await scraper.checkLogin();
    if (!isLoggedIn) { await scraper.performManualLogin(); }
    const info = await scraper.getChildInfo();
    console.log(`[AUTH] 로그인 사용자: ${info.name} (${info.childId})`);

    // 기존 영문 폴더 마이그레이션 (Reports -> 알림장, Albums -> 앨범)
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

    const filter = process.argv[2]; // 'all' 또는 'YYYY-MM'
    await syncCollection(scraper, downloader, 'album', info, config, filter);
    await syncCollection(scraper, downloader, 'report', info, config, filter);

    const elapsed = fmtElapsed(Date.now() - startTime);
    notify('백업 완료', `정상적으로 백업이 완료되었습니다. (소요 시간: ${elapsed})`, 'ok');
  } catch (e) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const logPath = path.join(__dirname, `../logs/error-${dateStr}.txt`);
    const errorMsg = sanitizeLog(`[${new Date().toISOString()}] ${e.stack}\n\n`);
    await fs.appendFile(logPath, errorMsg).catch(() => {});
    console.error('[CRITICAL ERROR]', sanitizeLog(e.message));
    notify('백업 실패', sanitizeLog(e.message), 'err');
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

async function syncCollection(scraper, downloader, type, info, config, filter) {
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
  if (!success) { if (type === 'album') return; throw new Error(`API 주소 탐색 실패: ${type}`); }

  let page = 1;
  let hasNext = true;
  let currentNum = 0;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const syncAll = filter === 'all' || config.sync_all === true;
  const targetMonth = (filter && filter !== 'all') ? filter : null;

  console.log(`[SYNC] ${type === 'album' ? '앨범' : '알림장'} 탐색 시작... (${targetMonth ? targetMonth + ' 자료만' : (syncAll ? '전체 백업 모드' : '이번 달 데이터만')})`);

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

        // 특정 월 필터링
        if (targetMonth && itemYM !== targetMonth) {
          // 역순이므로 타겟 월보다 이전 월이 나오면 중단
          if (itemYM < targetMonth) { hasNext = false; break; }
          continue;
        } else if (!syncAll && !targetMonth && itemYM && itemYM < currentMonth) {
          // 이번 달 모드일 때 이전 달이 나오면 중단
          hasNext = false;
          break;
        }

        const itemId = item.id;
        const ym = itemYM || 'etc';
        const title = sanitizeSegment(item.title || item.class_name || item.content?.slice(0, 20) || '제목없음', 60);
        const folderName = `${itemDate}-${title}-${itemId}`;
        const baseDir = path.join(downloader.downloadBase, type === 'album' ? '앨범' : '알림장');
        const targetDir = path.join(baseDir, folderName);

        // ID 기반 기존 폴더 검색 및 이름 동기화
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

        // 스마트 업데이트: 모든 데이터가 일치하고 '물리적 폴더'가 존재할 때만 스킵
        if (localEntry &&
          localEntry.fileCount === serverCount &&
          localEntry.commentCount === commentCount &&
          localEntry.contentSize === contentSize &&
          await fs.pathExists(targetDir)) {
          currentNum++;
          continue;
        }

        currentNum++;
        const isNew = !localEntry;
        const status = isNew ? '신규 발견' : '내용 업데이트';
        const itemHeader = `[SYNC] ${type === 'album' ? '앨범' : '알림장'} [${itemDate}] ${status}!`;
        process.stdout.write(`\r${itemHeader} 준비 중...`);
        await processItem(downloader, item, type, targetDir, serverCount, itemHeader, baseUrl, scraper);
        process.stdout.write('\n'); // 게시글 하나 완료 시 줄바꿈
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

  // 댓글 수집 시도 (상세 API 또는 댓글 전용 API 호출)
  let commentsBlock = '';
  try {
    const detailUrl = `${baseUrl}${itemId}/`;
    const detailPage = await scraper.context.newPage();
    const discoveredComments = [];

    // 1. API 응답 실시간 감시
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

    // 2. 페이지 방문 및 충분한 대기
    const serviceUrl = type === 'album' ? `https://www.kidsnote.com/service/album/${itemId}/` : `https://www.kidsnote.com/service/report/${itemId}/`;
    await detailPage.goto(serviceUrl, { waitUntil: 'load' }); // load 완료 후 대기
    await detailPage.waitForTimeout(3000); // 3초간 대기 (댓글 로딩용)

    // 3. 지능형 DOM 스크래핑 (API에서 못 찾은 경우 대비)
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
      // 본문 내용과 중복되는 댓글 제거 (가끔 본문이 댓글로 오해받을 수 있음)
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

      // 댓글 정렬 (과거 -> 최신)
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
  } catch (e) {
    // console.log(`[ERROR] 댓글 수집 실패: ${e.message}`);
  }

  await fs.ensureDir(targetDir);

  // 본문 헤더 구성
  const authorName = item.author?.name || item.author_name || '작성자';
  const postDate = formatDateKST(item.created || item.date_written || '');
  const postHeader = `${'='.repeat(50)}\n[본문 게시글]\n작성자: ${authorName}\n작성일: ${postDate}\n${'='.repeat(50)}\n\n`;

  const fullContent = postHeader + (item.content || item.description || '') + commentsBlock;
  await fs.writeFile(path.join(targetDir, '내용.txt'), fullContent);

  let currentFile = 0;

  // 다운로드 진행 메시지 개선 (이미 있으면 '확인 중', 없으면 '다운로드 중')
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
