// URL から渡ってくるリスト名・タスク ID の検証。
//
// Claude Code 本体はリスト名を `[^a-zA-Z0-9_-]` → `-` へ置き換えて使う。こちらは
// 同じ置き換えをせず、不正な値は拒否する。読み替えると「指定されたのとは別のファイルを
// 黙って開く」ことになり、書き込み経路では別のタスクを上書きしうる。
const SAFE_NAME = /^[A-Za-z0-9_-]{1,128}$/

/** 不正な入力。呼び出し側が 400 として扱う。 */
export class BadRequest extends Error {}

export function isValidListName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name)
}

export function isValidTaskId(id) {
  return typeof id === 'string' && SAFE_NAME.test(id)
}

// タスクの JSON がオブジェクトとして扱える形か。読み取り側と書き込み側で同じ判定を使う。
// 別々に持つと、読み取りが「壊れている」と印を付けたファイルへ書き込み側が書けてしまう
// （配列に status を代入しても JSON.stringify が捨てるため、変えていないのに成功を返す）。
export function isTaskObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
