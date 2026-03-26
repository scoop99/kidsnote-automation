const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { sanitizeSegment } = require('./utils');
const { notify } = require('./notifier');

class KidsNoteDownloader {
  constructor(config) {
    this.config = config;
    // system 폴더 기준 상대 경로인 경우를 대비해 resolve (메인 폴더 기준 유지)
    this.downloadBase = path.resolve(__dirname, '../../', config.download_path || 'downloads');
  }

  async init() {
    await fs.ensureDir(this.downloadBase);
    // 로그는 system 폴더 내에 저장
    await fs.ensureDir(path.join(__dirname, '../logs'));
  }

  async getSyncLog(ym) {
    const logPath = path.join(__dirname, `../logs/sync-${ym}.json`);
    if (await fs.pathExists(logPath)) { return await fs.readJson(logPath); }
    return {};
  }

  async updateSyncLog(month, itemId, title, fileCount, commentCount, contentSize, type) {
    const logPath = path.join(__dirname, `../logs/sync-${month}.json`); // Adjusted to match existing log path logic
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
      else { if (item !== '내용.txt') count++; }
    }
    return count;
  }

  async findFolderById(basePath, itemId) {
    if (!(await fs.pathExists(basePath))) return null;
    const folders = await fs.readdir(basePath);
    for (const folder of folders) {
      if (folder.endsWith(`-${itemId}`)) return path.join(basePath, folder);
    }
    return null;
  }

  async renameFolder(oldPath, newPath) {
    if (oldPath === newPath) return;
    if (await fs.pathExists(oldPath)) {
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
      // 다운로드 완료 후 이름 변경
      await fs.move(tmpPath, targetPath, { overwrite: true });
    } catch (e) {
      // 실패 시 임시 파일 삭제
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
