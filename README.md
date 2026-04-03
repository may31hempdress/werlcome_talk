# Timerex 複数人空き時間まとめ予約システム

複数名のTimerexから空き時間を自動取得し、
「誰かしら空いている時間帯」をカレンダー表示→ワンクリック予約できるWebアプリです。

---

## フォルダ構成

```
timerex-availability/
├── members.config.js   ← ★ ここだけ編集（メンバーのURL・名前）
├── lib/
│   └── scraper.js      ← Playwrightスクレイパー本体
├── api/
│   └── availability.js ← Vercel APIエンドポイント
├── public/
│   └── index.html      ← お客様向けUI
├── vercel.json         ← Vercel設定
└── package.json
```

---

## セットアップ手順（初回のみ・約15分）

### ステップ1: GitHubにアップロード

1. [github.com](https://github.com) でアカウント作成（無料）
2. 「New repository」でリポジトリを作成（名前は何でもOK）
3. このフォルダをまるごとアップロード

### ステップ2: メンバー情報を編集

`members.config.js` を開いて、7名分の情報を入力してください：

```js
{
  id: 1,
  name: '田中 美咲',           // お客様に表示される名前
  calName: 'Misaki Tanaka',     // TimerexのカレンダーID（任意）
  timerexUrl: 'https://timerex.net/s/xxxxxx', // ← 実際のURLに変更！
  color: '#534AB7',             // アバターの文字色
  bg: '#EEEDFE',                // アバターの背景色
  initial: '田',                // アバターに表示される1文字
},
```

### ステップ3: Vercelにデプロイ

1. [vercel.com](https://vercel.com) でアカウント作成（GitHub連携・無料）
2. 「New Project」→ GitHubリポジトリを選択
3. 「Deploy」ボタンを押すだけ！

数分後に `https://あなたのプロジェクト名.vercel.app` というURLが発行されます。

### ステップ4: NotionにURLを貼る

発行されたURLをNotionページに貼るだけで完成です。

---

## スクレイパーの動作確認

ローカルで動作確認する場合：

```bash
npm install
npx playwright install chromium
node lib/scraper.js
```

`debug_1.png` 〜 `debug_7.png` にスクリーンショットが保存されます。
スロットが取得できない場合は、スクリーンショットを見ながら `lib/scraper.js` の
セレクタ部分を調整してください。

---

## よくある問題

**Q: スロットが0件になる**
→ Timerexのページ構造に合わせてセレクタを調整が必要です。
`node lib/scraper.js` を実行すると `debug_X.png` が保存されるので、
そのHTMLを確認してセレクタを更新してください。

**Q: Vercelでタイムアウトになる**
→ Serverless Functionの実行時間制限（10秒）があります。
本番では、外部cronサービス（cron-job.org等）で定期的にスクレイピングして
Vercel KVにキャッシュする方式を推奨します。

**Q: 空き時間の更新頻度は？**
→ `api/availability.js` の `CACHE_TTL` で設定できます（デフォルト30分）。

---

## カスタマイズ

- **色変更**: `members.config.js` の `color` / `bg` を変更
- **時間帯変更**: `public/index.html` の `TIMES_30MIN` 配列を編集
- **タイトル変更**: `public/index.html` の `<title>` と `<h1>` を編集
