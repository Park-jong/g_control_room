// control_room 대시보드 서버. 이 PC 안(127.0.0.1)에서만 열리고, 접속 토큰이 있어야 쓸 수 있다.
// 웹 터미널은 이 PC에서 명령을 실행하므로, 다른 기기에서 접속할 수 있게 바꾸지 마세요.
import { exec } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

import { WebSocketServer } from 'ws'

import { APP_DIR, loadConfig, loadToken, resolveClaude, saveConfig } from './config.js'
import { gitFetch } from './git.js'
import { detail, discover, signature, summarize } from './projects.js'
import { Terminals } from './terminals.js'

const HOST = '127.0.0.1'
const POLL_MS = 2000
const MAX_BODY = 64 * 1024

let config = loadConfig()
const token = loadToken()
const port = Number(process.env.PORT) || config.port
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
const allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`))

// ───────────── 정적 파일 ─────────────

const PUBLIC_DIR = join(APP_DIR, 'public')
/** 브라우저에 내보내는 라이브러리 파일 (node_modules 전체를 열지 않는다) */
const VENDOR = {
  '/vendor/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  '/vendor/addon-web-links.js': 'node_modules/@xterm/addon-web-links/lib/addon-web-links.js',
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }

async function serveStatic(pathname, res) {
  const file = VENDOR[pathname]
    ? join(APP_DIR, VENDOR[pathname])
    : resolve(PUBLIC_DIR, `.${normalize(pathname === '/' ? '/index.html' : pathname)}`)
  if (!VENDOR[pathname] && !file.startsWith(PUBLIC_DIR + sep)) return send(res, 404, 'not found')
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(body)
  } catch {
    send(res, 404, 'not found')
  }
}

// ───────────── 인증 ─────────────

const sameToken = given => {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}
const cookieToken = req => /(?:^|;\s*)cr_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1]
/** 다른 사이트가 이름만 바꿔 이 서버에 붙는 것(DNS rebinding)을 막는다 */
const hostOk = req => allowedHosts.has(String(req.headers.host ?? '').toLowerCase())

// ───────────── 응답 도우미 ─────────────

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
}
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, ...SECURITY_HEADERS })
  res.end(body)
}
const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8')

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > MAX_BODY) {
        fail(new Error('요청이 너무 큽니다'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        fail(new Error('JSON 형식이 아닙니다'))
      }
    })
    req.on('error', fail)
  })
}

// ───────────── 상태 ─────────────

const projects = () => discover(config)
const findProject = id => projects().find(p => p.id === id)

const clients = new Set()
const broadcast = msg => {
  const text = JSON.stringify(msg)
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(text)
}

const terminals = new Terminals({ getConfig: () => config, onChange: () => broadcast({ t: 'terminals', items: terminals.list() }) })

// ───────────── API ─────────────

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1) // ['projects', id] ...
  const method = req.method ?? 'GET'

  if (parts[0] === 'projects' && parts.length === 1 && method === 'GET') {
    return json(res, 200, projects().map(summarize))
  }
  if (parts[0] === 'projects' && parts.length === 2 && method === 'GET') {
    const p = findProject(parts[1])
    return p ? json(res, 200, detail(p)) : json(res, 404, { error: '게임을 찾을 수 없습니다' })
  }
  if (parts[0] === 'projects' && parts.length === 3 && parts[2] === 'fetch' && method === 'POST') {
    const p = findProject(parts[1])
    if (!p) return json(res, 404, { error: '게임을 찾을 수 없습니다' })
    const result = await gitFetch(p.path)
    if (result.ok) broadcast({ t: 'changed', ids: [p.id] })
    return result.ok ? json(res, 200, result) : json(res, 502, { error: `원격 확인 실패: ${result.error}` })
  }
  if (parts[0] === 'config' && method === 'GET') {
    return json(res, 200, { ...config, claudeResolved: resolveClaude(config) })
  }
  if (parts[0] === 'config' && method === 'PUT') {
    config = saveConfig(await readBody(req))
    broadcast({ t: 'projects' })
    return json(res, 200, { ...config, claudeResolved: resolveClaude(config) })
  }
  if (parts[0] === 'terminals' && parts.length === 1 && method === 'GET') {
    return json(res, 200, terminals.list())
  }
  if (parts[0] === 'terminals' && parts.length === 1 && method === 'POST') {
    const body = await readBody(req)
    const p = findProject(String(body.projectId ?? ''))
    if (!p) return json(res, 404, { error: '게임을 찾을 수 없습니다' })
    const mode = ['claude', 'continue', 'resume', 'shell'].includes(body.mode) ? body.mode : 'claude'
    const item = terminals.create({
      cwd: p.path,
      projectId: p.id,
      projectName: summarize(p).name,
      mode,
      resumeId: body.resumeId,
      cols: Number(body.cols) || 120,
      rows: Number(body.rows) || 30,
    })
    return json(res, 201, item)
  }
  if (parts[0] === 'terminals' && parts[1] === 'order' && parts.length === 2 && method === 'PUT') {
    const body = await readBody(req)
    terminals.reorder(body.ids)
    return json(res, 200, terminals.list())
  }
  if (parts[0] === 'terminals' && parts.length === 2 && method === 'DELETE') {
    return terminals.close(parts[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: '터미널이 없습니다' })
  }
  return json(res, 404, { error: '없는 API입니다' })
}

const server = createServer(async (req, res) => {
  try {
    if (!hostOk(req)) return send(res, 421, 'Host not allowed')
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    // 처음 접속: ?token= 을 쿠키로 바꾸고 주소에서 지운다
    if (url.searchParams.has('token')) {
      if (!sameToken(url.searchParams.get('token'))) return send(res, 401, '토큰이 맞지 않습니다. 서버 창에 출력된 주소로 다시 여세요.')
      res.writeHead(302, {
        'set-cookie': `cr_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        location: '/',
        ...SECURITY_HEADERS,
      })
      return res.end()
    }
    if (!sameToken(cookieToken(req))) {
      return send(res, 401, '접속 권한이 없습니다. 서버를 실행한 창에 출력된 주소(토큰 포함)로 여세요.')
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && !allowedOrigins.has(String(req.headers.origin ?? ''))) return json(res, 403, { error: 'origin' })
      return await api(req, res, url)
    }
    return await serveStatic(url.pathname, res)
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
})

// ───────────── WebSocket: 변경 알림 + 터미널 입출력 ─────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

server.on('upgrade', (req, socket, head) => {
  const deny = () => {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
  }
  if (!hostOk(req) || !allowedOrigins.has(String(req.headers.origin ?? '')) || !sameToken(cookieToken(req))) return deny()
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
})

wss.on('connection', ws => {
  clients.add(ws)
  const detach = new Map()
  const reply = msg => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))
  reply({ t: 'terminals', items: terminals.list() })

  ws.on('message', raw => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.t === 'attach' && !detach.has(msg.id)) {
      const off = terminals.attach(msg.id, reply)
      if (off) detach.set(msg.id, off)
      else reply({ t: 'exit', id: msg.id, code: null, missing: true })
    } else if (msg.t === 'detach') {
      detach.get(msg.id)?.()
      detach.delete(msg.id)
    } else if (msg.t === 'in') {
      terminals.input(msg.id, msg.data)
    } else if (msg.t === 'resize') {
      terminals.resize(msg.id, msg.cols, msg.rows)
    }
  })
  ws.on('close', () => {
    clients.delete(ws)
    for (const off of detach.values()) off()
  })
})

// 기록 파일과 세션 기록을 주기적으로 살펴, 바뀐 게임을 화면에 알린다 (Windows 에서 파일 감시보다 안정적)
const lastSig = new Map()
let lastList = ''
setInterval(() => {
  if (clients.size === 0) return
  const list = projects()
  const ids = list.map(p => p.id).join(',')
  if (ids !== lastList) {
    lastList = ids
    broadcast({ t: 'projects' })
  }
  const changed = []
  for (const p of list) {
    const sig = signature(p)
    if (lastSig.has(p.id) && lastSig.get(p.id) !== sig) changed.push(p.id)
    lastSig.set(p.id, sig)
  }
  if (changed.length) broadcast({ t: 'changed', ids: changed })
}, POLL_MS)

server.listen(port, HOST, () => {
  const url = `http://127.0.0.1:${port}/?token=${token}`
  console.log('control_room 대시보드가 실행 중입니다 (이 PC에서만 접속 가능)')
  console.log(`열기: ${url}`)
  console.log('끝내려면 Ctrl+C (열려 있는 웹 터미널도 함께 종료됩니다)')
  if (process.argv.includes('--open')) {
    exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`)
  }
})

const shutdown = () => {
  terminals.closeAll()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
