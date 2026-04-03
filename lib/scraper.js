/**
 * lib/scraper.js
 * Playwrightを使ってTimerexの各メンバーページから
 * 空き時間スロットを取得してJSONで返す
 */

const { chromium } = require('playwright');
const members = require('../members.config');

/**
 * 1名分のTimerexページをスクレイピングして空き時間を返す
 * @param {object} member - membersの1エントリ
 * @returns {Array} [{ date: '2026-04-07', time: '10:00', datetime: '2026-04-07T10:00' }, ...]
 */
async function scrapeOneMember(browser, member) {
  const page = await browser.newPage();
  const slots = [];

  try {
    console.log(`  → ${member.name} をスクレイピング中... ${member.timerexUrl}`);
    await page.goto(member.timerexUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Timerexは動的レンダリング。空きスロットが表示されるまで待機
    // 空きスロットは緑色のボタン（グレーアウトされていないもの）
    await page.waitForSelector('[class*="slot"], [class*="time"], button', { timeout: 15000 }).catch(() => {});

    // ページ全体のHTMLを取得してスロットを解析
    // ※ Timerexのクラス名は変わる可能性があるため、複数パターンで試みる
    const rawSlots = await page.evaluate(() => {
      const results = [];

      // パターン1: data-* 属性でdatetimeが取れる場合
      document.querySelectorAll('[data-datetime], [data-slot-datetime]').forEach(el => {
        const dt = el.dataset.datetime || el.dataset.slotDatetime;
        const isDisabled = el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true';
        if (dt && !isDisabled) results.push({ datetime: dt, source: 'data-attr' });
      });

      // パターン2: ボタンのテキストから時間を読み取る（フォールバック）
      if (results.length === 0) {
        // 日付ヘッダーと時間スロットの組み合わせを探す
        const cells = document.querySelectorAll('button:not(:disabled), [role="button"]:not([aria-disabled="true"])');
        cells.forEach(el => {
          const text = el.textContent.trim();
          // "10:00" や "10:00 - 10:30" の形式を検出
          if (/^\d{1,2}:\d{2}/.test(text)) {
            // 親要素から日付を探す
            let parent = el.parentElement;
            let dateStr = null;
            for (let i = 0; i < 5; i++) {
              if (!parent) break;
              const dateEl = parent.querySelector('[class*="date"], [class*="day"], time');
              if (dateEl) { dateStr = dateEl.textContent.trim(); break; }
              parent = parent.parentElement;
            }
            results.push({ time: text.split(' ')[0], dateHint: dateStr, source: 'button-text' });
          }
        });
      }

      return results;
    });

    // 取得結果をノーマライズ
    const today = new Date();
    rawSlots.forEach(s => {
      if (s.datetime) {
        // ISO形式 or "2026/04/07 10:00" 形式
        const normalized = s.datetime.replace(/\//g, '-').replace(' ', 'T');
        slots.push(normalized);
      } else if (s.time) {
        // 日付が特定できない場合は今日から7日以内として扱う（要改善）
        // 実際のTimerexページのHTML構造に合わせて調整が必要
        console.log(`    ℹ 日付不明のスロット: ${s.time} (要HTML確認)`);
      }
    });

    // スロットが0件の場合、HTML構造確認用のログを出す
    if (slots.length === 0) {
      console.log(`    ⚠ スロットが取得できませんでした。以下を確認してください:`);
      console.log(`      1. URLが正しいか: ${member.timerexUrl}`);
      console.log(`      2. ページが公開されているか`);
      console.log(`      3. lib/scraper.js のセレクタを実際のHTML構造に合わせて調整`);

      // デバッグ用: スクリーンショットを保存
      await page.screenshot({ path: `debug_${member.id}.png` });
      console.log(`      📸 debug_${member.id}.png にスクリーンショットを保存しました`);
    }

  } catch (err) {
    console.error(`  ✗ ${member.name} のスクレイピングに失敗:`, err.message);
  } finally {
    await page.close();
  }

  return slots;
}

/**
 * 全メンバーの空き時間を並列取得してマージする
 * @returns {object} { lastUpdated, slots: { 'datetime': [memberId, ...] } }
 */
async function scrapeAll() {
  console.log('🔍 Timerexスクレイピング開始...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // 全メンバーを並列スクレイピング（負荷軽減のため2並列）
  const CONCURRENCY = 2;
  const allResults = {};
  members.forEach(m => { allResults[m.id] = []; });

  for (let i = 0; i < members.length; i += CONCURRENCY) {
    const batch = members.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(m => scrapeOneMember(browser, m)));
    batch.forEach((m, idx) => { allResults[m.id] = results[idx]; });
  }

  await browser.close();

  // スロットごとに「誰が空いているか」の逆インデックスを作成
  // { '2026-04-07T10:00': [1, 3, 5], '2026-04-07T10:30': [2, 4] }
  const slotMap = {};
  Object.entries(allResults).forEach(([memberId, slots]) => {
    slots.forEach(dt => {
      if (!slotMap[dt]) slotMap[dt] = [];
      slotMap[dt].push(Number(memberId));
    });
  });

  const result = {
    lastUpdated: new Date().toISOString(),
    slots: slotMap,
    memberCount: members.length,
  };

  console.log(`✅ 完了。${Object.keys(slotMap).length} スロット取得`);
  return result;
}

// スクリプトとして直接実行した場合のテスト
if (require.main === module) {
  scrapeAll().then(r => {
    console.log('\n結果:');
    console.log(JSON.stringify(r, null, 2));
  }).catch(console.error);
}

module.exports = { scrapeAll };
