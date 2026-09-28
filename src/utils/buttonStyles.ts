// アフィリエイト導線ボタンの共通スタイル（ホワイトラボの操作パネル風）

/** 白地で立体感を出すクリーンな影（押すと 1px 沈む） */
export const SWITCH_BASE = 'shadow-sm active:translate-y-px active:shadow-none';

/** メインの購入ボタン：インダストリアルオレンジ（白文字。明るい地でも読めるよう薄い文字影を付ける） */
export const SALE_PRIMARY = `${SWITCH_BASE} bg-amber-500 text-white [text-shadow:0_1px_1px_rgb(120_53_15/0.45)] hover:bg-amber-600 focus-visible:outline-amber-500`;

/** 控えめな購入ボタン（最安ではない側）：白地 + アンバーの枠・文字 */
export const SALE_SECONDARY = `${SWITCH_BASE} border border-amber-400 bg-white text-amber-700 hover:border-amber-500 hover:bg-amber-50 focus-visible:outline-amber-500`;

/** 買取ボタン：落ち着いたエメラルド（白文字） */
export const BUYBACK_PRIMARY = `${SWITCH_BASE} bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-600`;
