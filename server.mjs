// Claude Code のタスクリストを見るローカルサーバー。
//
//   node server.mjs
//
// 127.0.0.1 だけにバインドする。タスクの本文には作業中のリポジトリの内容や判断が
// そのまま書かれているため、同じネットワークの他の端末から読めてはならない。
//
// 環境変数
//   PORT        待ち受けポートの始点（既定 7317。埋まっていたら順に次を試す）
//   CLAUDE_DIR  `.claude` の場所（既定 ~/.claude）

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BadRequest } from './lib/validate.mjs'
import { NotFound, TASKS_ROOT, readAllLists, readList, signature } from './lib/tasks.mjs'
import { Busy, Conflict, deleteTask, updateStatus } from './lib/mutate.mjs'

const HOST = '127.0.0.1'
const BASE_PORT = Number(process.env.PORT) || 7317
const PORT_ATTEMPTS = 10

// ファイル監視は同じ変更を何度も知らせてくる（Windows では顕著）。まとめて 1 回にする。
const CHANGE_DEBOUNCE_MS = 300
// 監視が使えない環境でのポーリング間隔。
const POLL_INTERVAL_MS = 5000
// 監視モードでも定期的に裏を取る間隔。fs.watch は error を出さずに通知を止めることが
// あり（inotify の上限超え・recursive の環境差など）、その場合エラー経路には掛からない。
const WATCH_AUDIT_INTERVAL_MS = 60000
// 「変わったのに監視が知らせてこない」を何回見たら降格するか。1 回で降格すると、
// 署名の走査中に書き込みが完了した場合に誤って落ちる。
const AUDIT_MISS_THRESHOLD = 2
// 生存確認の送信間隔。クライアントはこれが途切れたことで切断を知る。
const SSE_PING_INTERVAL_MS = 20000
// 書き込みリクエストの本文の上限。
const MAX_BODY_BYTES = 1 << 20

const PUBLIC_DIR = resolve(join(fileURLToPath(new URL('.', import.meta.url)), 'public'))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(body)
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' })
}

// URL から取り出した断片をほどく。不正なエスケープは入力の誤りなので 400 として扱う
// （放っておくと URIError が 500 になり、想定内の入力異常がサーバー障害として記録される）。
function decodeSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new BadRequest('URL のエスケープが不正です')
  }
}

// ---- 変更通知（Server-Sent Events） ----

const clients = new Set()
// 'watch' はファイル監視、'poll' はポーリング。監視に失敗したら poll へ落ちる。
// どちらで動いているかは画面にも出す（黙って劣化させると、更新が遅い理由が分からない）。
let updateMode = 'starting'
// 劣化した理由。あとから接続してきたクライアントにも渡す。
let modeReason = null

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of [...clients]) {
    try {
      res.write(payload)
    } catch (err) {
      console.error('[sse] 配信に失敗したため接続を外します', err)
      clients.delete(res)
    }
  }
}

let debounceTimer = null

// 変更をクライアントへ知らせる。呼び出し元は問わない。
function notifyChanged() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    broadcast('changed', { at: new Date().toISOString() })
  }, CHANGE_DEBOUNCE_MS)
}

// 前回の監査から、**ファイル監視が**変更を拾った回数。
//
// 監視が生きているかの裏取りに使うので、数えるのは監視経由だけにする。自分の
// 書き込み（PATCH / DELETE）を混ぜてはいけない —— 混ぜると、利用者がビューアから
// 操作しているあいだずっと「監視は生きている」ように見え、監査が意味を失う。
// 監査の目的は「他のセッションが直接書き換えたことを監視が拾えているか」の確認。
let watcherNotices = 0

function notifyChangedFromWatcher() {
  watcherNotices += 1
  notifyChanged()
}

let pollTimer = null
let lastSignature = null
let auditSignature = null

function startPolling(reason) {
  if (pollTimer) return
  updateMode = 'poll'
  modeReason = reason
  // 監視から落ちてきた場合は、監査で取っておいた署名を基準として引き継ぐ。null の
  // ままだと最初の 1 回が基準づくりだけで終わり、監視が壊れた瞬間の変更を取りこぼす。
  if (lastSignature === null) lastSignature = auditSignature
  console.error(`[update] ポーリングへ切り替えます（${POLL_INTERVAL_MS}ms 間隔）: ${reason}`)
  broadcast('mode', { updateMode, reason })
  pollTimer = setInterval(() => {
    signature()
      .then((sig) => {
        if (lastSignature !== null && sig !== lastSignature) notifyChanged()
        lastSignature = sig
      })
      .catch((err) => console.error('[update] 署名の計算に失敗しました', err))
  }, POLL_INTERVAL_MS)
  pollTimer.unref?.()
}

function startWatching() {
  let watcher
  try {
    watcher = watch(TASKS_ROOT, { recursive: true }, () => notifyChangedFromWatcher())
  } catch (err) {
    startPolling(`監視を開始できませんでした（${err.code ?? err.message}）`)
    return
  }
  watcher.on('error', (err) => {
    // 監視が死ぬと、画面は「最新を見ている」つもりのまま更新が止まる。必ず拾って
    // ポーリングへ落とし、切り替えたことを画面にも伝える。
    try {
      watcher.close()
    } catch {
      // 既に閉じている場合。閉じられないこと自体は監視の停止に影響しない。
    }
    startPolling(`監視が失敗しました（${err.code ?? err.message}）`)
  })
  updateMode = 'watch'
}

// 監視は error を出さずに黙って止まることがある。定期的に署名を取り、中身が変わって
// いるのに何も通知していなければ、監視が死んでいると判断してポーリングへ落とす。
let auditMisses = 0

function startWatchAudit() {
  const timer = setInterval(() => {
    if (updateMode !== 'watch') return
    signature()
      .then((sig) => {
        const changed = auditSignature !== null && sig !== auditSignature
        const notified = watcherNotices > 0
        auditSignature = sig
        watcherNotices = 0

        // 監視から通知が来た周期は、監視が生きている証拠。数え直す。
        if (notified) {
          auditMisses = 0
          return
        }
        // 中身が変わっていない周期は、監視の生死について何も語らない。**数え直さない** ——
        // ここでリセットすると、編集が断続的な普通の使い方では閾値に永久に届かず、
        // 監視が完全に死んでいても降格しない。
        if (!changed) return

        // 中身が変わったのに監視が何も知らせてこなかった。1 回では降格しない
        // （署名を走査している最中に書き込みが完了すると、その変更が次の周期へ
        // 持ち越されて同じ形に見えることがある）。
        auditMisses += 1
        if (auditMisses < AUDIT_MISS_THRESHOLD) return
        auditMisses = 0
        startPolling('ファイル監視が変更を知らせなくなりました')
        // 取りこぼしていた変更を、いま知らせる。
        notifyChanged()
      })
      .catch((err) => {
        // 現状の signature() は内部で全て捕捉しているため通常ここへは来ない。
        // 将来 signature() に失敗する経路が入ったとき、裏取りが黙って止まらないように
        // 記録は残す（判定の基準値は据え置き、次の周期でやり直す）。
        console.error('[update] 監視の裏取りに失敗しました', err)
      })
  }, WATCH_AUDIT_INTERVAL_MS)
  timer.unref?.()
}

function serveEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  // 劣化したあとに繋いできたクライアントにも理由を渡す。
  // 他の書き込み箇所と同じく失敗を捕まえる。ここだけ素で書くと、失敗が handle() の
  // catch へ伝わり、ヘッダー送信済みの応答へ 500 を書こうとして二次的に落ちる。
  try {
    res.write(`event: mode\ndata: ${JSON.stringify({ updateMode, reason: modeReason })}\n\n`)
  } catch (err) {
    console.error('[sse] 接続直後の送信に失敗しました', err)
    res.destroy()
    return
  }
  clients.add(res)

  let ping = null
  const cleanup = () => {
    if (ping) clearInterval(ping)
    ping = null
    clients.delete(res)
  }

  ping = setInterval(() => {
    try {
      // コメント行（`: ping`）ではクライアント側で何のイベントも発火せず、生存を
      // 確かめる手立てにならない。イベントとして送る。
      res.write(`event: ping\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)
    } catch (err) {
      // close/error が発火しない状態が続くと、この接続とタイマーが残り続ける。
      // ここで自分で片付ける。
      console.error('[sse] 生存確認の送信に失敗したため接続を外します', err)
      cleanup()
    }
  }, SSE_PING_INTERVAL_MS)
  ping.unref?.()

  req.on('close', cleanup)
  res.on('error', cleanup)
}

// ---- 書き込みの前提 ----

// このサーバーは 127.0.0.1 で待つが、ブラウザで開いた別のサイトの JavaScript からも
// リクエストは飛ばせる。書き込みは画面から来たものだけを受ける。
let allowedOrigins = new Set()

function isFromViewer(req) {
  const origin = req.headers.origin
  return typeof origin === 'string' && allowedOrigins.has(origin)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new BadRequest('リクエストの本文が大きすぎます')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BadRequest('本文を JSON として読めません')
  }
}

// ---- 静的ファイル ----

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeSegment(urlPath.slice(1))
  const path = resolve(PUBLIC_DIR, rel)
  if (path !== PUBLIC_DIR && !path.startsWith(PUBLIC_DIR + sep)) {
    send(res, 400, 'bad path')
    return
  }
  let body
  try {
    body = await readFile(path)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      send(res, 404, 'not found')
      return
    }
    throw err
  }
  send(res, 200, body, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' })
}

// ---- ルーティング ----

const TASK_PATH = /^\/api\/tasks\/([^/]+)\/([^/]+)$/

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`)
  const method = req.method

  if (method === 'GET' || method === 'HEAD') {
    if (url.pathname === '/api/events') {
      serveEvents(req, res)
      return
    }
    if (url.pathname === '/api/lists') {
      sendJson(res, 200, { ...(await readAllLists()), updateMode, modeReason })
      return
    }
    if (url.pathname === '/api/tasks') {
      const list = url.searchParams.get('list')
      if (list === null) throw new BadRequest('list を指定してください')
      sendJson(res, 200, await readList(list))
      return
    }
    await serveStatic(res, url.pathname)
    return
  }

  const match = TASK_PATH.exec(url.pathname)
  if ((method === 'PATCH' || method === 'DELETE') && match) {
    if (!isFromViewer(req)) {
      sendJson(res, 403, { error: 'この操作はビューアの画面からのみ行えます' })
      return
    }
    const list = decodeSegment(match[1])
    const id = decodeSegment(match[2])
    const body = await readJsonBody(req)
    const result =
      method === 'PATCH'
        ? await updateStatus(list, id, body.status, body.hash)
        : await deleteTask(list, id, body.hash)
    sendJson(res, 200, result)
    // 監視が拾うはずだが、自分の書き込みは確実に知らせる。ただし何も書き換えて
    // いない場合は知らせない（全クライアントに無駄な読み直しをさせるだけになる）。
    if (!result.unchanged) notifyChanged()
    return
  }

  send(res, 405, 'method not allowed', { Allow: 'GET, HEAD, PATCH, DELETE' })
}

function statusFor(err) {
  if (err instanceof BadRequest) return 400
  if (err instanceof NotFound) return 404
  if (err instanceof Conflict) return 409
  if (err instanceof Busy) return 503
  return 500
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    // 応答を送り始めた後の失敗では、もうヘッダーを書けない。ここで writeHead を
    // 呼ぶと二次的な例外になり、それを受ける者がいないためプロセスごと落ちる。
    if (res.headersSent) {
      console.error(`[error] 応答の途中で失敗しました ${req.method} ${req.url}`, err)
      res.destroy()
      return
    }
    const status = statusFor(err)
    // 予期しない失敗は必ず記録する。画面には概要だけ返し、詳細は端末に出す。
    if (status === 500) console.error(`[error] ${req.method} ${req.url}`, err)
    const message =
      status === 500
        ? 'サーバー側で処理できませんでした（起動した端末のログを見てください）'
        : err.message
    try {
      sendJson(res, status, { error: message })
    } catch (secondary) {
      // 応答を返すこと自体が失敗した。これ以上できることはないので記録して切る。
      console.error('[error] 応答を返せませんでした', secondary)
      res.destroy()
    }
  })
})

// 既定のポートが埋まっていたら順に試す。検証用に複数立てることがあるため。
async function listenOnFreePort() {
  for (let i = 0; i < PORT_ATTEMPTS; i += 1) {
    const port = BASE_PORT + i
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        const onError = (err) => {
          server.removeListener('listening', onListening)
          rejectPromise(err)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolvePromise()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, HOST)
      })
      return port
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err
    }
  }
  throw new Error(`${BASE_PORT} から ${PORT_ATTEMPTS} 個のポートがすべて埋まっています`)
}

// `--open` が付いていたらブラウザで開く。ポートは埋まっていればずれるので、URL を
// 知っているこちら側で開く（起動用のバッチが URL を組み立てると実際のポートと食い違う）。
function openInBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? // start は cmd の内部コマンド。第 1 引数はウィンドウタイトルで、URL に & が
        // 入っていても引数と誤解されないよう空文字を置く。
        ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    // 開けなかったことを黙らせない。URL は既に画面へ出してあるので手で開ける。
    child.on('error', (err) => console.error(`[open] ブラウザを開けませんでした: ${err.message}`))
    child.unref()
  } catch (err) {
    console.error(`[open] ブラウザを開けませんでした: ${err.message}`)
  }
}

const port = await listenOnFreePort()
allowedOrigins = new Set([`http://${HOST}:${port}`, `http://localhost:${port}`])
startWatching()
startWatchAudit()
const url = `http://${HOST}:${port}`
console.log(`claudecode-task-viewer  ${url}`)
console.log(`  タスクの置き場所: ${TASKS_ROOT}`)
console.log('  終了するには Ctrl+C を押してください')
if (process.argv.includes('--open')) openInBrowser(url)
