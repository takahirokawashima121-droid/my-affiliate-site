// アフィリエイト導線ボタンの共通スタイル（ファイアレッド・リーフグリーン配色）
// 購入 = ファイアレッド（赤）、買取 = リーフグリーン（緑）。白背景の上で対になるアクセントとして使う

/** 精密機器のトリガースイッチ風：微細な角丸 + クリーンな影（押すと 1px 沈む） */
export const SWITCH_BASE = 'rounded-md shadow-sm active:translate-y-px active:shadow-none';

/** 購入ボタン：ファイアレッド */
export const SALE_PRIMARY = `${SWITCH_BASE} bg-red-600 text-white shadow-red-900/10 hover:bg-red-700 focus-visible:outline-red-600`;

/** 買取ボタン：リーフグリーン */
export const BUYBACK_PRIMARY = `${SWITCH_BASE} bg-emerald-600 text-white shadow-emerald-900/10 hover:bg-emerald-700 focus-visible:outline-emerald-600`;

/** 買取の補助ボタン（宅配でまとめて査定）：白地 + リーフグリーンの枠。単品買取ボタンと並んだときに区別する */
export const BUYBACK_SECONDARY = `${SWITCH_BASE} border border-emerald-500 bg-white text-emerald-700 hover:bg-emerald-50 focus-visible:outline-emerald-600`;
