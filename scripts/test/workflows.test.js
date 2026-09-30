// .github/workflows/ の YAML の書き方のテスト（npm test）
// 書き方の誤りがあると、GitHub はそのワークフローを読めず、名前の代わりにファイル名で出し、push のたびに失敗した実行を作る
// （例: 引用符で囲まない ${{ }} の中に「content: …」のような「: 」があると、YAML がキーと読み違える）。
// YAML の読み取りは yaml パッケージ（@astrojs/check と一緒に入っている）を使う

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parseDocument } from 'yaml';

const dir = new URL('../../.github/workflows/', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

test('ワークフローのファイルがある', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`${file}: YAML として読めて、名前・実行のきっかけ・ジョブがある`, () => {
    const doc = parseDocument(readFileSync(new URL(file, dir), 'utf8'));
    assert.deepEqual(
      [...doc.errors, ...doc.warnings].map((e) => e.message.split('\n')[0]),
      [],
      `${file} の YAML の書き方に誤りがあります`,
    );
    const workflow = doc.toJS();
    assert.equal(typeof workflow.name, 'string', `${file} に name がありません`);
    assert.ok(workflow.on && typeof workflow.on === 'object', `${file} に on がありません`);
    assert.ok(workflow.jobs && Object.keys(workflow.jobs).length > 0, `${file} に jobs がありません`);
  });
}

test('AI highlight rewrite (manual): 「やること」の入力欄と、PR の題名・ブランチの切り替え', () => {
  const workflow = parseDocument(readFileSync(new URL('ai-highlight-rewrite.yml', dir), 'utf8')).toJS();
  assert.equal(workflow.name, 'AI highlight rewrite (manual)');
  // 手動実行だけ（push では動かない）
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const { mode } = workflow.on.workflow_dispatch.inputs;
  assert.equal(mode.type, 'choice');
  assert.deepEqual(mode.options, ['すべて書き直す', '要確認の記事だけ直す', 'ひとことだけ作る', 'ひとことがまだない記事だけ作る']);
  const pr = workflow.jobs.rewrite.steps.find((s) => s.name === 'Create pull request').with;
  for (const key of ['branch', 'title', 'commit-message']) assert.match(pr[key], /^\$\{\{ github\.event\.inputs\.mode == '要確認の記事だけ直す' && .+ \}\}$/, key);
  assert.match(pr.title, /'content: 公開済みデッキ記事の見どころのうち、要確認の記事だけを Claude API で直す'/);
  // 「ひとことだけ作る」「ひとことがまだない記事だけ作る」は auto/ai-tagline ブランチの PR にし、--tagline-only で実行する
  assert.match(pr.branch, /startsWith\(github\.event\.inputs\.mode, 'ひとこと'\) && 'auto\/ai-tagline'/);
  assert.match(pr.title, /'content: 公開済みデッキ記事の一覧のひとことを Claude API で作成'/);
  const run = workflow.jobs.rewrite.steps.find((s) => s.name === 'Rewrite highlights with Claude API').run;
  assert.match(run, /\[ "\$MODE" = 'ひとことだけ作る' \]; then\s+npm run ai-highlight-rewrite -- --tagline-only --limit="\$LIMIT"/);
  // 「ひとことがまだない記事だけ作る」は --tagline-missing も付ける（書けたひとことは変えない）
  assert.match(run, /\[ "\$MODE" = 'ひとことがまだない記事だけ作る' \]; then\s+npm run ai-highlight-rewrite -- --tagline-only --tagline-missing --limit="\$LIMIT"/);
  // PR に入れるのは deck-columns.json だけ（レシピ・価格・カードのデータは変えない）
  assert.equal(pr['add-paths'].trim(), 'src/data/deck-columns.json');
});
