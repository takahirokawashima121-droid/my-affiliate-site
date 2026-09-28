// デッキの60枚構成と公式のカードテキストから、「序盤・中盤・終盤」の立ち回りを自動で組み立てる
// scripts/auto-deck-updater.js（新しい記事）と scripts/backfill-game-plans.js（既存の記事への追記）から使う
//
// 方針: カードの役割はカード名ではなく公式のカードテキストから判定し（「山札から…たねポケモン」ならサーチ、など）、
// 効果の説明もカードテキストの最初の1文をそのまま使う。書いていない効果を推測で補わない。
// 文中のカード名は [[カード名]] の形で書き、表示側（src/components/GamePlan.astro）でカード詳細ページへのリンクにする。

import { cardProfile } from './official.js';

/** 採用カード（基本エネルギーをのぞく）の進化段階・HP・効果を、名前ごとに取得する（公式サイトへのアクセスはキャッシュつき・1.5秒間隔） */
export async function recipeProfiles(recipe) {
  const profiles = new Map();
  for (const e of recipe) {
    if (/^基本.+エネルギー$/.test(e.name) || profiles.has(e.name) || !e.officialCardId) continue;
    profiles.set(e.name, await cardProfile(e.officialCardId));
  }
  return profiles;
}

const ref = (name) => `[[${name}]]`;
const list = (names) => names.map(ref).join('・');
const qtyOf = (recipe, name) => recipe.filter((e) => e.name === name).reduce((s, e) => s + e.qty, 0);
const withQty = (recipe, names) => names.map((n) => `${ref(n)}（${qtyOf(recipe, n)}枚）`).join('・');
/**
 * カードテキストのうち、効果そのものを表す最初の1文。
 * 使える条件・回数の文（「〜1回使える。」「このカードは、〜しか使えない。」「この番、すでに〜使えない。」）は飛ばす
 */
const summary = (text) =>
  (text ?? '')
    .replace(/\n/g, '')
    .split('。')
    .map((s) => s.trim())
    .filter(Boolean)
    .find((s) => !/(1回|何回でも|自分の番に)[^。]*使える$|^このカードは、|^この番、すでに/.test(s)) ?? '';
/** 「（コスト・ダメージ：効果）」の中身 */
const attackDetail = (atk) => `${atk.cost}${atk.damage ? `・${atk.damage}` : ''}${summary(atk.text) ? `：${summary(atk.text)}` : ''}`;
/** ACE SPEC か（公式デッキの取り込み時に aceSpec、または note に「ACE SPEC」と記録される） */
const isAceSpec = (e) => Boolean(e.aceSpec) || /ACE SPEC/.test(e.note ?? '');
const damageOf = (attack) => Number(attack.damage?.match(/\d+/)?.[0] ?? 0);
/**
 * ワザの強さの目安。ダメージの数字がないワザでも、効果のあるワザ（「残りHPが50になるようにダメカンをのせる」など）は主力になりうるので高めに見る
 */
const attackScore = (attack) => damageOf(attack) || (attack.text ? 120 : 0);
/** いちばん強いワザ（同じ目安なら後ろのワザ。カードは2つ目のワザが主力のことが多い） */
const strongestAttack = (attacks) => attacks.reduce((best, a) => (!best || attackScore(a) >= attackScore(best) ? a : best), undefined);

/**
 * @param recipe  [{ name, qty, category, aceSpec? }]（src/data/official-decks.json の cards）
 * @param profiles recipeProfiles(recipe) の結果
 * @param main    主役のカード名（deck-columns.json の keyCards の先頭）
 * @returns { early: string[], mid: string[], end: string[] }（各要素が1段落）
 */
export function buildGamePlan(recipe, profiles, main) {
  const names = [...new Set(recipe.map((e) => e.name))];
  const cat = (n) => recipe.find((e) => e.name === n)?.category;
  const effects = (n) => profiles.get(n)?.effects ?? [];
  const textOf = (n) => effects(n).map((x) => x.text).join(' ');
  const pokemon = names.filter((n) => cat(n) === 'ポケモン' && profiles.has(n));
  const trainers = names.filter((n) => cat(n) !== 'ポケモン' && cat(n) !== 'エネルギー' && profiles.has(n));
  const byQty = (a, b) => qtyOf(recipe, b) - qtyOf(recipe, a);
  const matching = (pool, re) => pool.filter((n) => re.test(textOf(n))).sort(byQty);

  // ── 主役と進化ライン ──
  const topScore = (n) => Math.max(0, ...effects(n).filter((x) => x.kind === 'ワザ').map(attackScore));
  const mainName = pokemon.includes(main) ? main : [...pokemon].sort((a, b) => topScore(b) - topScore(a))[0];
  const mainProfile = profiles.get(mainName);
  const line = pokemon.filter((n) => n === mainName || (mainProfile?.line ?? []).includes(n));
  const lineBasics = line.filter((n) => profiles.get(n).stage === 'たね');
  const lineStage1 = line.filter((n) => profiles.get(n).stage === '1進化' && n !== mainName);
  const bestAttack = strongestAttack(effects(mainName).filter((x) => x.kind === 'ワザ'));

  // ── カードの役割（公式テキストから判定） ──
  const searchPokemon = matching(trainers, /山札から[^。]*ポケモン[^。]*(ベンチに出す|手札に加える)/);
  const searchSupporter = matching([...trainers, ...pokemon], /山札から[^。]*サポートを1枚/);
  const drawSupporters = trainers.filter((n) => cat(n) === 'サポート' && /山札を\d+枚引く/.test(textOf(n))).sort(byQty);
  const accel = [...pokemon, ...trainers].filter((n) => /(山札|トラッシュ)から[^。]*エネルギー[^。]*つける/.test(textOf(n)) && n !== mainName);
  const systemAbilities = pokemon
    .filter((n) => n !== mainName)
    .flatMap((n) => effects(n).filter((x) => x.kind === '特性' && /引く|手札に加える/.test(x.text)).map((x) => ({ card: n, ability: x })));
  const benchGuard = pokemon.filter((n) => /ベンチポケモン[^。]*ダメージを受けない/.test(textOf(n)));
  const gust = matching(trainers, /相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える/);
  // 呼び出し（gust）にも使えるカードは終盤の段落で紹介するので、入れ替え役からは外す
  const switchers = matching(trainers, /自分のバトルポケモンを(自分の)?ベンチポケモンと入れ替える|にげるためのエネルギーが/).filter((n) => !gust.includes(n));
  const aceSpec = names.filter((n) => recipe.some((e) => e.name === n && isAceSpec(e)) && cat(n) !== 'ポケモン');
  const disrupt = matching(trainers, /相手は[^。]*(手札|山札)|おたがいのプレイヤーは、それぞれ手札/).filter((n) => !aceSpec.includes(n));
  const boost = matching(trainers, /ダメージは「\+\d+」/);
  const recovery = matching(trainers, /自分のトラッシュから[^。]*(ポケモン|エネルギー)[^。]*手札に加える/);
  const stadiums = names.filter((n) => cat(n) === 'スタジアム').sort(byQty);
  const basicEnergy = recipe.filter((e) => /^基本.+エネルギー$/.test(e.name));
  const energyTotal = basicEnergy.reduce((s, e) => s + e.qty, 0);
  /** 「の特性「〇〇」（効果）」または「（効果）」。カード名の直後に続けて使う */
  const describe = (n, kind) => {
    const e = effects(n).find((x) => (kind ? x.kind === kind : true) && x.text);
    return e ? `${e.kind === '特性' ? ` の特性「${e.name}」` : ''}（${summary(e.text)}）` : '';
  };

  // ── 序盤（1〜2ターン目） ──
  const early = [];
  const mainIsBasic = profiles.get(mainName)?.stage === 'たね';
  const starters = lineBasics.length > 0 ? lineBasics : line;
  early.push(
    (mainIsBasic ? `まずは攻撃役の ${withQty(recipe, starters)} を優先して場に出します。` : `まずは主役の進化ラインの起点となる ${withQty(recipe, starters)} を優先してベンチに並べます。`) +
      (searchPokemon.length > 0 ? `${withQty(recipe, searchPokemon.slice(0, 3))} でたねポケモンや進化ポケモンを集め、` : '') +
      (lineStage1.length > 0 || profiles.get(mainName)?.stage !== 'たね' ? '2ターン目以降にすぐ進化できるよう、複数匹そろえておきましょう。' : '攻撃役を複数匹そろえて、倒されても次を出せるようにしておきましょう。'),
  );
  if (benchGuard.length > 0) early.push(`${ref(benchGuard[0])}${describe(benchGuard[0], '特性')}は、育てる前のベンチポケモンを守るために早めに出しておきたいポケモンです。`);
  if (accel.length > 0) {
    const a = accel[0];
    early.push(`エネルギーは、手札からの1枚に加えて ${ref(a)}${describe(a, cat(a) === 'ポケモン' ? '特性' : undefined)}で加速し、主役のワザに必要な数を早くそろえます。`);
  } else if (bestAttack) {
    early.push(
      `エネルギーの手貼りは、${ref(mainName)} のワザ「${bestAttack.name}」（${bestAttack.cost}）に必要な分を、${mainIsBasic ? '次に攻撃する' : '進化前の'}ポケモンに先につけておきます${energyTotal ? `（基本エネルギーは${energyTotal}枚採用）` : ''}。`,
    );
  }

  // ── 中盤（2〜4ターン目） ──
  const mid = [];
  if (bestAttack) {
    const via = lineStage1.length > 0 ? `${list(lineStage1)} を経由して ` : '';
    mid.push(`${via}${ref(mainName)} ${mainIsBasic ? 'をバトル場に出し' : 'に進化させ'}、ワザ「${bestAttack.name}」（${attackDetail(bestAttack)}）で攻撃します。`);
  }
  // 主役が特性を持つなら、それもデッキの軸として紹介する（ワザより特性が本命のポケモンもあるため）
  for (const a of effects(mainName).filter((x) => x.kind === '特性' && x.text))
    mid.push(`${ref(mainName)} の特性「${a.name}」（${summary(a.text)}）も、このデッキの動きの軸になります。`);
  // 主役以外で打点の高いワザを持つポケモン（サブアタッカー）
  const subAttackers = pokemon
    .filter((n) => !line.includes(n))
    .map((n) => ({ n, atk: strongestAttack(effects(n).filter((x) => x.kind === 'ワザ')) }))
    .filter(({ atk }) => atk && (damageOf(atk) >= 100 || /×/.test(atk.damage)))
    .slice(0, 2);
  for (const { n, atk } of subAttackers)
    mid.push(`相手に合わせて、${ref(n)} のワザ「${atk.name}」（${attackDetail(atk)}）も使い分けます。`);
  for (const s of systemAbilities.slice(0, 2)) mid.push(`${ref(s.card)} の特性「${s.ability.name}」（${summary(s.ability.text)}）で、手札とリソースを確保します。`);
  if (drawSupporters.length > 0 || searchSupporter.length > 0) {
    mid.push(
      (drawSupporters.length > 0 ? `サポートは ${withQty(recipe, drawSupporters.slice(0, 2))} で手札を入れ替えて必要なカードを引き、` : '') +
        (searchSupporter.length > 0 ? `${list(searchSupporter.slice(0, 2))} で状況に合ったサポートを探せます。` : '盤面を維持します。'),
    );
  }
  if (switchers.length > 0) mid.push(`${list(switchers.slice(0, 2))} でバトル場のポケモンを入れ替え、ダメージを受けたポケモンを下げたり、準備のできたアタッカーを前に出したりします。`);
  if (stadiums.length > 0)
    mid.push(`スタジアムは ${ref(stadiums[0])}${describe(stadiums[0])}${stadiums.length > 1 ? `・${list(stadiums.slice(1))}` : ''} を使います。新しいスタジアムを出すと場のスタジアムはトラッシュされるので、相手のスタジアムを流す手段にもなります。`);
  if (recovery.length > 0) mid.push(`倒されたポケモンや使ったエネルギーは ${list(recovery.slice(0, 2))} でトラッシュから回収し、攻撃の手を止めないようにします。`);

  // ── 終盤（サイドを取りきる） ──
  const end = [];
  if (gust.length > 0) end.push(`${withQty(recipe, gust)} で相手のベンチの倒しきれるポケモンや育ちかけのポケモンをバトル場に呼び出し、サイドを取りきる順番を組み立てます。`);
  if (boost.length > 0) end.push(`${list(boost.slice(0, 2))} でダメージを上乗せすれば、あと一歩届かないポケモンも倒せます。`);
  for (const a of aceSpec) {
    if (gust.includes(a)) {
      end.push(`呼び出しに使える ${ref(a)} はデッキに1枚しか入れられないACE SPECなので、サイドを取りきる番まで使いどころを見極めましょう。`);
    } else if (cat(a) === 'ポケモンのどうぐ') {
      end.push(`デッキに1枚しか入れられないACE SPECの ${ref(a)}${describe(a)}は、勝負を決めるアタッカーにつけて使いましょう。`);
    } else {
      end.push(`デッキに1枚しか入れられないACE SPECの ${ref(a)}${describe(a)}は、勝負を決める番に使えるよう温存しておきましょう。`);
    }
  }
  if (disrupt.length > 0) end.push(`${list(disrupt.slice(0, 2))} で相手の手札を減らし、逆転の手段を封じます。`);
  end.push('相手の残りのポケモンとサイドの枚数（ポケモンexは2枚、メガシンカポケモンexは3枚）を数え、残りのサイドを最短で取りきれる倒し方を選びましょう。');

  return { early, mid, end };
}
