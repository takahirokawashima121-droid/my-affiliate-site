// 公開済みの記事1本の見どころを Claude API で試しに書き、今の見どころと並べてログに出す（ファイルは変えない・PR も作らない）
//
// 使い方:
//   npm run ai-highlight-test -- --slug=mega-sharpedo-ex-deck-0927
//   GitHub Actions の「AI highlight test (manual)」（.github/workflows/ai-highlight-test.yml）からも実行できる
//
// AI に渡すものは自動生成（scripts/auto-deck-updater.js）と同じ: デッキ名・60枚のレシピ・採用カードの公式テキスト
// （公式サイトのカード詳細。.cache/ にあれば再取得しない）。点検・1回だけの書き直し・呼び出し回数の上限も同じ。
// ANTHROPIC_API_KEY が必要（ない・エラーのときは理由を出して終了コード 1 で終わる）

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recipeProfiles } from './lib/game-plan.js';
import { AI_HIGHLIGHT_CONFIG, buildPrompt, createAiHighlighter, usageLines } from './lib/ai-highlight.js';

const ROOT = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));

async function main() {
  // ローカルでは .env の ANTHROPIC_API_KEY も使う（GitHub Actions では Secrets から環境変数で渡す）
  if (existsSync(path('.env'))) process.loadEnvFile(path('.env'));
  const slug = process.argv.find((a) => a.startsWith('--slug='))?.split('=')[1]?.trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('記事の slug を --slug=mega-sharpedo-ex-deck-0927 の形で指定してください（英小文字・数字・ハイフンのみ）');
  const columns = JSON.parse(await readFile(path('src/data/deck-columns.json'), 'utf8'));
  const recipes = JSON.parse(await readFile(path('src/data/official-decks.json'), 'utf8'));
  const column = columns.find((c) => c.slug === slug);
  if (!column) throw new Error(`slug「${slug}」の記事が src/data/deck-columns.json にありません`);
  const recipe = recipes[column.deckKey]?.cards;
  if (!recipe) throw new Error(`「${slug}」の60枚レシピ（official-decks.json の ${column.deckKey}）がありません`);
  const main = column.keyCards?.[0];
  if (!main) throw new Error(`「${slug}」に主力カード（keyCards）がありません`);

  console.log(`■ ${column.deckName}（/columns/${slug}/・${column.pubDate}）`);
  console.log('  採用カードの公式テキストを取得しています…');
  const profiles = await recipeProfiles(recipe);
  const namesOf = (c) => [...(recipes[c.deckKey]?.cards ?? []).map((e) => e.name), ...(c.keyCards ?? [])];
  // 書き出しを比べる相手: 同じ日のほかの記事（今の見どころ）
  const others = columns.filter((c) => c.pubDate === column.pubDate && c.slug !== slug).map((c) => ({ slug: c.slug, highlight: c.highlight, names: namesOf(c) }));
  const input = { deckName: column.deckName, main, recipe, profiles, names: namesOf(column), others };

  console.log('::group::AI に渡した内容');
  console.log(buildPrompt(input));
  console.log('::endgroup::');

  console.log(`\n■ AI で書く（モデル: ${AI_HIGHLIGHT_CONFIG.model}）`);
  const ai = createAiHighlighter({ log: (msg) => console.log(msg) });
  const r = await ai.write(input);

  console.log('\n■ 見どころの比較');
  console.log(`【今の見どころ】（${column.highlight.length}字）\n${column.highlight}\n`);
  console.log(r.text ? `【AIで作成】（${r.text.length}字・${r.attempts}回目で点検を通過）\n${r.text}` : `【AIで作成】作れませんでした（${r.reason}）。自動生成では従来の方法の見どころを使います`);
  console.log(`\n■ Claude API の使用量\n${usageLines(ai.stats).join('\n')}`);
  console.log('\n（試し書きのため、ファイルは変更していません）');
  // キーがない・API のエラーは失敗として知らせる（点検を通らなかったのは試し書きの結果なので成功扱い）
  if (!ai.stats.enabled || ai.stats.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
