const fs = require('fs-extra');
const path = require('path');
const { sanitizeSegment, formatDateKST } = require('../utils');
const { parseLifeRecord } = require('../utils/parser');

/**
 * 단일 아이템(알림장/앨범)의 데이터를 가공하고 파일/이미지를 다운로드합니다.
 */
async function processItem(downloader, scraper, item, type, targetDir, serverCount, itemHeader, baseUrl) {
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

  // 댓글 수집
  let commentsBlock = '';
  let collectedComments = [];
  try {
    process.stdout.write(`\r${itemHeader} 댓글 불러오는 중...`);
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

    const serviceUrl = type === 'album'
      ? `https://www.kidsnote.com/service/album/${itemId}/`
      : `https://www.kidsnote.com/service/report/${itemId}/`;
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

    // [KAV 기능] DOM에서 생활기록 (Life Record) 추출
    const lifeRecordDOM = await detailPage.evaluate(() => {
      const text = document.body.innerText;
      const startTag = '생활기록\n';
      const startIdx = text.indexOf(startTag);
      if (startIdx === -1) return null;

      const lines = text.substring(startIdx + startTag.length).split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(0, 30);
      const result = {};
      let currentKey = null;

      const validKeys = ['기분', '건강', '체온체크', '식사여부', '수면시간', '배변상태', '투약', '특이사항'];

      for (const line of lines) {
        if (validKeys.includes(line)) {
          currentKey = line;
        } else if (currentKey) {
          if (!line.includes('교사') && !line.includes('월요일') && line.length < 50) {
            result[currentKey] = line;
          }
          currentKey = null;
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    });

    if (lifeRecordDOM) {
      item.__lifeRecordDOM = lifeRecordDOM;
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

      collectedComments = uniqueComments;

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

  // KAV Parser를 통한 메타데이터 생성 (생활기록 등)
  const lifeRecord = parseLifeRecord(item);
  const metadata = {
    id: itemId,
    type,
    title,
    date: dateStr,
    author: authorName,
    content: item.content || item.description || '',
    imageCount: images.length,
    videoCount: allVideos.length,
    commentCount: item.num_comments || 0,
    comments: collectedComments.map(c => ({
      author: c.author?.name || c.author_name || c.user?.name || '작성자',
      role: c.author?.type || c.user?.role || '',
      date: c.created || c.date_written || '',
      content: c.content || c.body || '',
    })),
    lifeRecord,
    savedAt: new Date().toISOString(),
  };
  await fs.writeJson(path.join(targetDir, 'metadata.json'), metadata, { spaces: 2 });

  // 이미지 다운로드
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

  // 영상 다운로드
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
  // 서버측의 최종 변경 시점 추출
  const updatedAt = item.updated_at || item.date_edited || item.updated || '';
  
  await downloader.updateSyncLog(ym, itemId, title, serverCount, commentCount, contentSize, type, true, updatedAt);
}

module.exports = {
  processItem
};
