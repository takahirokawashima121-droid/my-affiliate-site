// アフィリエイト導線ボタンの共通スタイル（ファイアレッド・リーフグリーン配色）
// 購入 = ファイアレッド（赤）、買取 = リーフグリーン（緑）。白背景の上で対になるアクセントとして使う

/** 精密機器のトリガースイッチ風：微細な角丸 + クリーンな影（押すと 1px 沈む） */
export const SWITCH_BASE = 'rounded-md shadow-sm active:translate-y-px active:shadow-none';

/** 購入ボタン：ファイアレッド */
export const SALE_PRIMARY = `${SWITCH_BASE} bg-red-600 text-white shadow-red-900/10 hover:bg-red-700 focus-visible:outline-red-600`;
