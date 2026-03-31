/**
 * Utility functions for KidsNote Automation
 */

const path = require('path');

/**
 * Make a filesystem-safe segment across platforms.
 * Ported from extension's sw.js
 */
function sanitizeSegment(s, maxLen = 50) {
  let out = (s || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Windows disallows trailing dot/space
  out = out.replace(/[\.\s]+$/g, '');
  
  if (!out) out = 'untitled';
  return out.slice(0, maxLen);
}

/**
 * Format elapsed time in m:ss
 */
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

/**
 * Get current year-month (YYYY-MM)
 */
function getCurrentYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format date string to KST (YYYY-MM-DD HH:mm:ss)
 */
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

module.exports = {
  sanitizeSegment,
  fmtElapsed,
  getCurrentYM,
  formatDateKST
};
