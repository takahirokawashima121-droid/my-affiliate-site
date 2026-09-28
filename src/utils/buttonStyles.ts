// アフィリエイト導線ボタンの共通スタイル（工房の計器スイッチ風）

/** 上端のハイライト + 下端の影で押し込めるスイッチに見せる（押すと 1px 沈む） */
export const SWITCH_BASE =
  'shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_2px_0_rgb(0_0_0/0.45)] active:translate-y-px active:shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_1px_0_rgb(0_0_0/0.45)]';

/** メインの購入ボタン：作業灯のアンバー（濃い文字） */
export const SALE_PRIMARY = `${SWITCH_BASE} bg-amber-500 text-slate-950 hover:bg-amber-400 focus-visible:outline-amber-400`;

/** 控えめな購入ボタン（最安ではない側・検索）：ダークサーフェス + アンバーの細枠 */
export const SALE_SECONDARY = `${SWITCH_BASE} border border-amber-500/40 bg-slate-800/80 text-amber-400 hover:border-amber-400/70 hover:bg-amber-950/40 focus-visible:outline-amber-500`;
