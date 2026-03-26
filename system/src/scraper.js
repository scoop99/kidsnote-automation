const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const { notify } = require('./notifier');

// system 폴더 내에 위치하게 됨
const SESSION_FILE = path.join(__dirname, '../session.json');

class KidsNoteScraper {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isLoggedIn = false;
    this.detectedUrls = { album: null, report: null, activities: null, records: null, centerId: null };
  }

  async init(headless = true) {
    this.browser = await chromium.launch({ headless, slowMo: 100 });
    
    let storageState = null;
    if (fs.existsSync(SESSION_FILE)) {
      try { storageState = await fs.readJson(SESSION_FILE); } catch (e) {}
    }

    this.context = await this.browser.newContext({ 
      storageState,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    this.page = await this.context.newPage();

    this.page.on('request', request => {
      const url = request.url();
      if (url.includes('kidsnote.com/api/v1')) {
        const centerMatch = url.match(/\/centers\/(\d+)/);
        if (centerMatch) this.detectedUrls.centerId = centerMatch[1];
        if (url.includes('/albums/')) this.detectedUrls.album = url.split('?')[0];
        if (url.includes('/reports/')) this.detectedUrls.report = url.split('?')[0];
        if (url.includes('/activities/')) this.detectedUrls.activities = url.split('?')[0];
        if (url.includes('/records/posts')) this.detectedUrls.records = url.split('?')[0];
      }
    });

    this.page.on('response', async response => {
      const url = response.url();
      if (url.includes('kidsnote.com/api/')) {
        try {
          const status = response.status();
          if (status === 200) {
            const json = await response.json();
            const count = json.count || (json.results?.length || 0) || (json.activities?.length || 0) || (json.notices?.length || 0);
            if (count > 0) { /* silence working api log */ }
          }
        } catch (e) {}
      }
    });
  }

  async checkLogin() {
    console.log('[AUTH] 로그인 상태 확인 중...');
    await this.page.goto('https://www.kidsnote.com/login/', { waitUntil: 'domcontentloaded' });
    const currentUrl = this.page.url();
    const hasLoginForm = await this.page.$('input[name="username"]');
    if (!hasLoginForm || currentUrl.includes('/service/') || currentUrl === 'https://www.kidsnote.com/') {
      this.isLoggedIn = true;
      return true;
    }
    this.isLoggedIn = false;
    return false;
  }

  async performManualLogin() {
    notify('로그인 필요', '최초 1회 수동 로그인이 필요합니다. 브라우저 창에서 로그인해 주세요.', 'warn');
    await this.close();
    await this.init(false);
    await this.page.goto('https://www.kidsnote.com/login/');
    let loginDetected = false;
    while (!loginDetected) {
      const url = this.page.url();
      const cookies = await this.context.cookies();
      const hasSession = cookies.some(c => c.name === 'sessionid');
      if (!url.includes('/login/') && url.includes('kidsnote.com') && hasSession) {
        loginDetected = true;
      } else {
        await this.page.waitForTimeout(1000);
      }
    }
    await this.page.waitForTimeout(3000);
    const state = await this.context.storageState();
    await fs.writeJson(SESSION_FILE, state, { spaces: 2 });
    this.isLoggedIn = true;
  }

  async getChildInfo() {
    console.log('[AUTH] 아이 세션 정보 초기화 중...');
    const response = await this.context.request.get('https://www.kidsnote.com/api/v1/me/info/');
    const json = await response.json();
    const child0 = json.children && json.children[0];
    const childId = json.child_id || json.childId || json.current_child_id || child0?.id;
    const enrollment0 = Array.isArray(child0?.enrollment) ? child0.enrollment[0] : child0?.enrollment;
    const centerId = json.center_id || enrollment0?.center_id || child0?.center_id || this.detectedUrls.centerId;
    const classId = child0?.class_id || enrollment0?.class_id || enrollment0?.belong_to_class;
    await this.page.goto('https://www.kidsnote.com/service/album/', { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(5000);
    await this.page.goto('https://www.kidsnote.com/service/report/', { waitUntil: 'networkidle' });
    await this.page.waitForTimeout(5000);
    return { childId, centerId, classId, name: child0?.name || 'Unknown' };
  }

  async fetchApi(url) {
    return await this.page.evaluate(async (fetchUrl) => {
      try {
        const r = await fetch(fetchUrl);
        if (!r.ok) return { ok: false, status: r.status };
        const text = await r.text();
        if (!text || text.trim() === '') return { ok: true, json: {} };
        const json = JSON.parse(text);
        return { ok: true, json };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, url);
  }

  async close() { if (this.browser) await this.browser.close(); }
}
module.exports = KidsNoteScraper;
