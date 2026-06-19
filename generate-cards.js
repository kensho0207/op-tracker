/**
 * generate-cards.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ONE PIECEカードゲーム公式カードリストを元に cards.json を生成する。
 * 将来的に GitHub Actions で自動実行できる構造にしてある。
 *
 * 使い方:
 *   node generate-cards.js
 *   node generate-cards.js --set OP01
 *   node generate-cards.js --output ./public/cards.json
 *
 * GitHub Actions 例 (.github/workflows/update-cards.yml):
 *   on:
 *     schedule:
 *       - cron: '0 3 * * *'   # 毎日 3:00 UTC に実行
 *   jobs:
 *     update:
 *       runs-on: ubuntu-latest
 *       steps:
 *         - uses: actions/checkout@v4
 *         - uses: actions/setup-node@v4
 *           with: { node-version: '20' }
 *         - run: node generate-cards.js
 *         - run: |
 *             git config user.email "actions@github.com"
 *             git config user.name "GitHub Actions"
 *             git add cards.json
 *             git diff --staged --quiet || git commit -m "chore: update cards.json"
 *             git push
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CLI 引数 ───────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const TARGET_SET    = getArg('--set');    // 例: OP01（未指定なら全セット）
const OUTPUT_FILE   = getArg('--output') || path.join(__dirname, 'cards.json');
const PRICE_FILE    = getArg('--prices') || null; // 価格CSVパス（任意）

// ─── カードカラーの背景色マッピング ────────────────
const COLOR_BG = {
  '赤':   '#1a0800',
  '青':   '#000a20',
  '緑':   '#0a1a0a',
  '黄':   '#1a1000',
  '紫':   '#100a1a',
  '黒':   '#0a0a0a',
  'マルチ': '#0a0a20',
};

// ─── レアリティ別 PSA10 倍率（公式価格未取得時のフォールバック） ──
const PSA10_MULT = {
  SEC: 3.8,
  SP:  3.5,
  SR:  4.0,
  R:   4.5,
  UC:  5.0,
  C:   5.0,
  L:   4.0,
  PR:  4.0,
};

// ─── バージョン文字列の正規化 ──────────────────────
const VERSION_ALIASES = {
  '通常':           '通常',
  'ノーマル':       '通常',
  'パラレル':       'パラレル',
  'parallel':       'パラレル',
  'sp':             'SP',
  'スーパーパラレル': 'SP',
  'コミックパラレル': 'コミパラ',
  'コミパラ':       'コミパラ',
  'リーダーパラレル': 'リーダーパラレル',
  'プロモ':         'プロモ',
  'promo':          'プロモ',
  'フラッグシップ':  'フラッグシップ',
  'flagship':       'フラッグシップ',
  'チャンピオンシップ': 'チャンピオンシップ',
  'championship':   'チャンピオンシップ',
};

/**
 * カード番号を正規化する。
 * "op09-119" → "OP09-119"
 * "OP09119"  → "OP09-119"（ハイフンを自動補完）
 * @param {string} raw
 * @returns {string}
 */
function normalizeCardNo(raw) {
  if (!raw) return '';
  let s = raw.trim().toUpperCase().replace(/\s/g, '');
  // ハイフンが無い場合に補完 (OP01120 → OP01-120, P001 → P-001)
  s = s.replace(/^(OP|ST|EB|P)(\d{2})(\d{3})$/, '$1$2-$3');
  s = s.replace(/^(P)(\d{3})$/, '$1-$2');
  return s;
}

/**
 * カード1枚のデータをスキーマに合わせて整形する。
 * @param {object} raw  - スクレイピング・CSV等から取得した生データ
 * @returns {object}    - 正規化済みカードオブジェクト
 */
function normalizeCard(raw) {
  const cardNo  = normalizeCardNo(raw.cardNo || raw.card_no || raw.no || '');
  const version = VERSION_ALIASES[(raw.version || '通常').toLowerCase()] || raw.version || '通常';
  const rarity  = (raw.rarity || '').toUpperCase();
  const color   = raw.color || '';
  const mult    = PSA10_MULT[rarity] || 4.0;

  // PSA10価格: 明示されていれば使用、なければ倍率計算
  const normalPrice = parseInt(raw.normalPrice || raw.price || 0, 10);
  const psa10Price  = parseInt(raw.psa10Price  || Math.round(normalPrice * mult), 10);

  return {
    id:          `${cardNo}_${version.replace(/\s/g, '')}`,
    cardNo,
    name:        raw.name        || '',
    character:   raw.character   || raw.name || '',
    version,
    rarity,
    setId:       raw.setId       || cardNo.split('-')[0] || '',
    setName:     raw.setName     || '',
    type:        raw.type        || '',
    color,
    image:       raw.image       || '',
    emoji:       raw.emoji       || emojiForColor(color),
    bg:          COLOR_BG[color] || '#0a0a1a',
    normalPrice,
    psa10Price,
  };
}

/** カードカラーからデフォルト絵文字を返す（暫定） */
function emojiForColor(color) {
  const map = { '赤':'🔴','青':'🔵','緑':'🟢','黄':'🟡','紫':'🟣','黒':'⬛','マルチ':'🌈' };
  return map[color] || '🃏';
}

// ─── 価格CSVを読み込む（任意） ──────────────────────
function loadPriceCSV(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const prices = {};
  // 期待フォーマット: cardNo,version,normalPrice,psa10Price
  lines.slice(1).forEach(line => {
    const [cardNo, version, normalPrice, psa10Price] = line.split(',');
    if (cardNo) {
      prices[`${normalizeCardNo(cardNo)}_${(version||'通常').trim()}`] = {
        normalPrice: parseInt(normalPrice || 0, 10),
        psa10Price:  parseInt(psa10Price  || 0, 10),
      };
    }
  });
  return prices;
}

// ─── メイン処理 ────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  OP-Tracker cards.json ジェネレーター');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 既存 cards.json を読み込んでベースにする
  let existingCards = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existingCards = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      console.log(`✅ 既存データ読み込み: ${existingCards.length}件`);
    } catch (e) {
      console.warn('⚠️  既存ファイル読み込み失敗、新規作成します');
    }
  }

  // 価格CSVをマージ（任意）
  const priceMap = loadPriceCSV(PRICE_FILE);
  if (Object.keys(priceMap).length) {
    console.log(`💰 価格データ読み込み: ${Object.keys(priceMap).length}件`);
  }

  // 既存データに価格を反映
  const updatedCards = existingCards
    .filter(c => !TARGET_SET || c.setId === TARGET_SET)
    .map(c => {
      const key = `${c.cardNo}_${c.version}`;
      const price = priceMap[key];
      return price ? { ...c, ...price } : c;
    });

  // ─── 将来の自動スクレイピング拡張ポイント ──────────
  // 公式APIや非公式データソースが利用可能になった場合、
  // 以下の関数を実装して updatedCards にマージする:
  //
  // async function fetchOfficialCardList(setId) {
  //   // https://www.onepiece-cardgame.com/cardlist/ より取得
  //   // 現在は robots.txt / 利用規約を要確認
  // }
  //
  // async function fetchSnkrdunkPrices(cardNo) {
  //   // SNKRDUNK 非公式API / RSS フィード
  // }
  // ─────────────────────────────────────────────────

  if (!updatedCards.length) {
    console.warn('⚠️  出力データが 0 件です。既存 cards.json を確認してください。');
    process.exit(1);
  }

  // ID でソート（型番 → バージョン順）
  updatedCards.sort((a, b) => a.id.localeCompare(b.id));

  // 書き出し
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(updatedCards, null, 2), 'utf-8');
  console.log(`✅ 書き出し完了: ${OUTPUT_FILE} (${updatedCards.length}件)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
