/**
 * api/availability.js
 * Vercel Serverless Function
 * GET /api/availability → 全メンバーの空き時間JSONを返す
 *
 * キャッシュ戦略:
 * - Vercelのedge cacheで30分キャッシュ
 * - スクレイピング自体は重いので、本番ではcron jobで別途実行してKV/DBに保存推奨
 */

const { scrapeAll } = require('../lib/scraper');
const members = require('../members.config');

// シンプルなインメモリキャッシュ（Vercel Serverlessでは再起動でリセットされる）
// 本番運用では Vercel KV や Redis に置き換えてください
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30分

module.exports = async function handler(req, res) {
  // CORS設定（Notionやどこからでも呼べるように）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // キャッシュが有効な場合はキャッシュを返す
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, max-age=1800'); // 30分
    return res.status(200).json({
      ...cache,
      members: members.map(({ id, name, calName, color, bg, initial, timerexUrl }) => ({
        id, name, calName, color, bg, initial, timerexUrl
      })),
    });
  }

  try {
    // スクレイピング実行（時間がかかる）
    const data = await scrapeAll();
    cache = data;
    cacheTime = now;

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    return res.status(200).json({
      ...data,
      members: members.map(({ id, name, calName, color, bg, initial, timerexUrl }) => ({
        id, name, calName, color, bg, initial, timerexUrl
      })),
    });
  } catch (err) {
    console.error('スクレイピングエラー:', err);
    return res.status(500).json({
      error: 'スクレイピングに失敗しました',
      message: err.message,
    });
  }
};
