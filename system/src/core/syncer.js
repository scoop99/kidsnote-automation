const fs = require('fs-extra');
const path = require('path');
const { sanitizeSegment } = require('../utils');
const { processItem } = require('./processor');

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

        // YYYY/MM 계층 구조에서 경로 생성
        const targetDir = downloader.getTargetDir(baseDir, itemDate, folderName);

        const existingPath = await downloader.findFolderById(baseDir, itemId);
        if (existingPath && existingPath !== targetDir) {
          await downloader.renameFolder(existingPath, targetDir);
        }

        const images = item.attached_images || (item.image ? [item.image] : []) || [];
        const videos = item.attached_videos || (item.attached_video ? [item.attached_video] : []) || [];;
        const serverCount = images.length + videos.length;
        const commentCount = item.num_comments || 0;
        const contentSize = (item.content || '').length;
        const serverUpdatedAt = item.updated_at || item.date_edited || item.updated || '';

        const syncLog = await downloader.getSyncLog(ym);
        const localEntry = syncLog[itemId];

        // [KAV 로직 추가] 뷰어용 metadata.json 파일의 실제 물리적 존재 유무 체크
        const metadataExists = await fs.pathExists(path.join(targetDir, 'metadata.json'));
        
        // 생활기록 내용물 수정(본문 길이 동일)까지 감지하기 위해 updatedAt 필드 및 hasMetadata 검사 추가
        const isUpToDate = localEntry &&
          localEntry.fileCount === serverCount &&
          localEntry.commentCount === commentCount &&
          localEntry.contentSize === contentSize &&
          localEntry.hasMetadata === true &&
          metadataExists &&
          (!serverUpdatedAt || localEntry.serverUpdatedAt === serverUpdatedAt);

        if (isUpToDate && await fs.pathExists(targetDir)) {
          currentNum++;
          process.stdout.write(`\r[SYNC] ${typeName} 확인 중...`);
          continue;
        }

        currentNum++;
        const isNew = !localEntry;
        if (isNew) syncStats.newItems++;
        else syncStats.updatedItems++;

        const statusLabel = isNew ? '신규 발견' : (metadataExists ? '내용 업데이트' : '메타데이터 갱신');
        const itemHeader = `[SYNC] ${typeName} [${itemDate}] ${statusLabel}`;
        process.stdout.write(`\r${itemHeader} 준비 중...`);
        
        // 아이템 처리 (사진/영상 다운로드 및 데이터 생성)
        await processItem(downloader, scraper, item, type, targetDir, serverCount, itemHeader, baseUrl);
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

module.exports = {
  syncCollection
};
