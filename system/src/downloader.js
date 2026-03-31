const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { sanitizeSegment } = require('./utils');
const { notify } = require('./notifier');

class KidsNoteDownloader {
  constructor(config) {
    this.config = config;
    this.downloadBase = path.resolve(__dirname, '../../', config.download_path || 'downloads');
  }

  async init() {
    await fs.ensureDir(this.downloadBase);
    await fs.ensureDir(path.join(__dirname, '../logs'));
  }

  // 기존 평면 구조 → YYYY/MM 계층 구조 자동 마이그레이션
  async migrateToHierarchy(typeDir) {
    if (!(await fs.pathExists(typeDir))) return;

    const entries = await fs.readdir(typeDir);
    let migratedCount = 0;

    for (const entry of entries) {
      const fullPath = path.join(typeDir, entry);
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;

      // YYYY-MM-DD-... 형식인 경우만 마이그레이션 대상
      const dateMatch = entry.match(/^(\d{4})-(\d{2})-\d{2}/);
      if (!dateMatch) continue;

      const [, year, month] = dateMatch;
      const destDir = path.join(typeDir, year, month, entry);

      // 이미 계층 구조 안에 있으면 건너뜀
      if (fullPath === destDir) continue;

      await fs.ensureDir(path.join(typeDir, year, month));
      await fs.move(fullPath, destDir, { overwrite: false });
      migratedCount++;
    }

    if (migratedCount > 0) {
      console.log(`[MIGRATE] ${path.basename(typeDir)}: ${migratedCount}개 폴더를 연도/월별 구조로 이동했습니다.`);
    }
  }

  async getSyncLog(ym) {
    const logPath = path.join(__dirname, `../logs/sync-${ym}.json`);
    if (await fs.pathExists(logPath)) { return await fs.readJson(logPath); }
    return {};
  }

  async updateSyncLog(month, itemId, title, fileCount, commentCount, contentSize, type, hasMetadata = false, serverUpdatedAt = '') {
    const logPath = path.join(__dirname, `../logs/sync-${month}.json`);
    let log = {};
    if (await fs.pathExists(logPath)) {
      log = await fs.readJson(logPath);
    }
    log[itemId] = {
      title,
      date: new Date().toISOString().split('T')[0],
      fileCount,
      commentCount: commentCount || 0,
      contentSize: contentSize || 0,
      type,
      hasMetadata,         // [KAV] 메타데이터 생성 여부 기록
      serverUpdatedAt,     // [KAV] 서버측 글 최종 수정일시 (변경감지용)
      updatedAt: new Date().toISOString()
    };
    await fs.writeJson(logPath, log, { spaces: 2 });
  }

  async getLocalFileCount(dir) {
    if (!(await fs.pathExists(dir))) return 0;
    let count = 0;
    const items = await fs.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) { count += await this.getLocalFileCount(fullPath); }
      else { if (item !== '내용.txt' && item !== 'metadata.json') count++; }
    }
    return count;
  }

  // YYYY/MM 계층 구조에서 ID로 폴더 찾기
  async findFolderById(baseDir, itemId) {
    if (!(await fs.pathExists(baseDir))) return null;

    const topEntries = await fs.readdir(baseDir);
    for (const yearEntry of topEntries) {
      const yearPath = path.join(baseDir, yearEntry);
      if (!(await fs.stat(yearPath)).isDirectory()) continue;
      if (!/^\d{4}$/.test(yearEntry)) {
        // 구 버전 평면 구조: 직접 ID 확인
        if (yearEntry.endsWith(`-${itemId}`)) return yearPath;
        continue;
      }

      const monthEntries = await fs.readdir(yearPath);
      for (const monthEntry of monthEntries) {
        const monthPath = path.join(yearPath, monthEntry);
        if (!(await fs.stat(monthPath)).isDirectory()) continue;

        const folders = await fs.readdir(monthPath);
        for (const folder of folders) {
          if (folder.endsWith(`-${itemId}`)) return path.join(monthPath, folder);
        }
      }
    }
    return null;
  }

  // YYYY/MM 계층 구조의 타입 기반 대상 폴더 경로 반환
  getTargetDir(baseDir, dateStr, folderName) {
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(5, 7);
    return path.join(baseDir, year, month, folderName);
  }

  async renameFolder(oldPath, newPath) {
    if (oldPath === newPath) return;
    if (await fs.pathExists(oldPath)) {
      await fs.ensureDir(path.dirname(newPath));
      await fs.move(oldPath, newPath);
    }
  }

  async downloadFile(url, targetPath) {
    const tmpPath = `${targetPath}.tmp`;
    try {
      await fs.ensureDir(path.dirname(targetPath));
      const response = await axios({ method: 'get', url: url, responseType: 'stream', timeout: 30000 });
      const writer = fs.createWriteStream(tmpPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      await fs.move(tmpPath, targetPath, { overwrite: true });
    } catch (e) {
      if (await fs.pathExists(tmpPath)) {
        await fs.remove(tmpPath).catch(() => {});
      }
      throw e;
    }
  }

  async backupOldFolder(dir) {
    if (await fs.pathExists(dir)) {
      const backupDir = `${dir}_old_${Date.now()}`;
      await fs.move(dir, backupDir);
    }
  }
}
module.exports = KidsNoteDownloader;
