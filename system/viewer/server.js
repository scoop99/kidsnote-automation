/**
 * KAV (KidsNote Archive Viewer) - Local Express Server
 * Port: 3456 | 자동 포트 정리 + 정적 파일 서빙 + REST API 제공
 */
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec, execSync } = require('child_process');

const PORT = 3456;
const CONFIG_FILE = path.join(__dirname, '../config.json');
let DOWNLOADS_DIR = path.resolve(__dirname, '../../downloads');

// config.json에서 다운로드 경로 동기화
if (fs.pathExistsSync(CONFIG_FILE)) {
  const config = fs.readJsonSync(CONFIG_FILE);
  if (config.download_path) {
    DOWNLOADS_DIR = path.resolve(__dirname, '../../', config.download_path);
  }
}

const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

// ─── 정적 파일 서빙 ─────────────────────────────────────────────
app.use('/public', express.static(PUBLIC_DIR));
// 다운로드 폴더 이미지/영상 직접 접근 허용
app.use('/files', express.static(DOWNLOADS_DIR));

// ─── CORS (localhost 전용) ───────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', `http://localhost:${PORT}`);
  next();
});

// ─── API: 알림장 목록 ────────────────────────────────────────────
// GET /api/reports?page=1&limit=20&year=2026&month=03&q=검색어
app.get('/api/reports', async (req, res) => {
  try {
    const { page = 1, limit = 20, year, month, q } = req.query;
    const reportsDir = path.join(DOWNLOADS_DIR, '알림장');
    const items = await scanItems(reportsDir, { year, month, q });

    // 최신순 정렬
    items.sort((a, b) => b.date.localeCompare(a.date));

    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const paginated = items.slice(start, end);

    res.json({
      total: items.length,
      page: parseInt(page),
      limit: parseInt(limit),
      hasNext: end < items.length,
      items: paginated,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: 앨범 목록 ─────────────────────────────────────────────
app.get('/api/albums', async (req, res) => {
  try {
    const { page = 1, limit = 20, year, month, q } = req.query;
    const albumsDir = path.join(DOWNLOADS_DIR, '앨범');
    const items = await scanItems(albumsDir, { year, month, q });
    items.sort((a, b) => b.date.localeCompare(a.date));

    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const paginated = items.slice(start, end);

    res.json({
      total: items.length,
      page: parseInt(page),
      limit: parseInt(limit),
      hasNext: end < items.length,
      items: paginated,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: 항목 상세 (metadata.json 기반) ────────────────────────
app.get('/api/item', async (req, res) => {
  try {
    const { type = 'report', id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const baseDir = path.join(DOWNLOADS_DIR, type === 'album' ? '앨범' : '알림장');
    const itemPath = await findItemDir(baseDir, id);
    if (!itemPath) return res.status(404).json({ error: 'Item not found' });

    const metaFile = path.join(itemPath, 'metadata.json');
    const textFile = path.join(itemPath, '내용.txt');

    let metadata = {};
    if (await fs.pathExists(metaFile)) {
      metadata = await fs.readJson(metaFile);
    } else {
      // metadata.json이 없는 구버전 데이터: 텍스트 파일에서 추출
      metadata = await extractLegacyMetadata(itemPath, textFile);
    }

    // 사진 목록
    const photosDir = path.join(itemPath, 'photos');
    const photos = [];
    if (await fs.pathExists(photosDir)) {
      const photoFiles = await fs.readdir(photosDir);
      for (const f of photoFiles.sort()) {
        const relPath = path.relative(DOWNLOADS_DIR, path.join(photosDir, f)).replace(/\\/g, '/');
        photos.push(`/files/${relPath}`);
      }
    }

    // 영상 목록
    const videosDir = path.join(itemPath, 'videos');
    const videos = [];
    if (await fs.pathExists(videosDir)) {
      const videoFiles = await fs.readdir(videosDir);
      for (const f of videoFiles.sort()) {
        const relPath = path.relative(DOWNLOADS_DIR, path.join(videosDir, f)).replace(/\\/g, '/');
        videos.push(`/files/${relPath}`);
      }
    }

    res.json({ ...metadata, photos, videos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: 월별 통계 ──────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const reportsDir = path.join(DOWNLOADS_DIR, '알림장');
    const stats = await getMonthlyStats(reportsDir);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 메인 페이지 서빙 ────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─── 헬퍼: 폴더 스캔 (YYYY/MM 계층 지원) ────────────────────────
async function scanItems(baseDir, { year, month, q } = {}) {
  if (!(await fs.pathExists(baseDir))) return [];
  const items = [];

  const topEntries = await fs.readdir(baseDir);
  for (const topEntry of topEntries) {
    const topPath = path.join(baseDir, topEntry);
    const stat = await fs.stat(topPath);
    if (!stat.isDirectory()) continue;

    if (/^\d{4}$/.test(topEntry)) {
      // YYYY/ 계층
      if (year && topEntry !== year) continue;
      const monthEntries = await fs.readdir(topPath);
      for (const monthEntry of monthEntries) {
        if (month && monthEntry !== month) continue;
        const monthPath = path.join(topPath, monthEntry);
        if (!(await fs.stat(monthPath)).isDirectory()) continue;
        const folderItems = await scanSingleDir(monthPath, q);
        items.push(...folderItems);
      }
    } else {
      // 구버전 평면 구조 (폴더가 날짜-이름-ID 형식)
      const item = await buildItemFromFolder(topPath, topEntry);
      if (item) {
        if (year && !item.date.startsWith(year)) continue;
        if (month && item.date.slice(5, 7) !== month) continue;
        if (q && !item.title.includes(q) && !item.content?.includes(q)) continue;
        items.push(item);
      }
    }
  }
  return items;
}

async function scanSingleDir(monthPath, q) {
  const items = [];
  const folders = await fs.readdir(monthPath);
  for (const folder of folders) {
    const folderPath = path.join(monthPath, folder);
    if (!(await fs.stat(folderPath)).isDirectory()) continue;
    const item = await buildItemFromFolder(folderPath, folder);
    if (!item) continue;
    if (q && !item.title.includes(q) && !item.content?.includes(q)) continue;
    items.push(item);
  }
  return items;
}

async function buildItemFromFolder(folderPath, folderName) {
  const dateMatch = folderName.match(/^(\d{4}-\d{2}-\d{2})-(.+)-(\d+)$/);
  if (!dateMatch) return null;

  const [, date, title, id] = dateMatch;
  let metadata = {};

  const metaFile = path.join(folderPath, 'metadata.json');
  if (await fs.pathExists(metaFile)) {
    try {
      metadata = await fs.readJson(metaFile);
    } catch (e) { }
  }

  // 사진/영상 개수 빠른 확인
  let photoCount = 0;
  const photosDir = path.join(folderPath, 'photos');
  if (await fs.pathExists(photosDir)) {
    photoCount = (await fs.readdir(photosDir)).length;
  }

  // 썸네일: 첫 번째 사진 경로
  let thumbnail = null;
  if (photoCount > 0) {
    const photoFiles = await fs.readdir(photosDir);
    if (photoFiles.length > 0) {
      const relPath = path.relative(
        DOWNLOADS_DIR,
        path.join(photosDir, photoFiles.sort()[0])
      ).replace(/\\/g, '/');
      thumbnail = `/files/${relPath}`;
    }
  }

  return {
    id: parseInt(id) || id,
    date,
    title: metadata.title || title,
    author: metadata.author || '',
    content: metadata.content || '',
    photoCount: metadata.imageCount || photoCount,
    videoCount: metadata.videoCount || 0,
    commentCount: metadata.commentCount || 0,
    hasLifeRecord: !!(metadata.lifeRecord),
    thumbnail,
    folderPath: folderPath,
  };
}

async function findItemDir(baseDir, id) {
  if (!(await fs.pathExists(baseDir))) return null;
  const topEntries = await fs.readdir(baseDir);
  for (const topEntry of topEntries) {
    const topPath = path.join(baseDir, topEntry);
    if (!(await fs.stat(topPath)).isDirectory()) continue;

    if (/^\d{4}$/.test(topEntry)) {
      const monthEntries = await fs.readdir(topPath);
      for (const monthEntry of monthEntries) {
        const monthPath = path.join(topPath, monthEntry);
        if (!(await fs.stat(monthPath)).isDirectory()) continue;
        const folders = await fs.readdir(monthPath);
        for (const folder of folders) {
          if (folder.endsWith(`-${id}`)) return path.join(monthPath, folder);
        }
      }
    } else {
      if (topEntry.endsWith(`-${id}`)) return topPath;
    }
  }
  return null;
}

async function extractLegacyMetadata(folderPath, textFile) {
  let content = '';
  if (await fs.pathExists(textFile)) {
    content = await fs.readFile(textFile, 'utf-8');
  }
  const folderName = path.basename(folderPath);
  const dateMatch = folderName.match(/^(\d{4}-\d{2}-\d{2})-(.+)-(\d+)$/);
  return {
    id: dateMatch ? dateMatch[3] : '',
    date: dateMatch ? dateMatch[1] : '',
    title: dateMatch ? dateMatch[2] : folderName,
    content,
    lifeRecord: null,
    comments: [],
  };
}

async function getMonthlyStats(reportsDir) {
  const months = {};
  const items = await scanItems(reportsDir);
  for (const item of items) {
    const ym = item.date.slice(0, 7);
    if (!months[ym]) months[ym] = { count: 0, photos: 0 };
    months[ym].count++;
    months[ym].photos += item.photoCount || 0;
  }
  return months;
}

// ─── 포트 충돌 자동 해결 ─────────────────────────────────────────
async function killPortProcess(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
    const lines = result.split('\n').filter(l => l.includes('LISTENING'));
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[KAV] 포트 ${port}를 사용 중인 프로세스(PID: ${pid})를 종료했습니다.`);
      }
    }
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    // 포트 사용 중이 아님 (정상)
  }
}

async function startServer() {
  await killPortProcess(PORT);

  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════╗');
    console.log('  ║   🌟 My Diary Viewer (KAV)                 ║');
    console.log(`  ║   http://localhost:${PORT}                   ║`);
    console.log('  ╚═══════════════════════════════════════════╝');
    console.log('');
    console.log('  브라우저가 자동으로 열립니다...');
    console.log('  종료하려면 이 창을 닫으세요.');
    console.log('');

    // 브라우저 자동 실행
    setTimeout(() => {
      exec(`start http://localhost:${PORT}`);
    }, 800);
  });
}

startServer().catch(console.error);
