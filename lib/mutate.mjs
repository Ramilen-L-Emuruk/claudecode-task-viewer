// タスクの書き込み（状態変更・削除）。
//
// Claude Code 本体は updateTask のときタスクファイル自身をアンカーにしてロックを取る
// （proper-lockfile が隣に `<taskId>.json.lock` ディレクトリを作る）。ここでも同じ
// ライブラリ・同じ対象・同じ設定を使う。自前のロックにすると「たぶん互換」にしかならず、
// 動いているセッションの書き込みを黙って壊しうる。
//
// 新規作成は行わない。ID の採番にはリスト全体のロックが要り、本体側の空き ID 探索と
// 競合する。タスクを作るのは Claude Code の仕事。

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { BadRequest, isTaskObject } from './validate.mjs'
import { NotFound, readList, taskPathOf } from './tasks.mjs'

/** 他の誰かが同じタスクを書き込み中。呼び出し側が 503 として扱う。 */
export class Busy extends Error {}
/** 表示していた内容と現在の内容が食い違う、または前提を満たさない。409 として扱う。 */
export class Conflict extends Error {}

const VALID_STATUS = new Set(['pending', 'in_progress', 'completed'])

// Claude Code 本体と同じ設定。5ms から始めて最大 100ms、30 回まで待つ。
// stale は指定しない（proper-lockfile の既定 10 秒。本体も指定していない）。
const LOCK_OPTIONS = { retries: { retries: 30, minTimeout: 5, maxTimeout: 100 } }

function hashOf(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// 本体は末尾改行を付けずに JSON.stringify(task, null, 2) で書く。同じ形にする
// （形式が違うと、本体が読み書きするたびにファイル全体が書き換わったように見える）。
function serialize(task) {
  return JSON.stringify(task, null, 2)
}

async function withTaskLock(list, id, fn) {
  const path = taskPathOf(list, id)
  let release
  try {
    release = await lockfile.lock(path, LOCK_OPTIONS)
  } catch (err) {
    if (err.code === 'ELOCKED') {
      throw new Busy('他のセッションがこのタスクを書き込み中です。少し待ってからもう一度お試しください')
    }
    if (err.code === 'ENOENT') throw new NotFound(`タスクがありません: ${list}/${id}`)
    throw err
  }
  try {
    return await fn(path)
  } finally {
    try {
      await release()
    } catch (err) {
      // 解放できなくても、proper-lockfile の既定（10 秒）で失効する。握り潰さず記録する。
      console.error(`[lock] 解放に失敗しました（${list}/${id}）`, err)
    }
  }
}

// 表示していた内容と、いま書き込もうとしている対象が同じであることを確かめる。
// 一致しなければ、画面を出したあとに他のセッションが書き換えたということ。
async function readForWrite(path, expectedHash) {
  const raw = await readFile(path, 'utf8')
  if (hashOf(raw) !== expectedHash) {
    throw new Conflict('表示していた内容が古くなっています（他のセッションが更新しました）。画面を更新してからやり直してください')
  }
  // 読み取り側が「壊れている」と印を付ける形のファイルは、書き込み側でも拒否する。
  // 判定を分けると、たとえば中身が配列のファイルへ status を代入したあと
  // JSON.stringify がそれを捨て、変えていないのに成功を返すことになる。
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Conflict('このタスクの JSON が壊れているため、ビューアからは変更できません')
  }
  if (!isTaskObject(parsed)) {
    throw new Conflict('このタスクの JSON がオブジェクトではないため、ビューアからは変更できません')
  }
  return parsed
}

// このタスクを blockedBy に挙げているタスク（= このタスクがブロックしている相手）を
// 集める。**完了したタスクは数えない** —— 完了していればもうブロックされていないので、
// 数えると画面側の判定（blockersOf）と食い違い、「バッジが出ていないのに削除できない」
// という一貫しない挙動になる。
function blockedTasks(tasks, id) {
  return tasks.filter(
    (task) =>
      !task.readError &&
      task.id !== id &&
      task.status !== 'completed' &&
      task.blockedBy.includes(id),
  )
}

function blockedConflict(blocked) {
  return new Conflict(
    `このタスクは #${blocked.map((t) => t.id).join(' #')} をブロックしています。` +
      '消すとそちらが着手できないまま残るので、先に依存を外してください',
  )
}

/** 状態を変える。 */
export async function updateStatus(list, id, status, expectedHash) {
  if (!VALID_STATUS.has(status)) {
    throw new BadRequest(`状態が不正です: ${status}（${[...VALID_STATUS].join(' / ')} のいずれか）`)
  }
  if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
    throw new BadRequest('hash を指定してください')
  }
  return withTaskLock(list, id, async (path) => {
    const task = await readForWrite(path, expectedHash)
    if (task.status === status) return { id, status, hash: expectedHash, unchanged: true }
    task.status = status
    const next = serialize(task)
    await writeFile(path, next, 'utf8')
    return { id, status, hash: hashOf(next) }
  })
}

/** 削除する。他のタスクが待っている場合は拒否する。 */
export async function deleteTask(list, id, expectedHash) {
  if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
    throw new BadRequest('hash を指定してください')
  }

  // 依存されているタスクを消すと、待っている側が永久に着手できないまま残る。
  // ロックを取る前に調べる（読み取りだけなので、ここでロックは要らない）。
  const { tasks } = await readList(list)
  const blocked = blockedTasks(tasks, id)
  if (blocked.length > 0) throw blockedConflict(blocked)

  return withTaskLock(list, id, async (path) => {
    // ロックを取ったあとにもう一度突き合わせる。取得を待っている間に他のセッションが
    // 書き換えている可能性がある。
    await readForWrite(path, expectedHash)

    // 依存も取り直す。上の確認からロック取得までの間に、このタスクを待つ新しいタスクが
    // 作られていることがある。ロックはタスク単位なので他タスクの作成は止められず、
    // ここで見直しても窓は完全には閉じない（閉じるにはリスト全体のロックが必要で、
    // それは Claude Code 本体の createTask を待たせることになる）。窓は数ミリ秒に縮む。
    const fresh = await readList(list)
    const blockedNow = blockedTasks(fresh.tasks, id)
    if (blockedNow.length > 0) throw blockedConflict(blockedNow)

    // 読めなかったタスクは依存関係も分からない。判定からは外すしかないが、外したことは
    // 呼び出し側へ伝える。黙って飛ばすと「誰も待っていない」と断定したことになる。
    // 数えるのは**取り直した結果**から。最初の読み取りとの間に壊れた／直ったタスクが
    // あると、古い結果で作った警告が実際の状態と食い違う。
    const unreadable = fresh.tasks.filter((task) => task.readError)

    await unlink(path)
    return {
      id,
      deleted: true,
      ...(unreadable.length > 0
        ? {
            warning:
              `読めないタスクが ${unreadable.length} 件あります（#${unreadable.map((t) => t.id).join(' #')}）。` +
              'それらがこのタスクを待っていたかどうかは確認できていません',
          }
        : {}),
    }
  })
}
