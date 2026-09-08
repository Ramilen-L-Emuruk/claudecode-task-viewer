// `~/.claude/tasks/` の読み取り。
//
// Claude Code はタスクを「リスト名のディレクトリ / タスク ID .json」で持つ。リスト名は
// 既定ではセッション ID だが、環境変数 CLAUDE_CODE_TASK_LIST_ID を設定したセッションは
// その名前を使い、複数セッションで 1 つのリストを共有する。
//
// 読み取りではロックを取らない。Claude Code 本体も TaskList / TaskGet でロックを取らず
// （ロックを取るのは createTask / updateTask / claimTask / resetTaskList の 4 つだけ）、
// 読むだけなら動いているセッションと競合しない。

import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { BadRequest, isTaskObject, isValidListName, isValidTaskId } from './validate.mjs'

// `.claude` の場所は環境変数で差し替えられる。検証のときに本物のタスクを触らずに済み、
// 別の端末からコピーしてきたディレクトリを覗くこともできる。
const CLAUDE_DIR = process.env.CLAUDE_DIR || join(homedir(), '.claude')

export const TASKS_ROOT = resolve(join(CLAUDE_DIR, 'tasks'))

/** 対象が存在しない。呼び出し側が 404 として扱う。 */
export class NotFound extends Error {}

// リスト名からディレクトリを解決する。正規表現による検証だけでなく、解決後のパスが
// TASKS_ROOT の配下に留まることも確かめる。二重にしているのは、将来パスの組み立てを
// 変えたときに検証側だけが取り残されても外へ出ないようにするため。
function listDirOf(list) {
  if (!isValidListName(list)) throw new BadRequest(`リスト名が不正です: ${list}`)
  const dir = resolve(TASKS_ROOT, list)
  if (!dir.startsWith(TASKS_ROOT + sep)) throw new BadRequest(`リスト名が不正です: ${list}`)
  return dir
}

export function taskPathOf(list, id) {
  if (!isValidTaskId(id)) throw new BadRequest(`タスク ID が不正です: ${id}`)
  const dir = listDirOf(list)
  const p = resolve(dir, `${id}.json`)
  if (!p.startsWith(dir + sep)) throw new BadRequest(`タスク ID が不正です: ${id}`)
  return p
}

// Claude Code 本体と同じ条件。`.lock` や `.highwatermark` のような内部ファイルを除く。
function isTaskFile(name) {
  return name.endsWith('.json') && !name.startsWith('.')
}

function hashOf(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ID は通常は数値だが、Claude Code の実装上は文字列なので数値でない場合もありうる。
// 数値どうしは数値として、それ以外は文字列として並べ、数値を先に置く。
function compareIds(a, b) {
  const na = Number(a), nb = Number(b)
  const aNum = Number.isInteger(na), bNum = Number.isInteger(nb)
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

// 1 件のタスクを読む。読めなかった・壊れていた場合も落とさず、理由を持たせて返す。
// 黙って省くと「画面に出ないタスク」ができ、原因を追う手掛かりが残らない。
async function readTaskFile(dir, name) {
  const id = name.slice(0, -'.json'.length)
  const path = join(dir, name)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    return { id, readError: `${err.code ?? 'ERROR'}: ${err.message}` }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { id, readError: `JSON として読めません: ${err.message}`, rawLength: raw.length }
  }
  if (!isTaskObject(parsed)) {
    return { id, readError: 'JSON の中身がオブジェクトではありません' }
  }
  let mtime = null
  try {
    mtime = (await stat(path)).mtime.toISOString()
  } catch (err) {
    // 読めた直後に消えたのなら想定内。ただし権限などで恒常的に失敗している場合は
    // 更新時刻が出ないまま原因が分からなくなるので、記録は残す。
    if (err.code !== 'ENOENT') console.error(`[tasks] 更新時刻を読めません（${path}）`, err)
  }
  return {
    id,
    subject: parsed.subject ?? '(件名なし)',
    description: parsed.description ?? '',
    activeForm: parsed.activeForm ?? '',
    status: parsed.status ?? 'unknown',
    owner: parsed.owner ?? '',
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    blockedBy: Array.isArray(parsed.blockedBy) ? parsed.blockedBy : [],
    metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {},
    // 書き込み時の突き合わせに使う。表示したときの中身と、書き込む直前の中身が
    // 同じであることを確かめるためのもの。
    hash: hashOf(raw),
    mtime,
  }
}

/** 1 つのリストの全タスクを読む。 */
export async function readList(list) {
  const dir = listDirOf(list)
  let names
  try {
    names = await readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') throw new NotFound(`リストがありません: ${list}`)
    throw err
  }
  const tasks = []
  for (const name of names.filter(isTaskFile)) {
    tasks.push(await readTaskFile(dir, name))
  }
  tasks.sort((a, b) => compareIds(a.id, b.id))
  // タスクとして認識できなかったファイルの数も返す。一覧の側だけで持っていると、
  // そのリストを開いた瞬間に「本当に何も無いリスト」と区別が付かなくなる。
  const unrecognized = names.filter((name) => !name.startsWith('.') && !isTaskFile(name)).length
  return { list, tasks, unrecognized }
}

/** すべてのリストの概要。 */
export async function readAllLists() {
  let entries
  try {
    entries = await readdir(TASKS_ROOT, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return { root: TASKS_ROOT, lists: [] }
    throw err
  }

  const lists = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    // 名前が扱える形でないディレクトリも一覧には出す。黙って省くと、利用者からは
    // 「あるはずのリストが見えない」だけになり、理由が分からない。
    if (!isValidListName(entry.name)) {
      lists.push({ list: entry.name, unsupported: true, total: 0, byStatus: {} })
      continue
    }

    const dir = join(TASKS_ROOT, entry.name)
    let entryNames
    try {
      entryNames = await readdir(dir)
    } catch (err) {
      // 画面に出る短いコードだけでは原因を追えない。ファイル単位の失敗と同じ粒度で
      // メッセージも残し、端末にも記録する。
      console.error(`[tasks] リストを読めません（${dir}）`, err)
      lists.push({
        list: entry.name,
        readError: `${err.code ?? 'ERROR'}: ${err.message}`,
        total: 0,
        byStatus: {},
      })
      continue
    }
    const names = entryNames.filter(isTaskFile)
    if (names.length === 0) {
      // 中身が空なら「まだタスクが無いセッション」なので隠す。中身があるのに 1 件も
      // タスクとして認識できない場合は隠さない。Claude Code 側の命名規則が変わった
      // ときに、該当する全リストが理由も表示もなく消えるのを防ぐ。
      const unrecognized = entryNames.filter((name) => !name.startsWith('.')).length
      if (unrecognized > 0) {
        lists.push({ list: entry.name, unrecognized, total: 0, byStatus: {} })
      }
      continue
    }

    const byStatus = {}
    // ブランチ名とプロジェクト名は「最初に見つかった 1 件」を代表値にしない。共有リストには
    // 別のリポジトリの作業が混在しうるため、代表値にすると事実と違う名前を表示する。
    // 出てきた値を全部集めて、画面側でそのまま並べる。
    const branches = new Set()
    const projects = new Set()
    let updatedAt = null
    let broken = 0
    for (const name of names) {
      const task = await readTaskFile(dir, name)
      if (task.readError) {
        broken += 1
        continue
      }
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1
      if (typeof task.metadata.branch === 'string' && task.metadata.branch) branches.add(task.metadata.branch)
      if (typeof task.metadata.project === 'string' && task.metadata.project) projects.add(task.metadata.project)
      // ディレクトリの mtime ではなく、タスクファイルの最大 mtime を採る。既存の
      // タスクを上書きしただけではディレクトリの mtime が動かないため。
      if (task.mtime && (!updatedAt || task.mtime > updatedAt)) updatedAt = task.mtime
    }
    lists.push({
      list: entry.name,
      total: names.length,
      byStatus,
      branches: [...branches],
      projects: [...projects],
      updatedAt,
      ...(broken > 0 ? { broken } : {}),
    })
  }

  lists.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  return { root: TASKS_ROOT, lists }
}

// 変更検知用の署名。全リストの全タスクファイルの名前・更新時刻・サイズを畳み込む。
// ファイル監視が使えない環境でのポーリングに使う。
export async function signature() {
  const hash = createHash('sha256')
  let entries
  try {
    entries = await readdir(TASKS_ROOT, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return 'no-root'
    // 権限や I/O の異常を「置き場所が無い」と同じ扱いにすると、変更検知が死んでいる
    // ことに気づけない。種別を残して記録する。
    console.error('[update] タスクの置き場所を読めません', err)
    return `error:${err.code ?? 'unknown'}`
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue
    const dir = join(TASKS_ROOT, entry.name)
    let names
    try {
      names = (await readdir(dir)).filter(isTaskFile).sort()
    } catch (err) {
      // このリストだけ読めない状態が続くと、そのリストの変更が無音で消える。読めなかった
      // ことを署名に混ぜておけば、少なくとも「読めるようになった」変化は検知できる。
      hash.update(`${entry.name}:unreadable:${err.code ?? 'unknown'}\n`)
      continue
    }
    for (const name of names) {
      try {
        const info = await stat(join(dir, name))
        hash.update(`${entry.name}/${name}:${info.mtimeMs}:${info.size}\n`)
      } catch (err) {
        // 走査中に消えたのなら、署名から消えるのが正しい。それ以外の理由（権限など）で
        // 恒常的に失敗すると、そのファイルの変更が署名に永久に乗らなくなる。監視が
        // 使えない環境では署名が唯一の検知手段なので、黙って飛ばさず記録に残し、
        // 「読めなかった」こと自体を署名へ混ぜる。
        if (err.code !== 'ENOENT') {
          console.error(`[update] タスクの状態を読めません（${join(dir, name)}）`, err)
          hash.update(`${entry.name}/${name}:unreadable:${err.code ?? 'unknown'}\n`)
        }
      }
    }
  }
  return hash.digest('hex').slice(0, 16)
}
