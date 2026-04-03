/**
 * api/availability.js
 * Vercel Serverless Function
 * Playwrightなし版 - node-fetchでHTTP取得 + 正規表現でスロット抽出
 */

const members = require('../members.config');

// Node 18以上はfetch組み込み済み。それ以下の場合はnode-fetchを使用
const fetchFn = globalThis.fetch || require('node-fetch');

// インメモリキャッシュ（30分）
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

/**
 * 1名分のTimerexページから空きスロットを取得
 */
async function fetchSlots(member) {
  try {
    const res = await fetchFn(member.timerexUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`${member.name}: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();

    // TimerexのHTMLからスロット情報を抽出
    // 方法1: JSON埋め込みデータを探す（__NEXT_DATA__ や window.__data__ など）
    const slots = [];

    // Next.jsのビルドデータからスロット情報を取得
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Timerexのデータ構造を再帰的に探索
        const extracted = extractSlotsFromObj(nextData);
        slots.push(...extracted);
      } catch (e) {
        console.error(`${member.name}: JSON parse error`, e.message);
      }
    }

    // 方法2: HTMLから直接日時パターンを正規表現で抽出
    if (slots.length === 0) {
      // "2026-04-07T10:00" や "2026/04/07 10:00" 形式を探す
      const dtPattern = /(\d{4}[-\/]\d{2}[-\/]\d{2})[T\s](\d{2}:\d{2})/g;
      let m;
      const seen = new Set();
      while ((m = dtPattern.exec(html)) !== null) {
        const dt = m[1].replace(/\//g, '-') + 'T' + m[2];
        if (!seen.has(dt)) {
          seen.add(dt);
          // 未来の日時のみ
          if (new Date(dt) > new Date()) slots.push(dt);
        }
      }
    }

    console.log(`${member.name}: ${slots.length}スロット取得`);
    return slots;

  } catch (err) {
    console.error(`${member.name}: fetch失敗`, err.message);
    return [];
  }
}

/**
 * オブジェクトを再帰的に探索してdatetime文字列を抽出
 */
function extractSlotsFromObj(obj, depth = 0) {
  if (depth > 10) return [];
  const results = [];
  if (!obj || typeof obj !== 'object') return results;

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      // ISO形式の日時文字列を検出
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val) && new Date(val) > new Date()) {
        results.push(val.substring(0, 16)); // YYYY-MM-DDTHH:MM
      }
    } else if (typeof val === 'object') {
      results.push(...extractSlotsFromObj(val, depth + 1));
    }
  }
  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(buildResponse(cache));
  }

  try {
    // 全メンバーを並列取得（2並列）
    const CONCURRENCY = 2;
    const allResults = {};
    members.forEach(m => { allResults[m.id] = []; });

    for (let i = 0; i < members.length; i += CONCURRENCY) {
      const batch = members.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(m => fetchSlots(m)));
      batch.forEach((m, idx) => { allResults[m.id] = results[idx]; });
    }

    // スロットマップを作成
    const slotMap = {};
    Object.entries(allResults).forEach(([memberId, slots]) => {
      slots.forEach(dt => {
        if (!slotMap[dt]) slotMap[dt] = [];
        slotMap[dt].push(Number(memberId));
      });
    });

    const data = { lastUpdated: new Date().toISOString(), slots: slotMap };
    cache = data;
    cacheTime = now;

    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(buildResponse(data));

  } catch (err) {
    console.error('エラー:', err);
    return res.status(500).json({ error: err.message });
  }
};

function buildResponse(data) {
  return {
    ...data,
    members: members.map(({ id, name, calName, color, bg, initial, timerexUrl }) => ({
      id, name, calName, color, bg, initial, timerexUrl
    })),
  };
}
