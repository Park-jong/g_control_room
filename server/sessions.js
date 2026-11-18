// 게임 폴더에서 실행된 Claude Code 세션과 서브에이전트, 그리고 gamemanager 플러그인이 남기는 조직 현황 파일을 읽는다.
//  - 세션 기록: ~/.claude/projects/<폴더 경로를 바꾼 이름>/<세션 id>.jsonl
//  - 서브에이전트: 같은 폴더의 <세션 id>/subagents/agent-*.jsonl + .meta.json (agentType, description, model, finished)
//  - 조직 현황: <게임>/.dev-team/live/<세션 id>.json (플러그인 hook 이 상태가 바뀔 때마다 씀)
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
/** 이 시간 안에 기록이 바뀌었으면 "활동 중"으로 본다 */
const ACTIVE_MS = 2 * 60 * 1000
/** 끝났다는 표시 없이 이보다 오래 조용한 서브에이전트는 멈춘 것으로 본다 */
const STALE_AGENT_MS = 15 * 60 * 1000
const MAX_SESSIONS = 20
const HEAD_BYTES = 256 * 1024
/** 세션 제목은 기록 앞부분에서 정해지므로 한 번 찾으면 다시 읽지 않는다 */
const titleCache = new Map()

/** Claude Code 가 프로젝트 기록 폴더 이름을 만드는 방식: 영문·숫자 외 문자는 모두 '-' */
export const encodeProjectDir = path => path.replace(/[^A-Za-z0-9]/g, '-')
export const claudeProjectDir = path => join(CLAUDE_DIR, 'projects', encodeProjectDir(path))

const safeStat = p => {
  try {
    return statSync(p)
  } catch {
    return null
  }
}
const safeList = p => {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}
const readJson = p => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 큰 기록 파일은 앞부분만 읽는다 (제목 찾기용) */
function readHead(path) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(c => c?.type === 'text').map(c => c.text).join(' ')
      : ''

/** 세션 제목: 요약 줄이 있으면 그것, 없으면 사람이 처음 입력한 문장 */
function sessionTitle(head) {
  let summary = ''
  let first = ''
  for (const line of head.split('\n')) {
    if (!line.startsWith('{')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue // 잘린 마지막 줄
    }
    if (row.type === 'summary' && row.summary) summary = row.summary
    if (!first && row.type === 'user' && !row.isSidechain && !row.isMeta) {
      const t = textOf(row.message?.content).trim()
      if (t && !t.startsWith('<')) first = t
    }
    if (summary && first) break
  }
  return (summary || first || '(제목 없음)').replace(/\s+/g, ' ').slice(0, 140)
}

function subagentsOf(dir, sessionId, now) {
  const subDir = join(dir, sessionId, 'subagents')
  return safeList(subDir)
    .filter(f => f.endsWith('.meta.json'))
    .map(f => {
      const meta = readJson(join(subDir, f)) ?? {}
      const st = safeStat(join(subDir, f.replace(/\.meta\.json$/, '.jsonl')))
      const updatedAt = st?.mtimeMs ?? 0
      const finished = meta.finished === true
      return {
        id: f.replace(/^agent-/, '').replace(/\.meta\.json$/, ''),
        type: String(meta.agentType ?? ''),
        role: String(meta.agentType ?? '').split(':').pop(),
        description: String(meta.description ?? ''),
        model: String(meta.model ?? ''),
        status: finished ? 'done' : now - updatedAt < STALE_AGENT_MS ? 'running' : 'stale',
        updatedAt,
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 게임 폴더에서 실행된 세션 목록 (최근 것부터) */
export function listSessions(projectPath, now = Date.now()) {
  const dir = claudeProjectDir(projectPath)
  return safeList(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, st: safeStat(join(dir, f)) }))
    .filter(x => x.st)
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    .slice(0, MAX_SESSIONS)
    .map(({ f, st }) => {
      const id = f.replace(/\.jsonl$/, '')
      const key = join(dir, f)
      let title = titleCache.get(key)
      if (title === undefined) {
        try {
          title = sessionTitle(readHead(key))
          if (title !== '(제목 없음)') titleCache.set(key, title)
        } catch {
          title = '(읽을 수 없음)' // 다른 프로세스가 쓰는 중
        }
      }
      const agents = subagentsOf(dir, id, now)
      return {
        id,
        title,
        updatedAt: st.mtimeMs,
        active: now - st.mtimeMs < ACTIVE_MS || agents.some(a => a.status === 'running'),
        agents,
      }
    })
}

/** 플러그인이 남긴 조직 현황. 세션이 끝났거나 세션 기록이 오래 조용하면 활동 중이 아님 */
export function listLive(projectPath, sessions, now = Date.now()) {
  const dir = join(projectPath, '.dev-team', 'live')
  return safeList(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(join(dir, f)))
    .filter(l => l && typeof l === 'object' && l.sessionId)
    .map(l => {
      const session = sessions.find(s => s.id === l.sessionId)
      const updatedAt = Date.parse(l.updatedAt) || 0
      const active = !l.ended && (session ? session.active : now - updatedAt < ACTIVE_MS)
      return { ...l, updatedAt, active, sessionTitle: session?.title ?? '' }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
}

/** 변경 감지용: 세션 기록 폴더에서 가장 최근 수정 시각 */
export function sessionsSignature(projectPath) {
  const dir = claudeProjectDir(projectPath)
  const files = safeList(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, t: safeStat(join(dir, f))?.mtimeMs ?? 0 }))
    .sort((a, b) => b.t - a.t)
  let max = files[0]?.t ?? 0
  // 서브에이전트는 메인 기록이 조용할 때도 돌아가므로, 최근 세션 몇 개는 서브에이전트 폴더까지 본다
  for (const { f } of files.slice(0, 5)) {
    const sub = join(dir, f.replace(/\.jsonl$/, ''), 'subagents')
    for (const s of safeList(sub)) {
      const t = safeStat(join(sub, s))?.mtimeMs ?? 0
      if (t > max) max = t
    }
  }
  return max
}
