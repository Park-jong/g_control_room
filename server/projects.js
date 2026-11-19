// 게임 프로젝트 찾기와 화면용 요약·상세 만들기.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { gitStatus, gitSummary } from './git.js'
import { parseIssues, parseTeamRoadmap, parseTodo, parseWorklog } from './parse.js'
import { listLive, listSessions, sessionsSignature } from './sessions.js'

const TEAMS = [
  { key: 'design', label: '기획 팀' },
  { key: 'tech', label: '개발 팀' },
  { key: 'content', label: '콘텐츠 팀' },
  { key: 'qa', label: 'QA 팀' },
]
/** 기본 개발 흐름. TODO.md 에 진행 체크리스트가 없을 때 보여 준다 */
const DEFAULT_PIPELINE = [
  [1, '장르·콘셉트'],
  [2, '프로토타입'],
  [3, '스택·뼈대'],
  [4, '게임 설정'],
  [5, '단계 계획'],
  [6, '개발'],
  [7, '배포 설정'],
  [8, '스킨 확장'],
].map(([step, label]) => ({ step, label, note: '', status: 'todo' }))

const read = p => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
}
const isDir = p => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
const mtime = p => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}
const list = p => {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

export const projectId = path => createHash('sha1').update(resolve(path).toLowerCase()).digest('hex').slice(0, 12)

/** 게임 프로젝트로 볼 폴더: gamestudio 기록이 하나라도 있음 */
const looksLikeGame = dir =>
  ['TODO.md', '.dev-team', join('docs', 'design.md'), join('docs', 'verification-issues.md')].some(f => {
    try {
      statSync(join(dir, f))
      return true
    } catch {
      return false
    }
  })

/** 설정의 상위 폴더(바로 아래 폴더까지)와 직접 추가한 폴더에서 게임 목록을 만든다 */
export function discover(config) {
  const found = new Map()
  const add = (dir, source) => {
    const path = resolve(dir)
    if (!found.has(path)) found.set(path, { id: projectId(path), path, source, missing: !isDir(path) })
  }
  for (const root of config.roots) {
    if (!isDir(root)) continue
    if (looksLikeGame(root)) add(root, 'root')
    for (const name of list(root)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const dir = join(root, name)
      if (isDir(dir) && looksLikeGame(dir)) add(dir, 'root')
    }
  }
  for (const p of config.projects) add(p, 'manual')
  return sortByOrder([...found.values()], config.order ?? [])
}

/** Windows 는 경로의 대소문자를 가리지 않는다 */
const samePathKey = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))

/** 사용자가 정한 순서대로. 순서에 없는 게임은 찾은 순서를 지키며 뒤에 둔다 */
export function sortByOrder(projects, order) {
  const rank = new Map(order.map((p, i) => [samePathKey(p), i]))
  const at = p => rank.get(samePathKey(p.path)) ?? Infinity
  return projects.map((p, i) => ({ p, i })).sort((a, b) => at(a.p) - at(b.p) || a.i - b.i).map(x => x.p)
}

function packageVersion(path) {
  try {
    return JSON.parse(read(join(path, 'package.json')) ?? '{}').version ?? ''
  } catch {
    return ''
  }
}

function requestsOf(path) {
  try {
    const data = JSON.parse(read(join(path, '.dev-team', 'requests.json')) ?? '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

const isOpenReq = r => ['open', 'accepted', 'in_progress'].includes(r.status)
const byPriority = (a, b) => String(a.priority).localeCompare(String(b.priority)) || String(a.id).localeCompare(String(b.id))

/** 진행 중인 단계: 진행 중인 것, 없으면 첫 대기 */
const currentStep = pipeline => pipeline.find(p => p.status === 'doing') ?? pipeline.find(p => p.status === 'todo') ?? null

function collect(project) {
  const { path } = project
  const todoMd = read(join(path, 'TODO.md'))
  const todo = todoMd ? parseTodo(todoMd) : null
  const pipeline = todo?.pipeline.length ? todo.pipeline : DEFAULT_PIPELINE
  const issues = parseIssues(read(join(path, 'docs', 'verification-issues.md')) ?? '')
  const requests = requestsOf(path)
  const sessions = listSessions(path)
  const live = listLive(path, sessions)
  return { todo, pipeline, issues, requests, sessions, live }
}

/**
 * 진행 중인 에이전트 수. 같은 에이전트가 조직 현황 파일과 세션 기록 양쪽에 나오므로 세션마다 한쪽만 센다:
 * 조직 현황이 있는 세션은 그 파일(팀장 대기 상태까지 정확), 없는 세션은 서브에이전트 기록.
 */
function countRunning(sessions, live) {
  const liveBySession = new Map(
    live.filter(l => l.active).map(l => [l.sessionId, Object.values(l.roles ?? {}).filter(s => s.status === 'running').length]),
  )
  let n = 0
  for (const s of sessions) {
    n += liveBySession.has(s.id) ? liveBySession.get(s.id) : s.agents.filter(a => a.status === 'running').length
    liveBySession.delete(s.id)
  }
  for (const count of liveBySession.values()) n += count
  return n
}

/** 목록 화면용 요약 */
export function summarize(project) {
  if (project.missing) return { ...project, name: basename(project.path), error: '폴더를 찾을 수 없습니다' }
  const { todo, pipeline, issues, requests, sessions, live } = collect(project)
  const done = pipeline.filter(p => p.status === 'done' || p.status === 'skipped').length
  const open = requests.filter(isOpenReq)
  const cur = currentStep(pipeline)
  return {
    ...project,
    name: todo?.title || basename(project.path),
    hasTodo: Boolean(todo),
    version: packageVersion(project.path) || todo?.version || '',
    pipeline,
    pipelineDone: done,
    current: cur ? `${cur.step ?? ''}. ${cur.label}`.replace(/^\. /, '') : '모든 단계 완료',
    tasks: todo?.tasks ?? { total: 0, done: 0, doing: 0 },
    /** 사용자가 정해야 할 "결정 대기" 항목 수 (체크되지 않은 것만) */
    decisions: (todo?.pending ?? []).filter(p => p.status === 'todo' || p.status === 'doing').length,
    openRequests: open.length,
    p0: open.filter(r => r.priority === 'P0').length,
    issues: { total: issues.length, critical: issues.filter(i => i.level === 'critical').length },
    activeSessions: sessions.filter(s => s.active).length,
    runningAgents: countRunning(sessions, live),
    git: gitSummary(project.path),
    lastActivity: Math.max(mtime(join(project.path, 'TODO.md')), sessions[0]?.updatedAt ?? 0, ...live.map(l => l.updatedAt)),
  }
}

/** 상세 화면용 */
export function detail(project) {
  const summary = summarize(project)
  if (project.missing) return summary
  const { todo, issues, requests, sessions, live } = collect(project)
  const teams = TEAMS.map(t => {
    const dir = join(project.path, '.dev-team', 'teams', t.key)
    const roadmap = parseTeamRoadmap(read(join(dir, 'roadmap.md')) ?? '')
    const worklog = parseWorklog(read(join(dir, 'worklog.md')) ?? '')
    return { ...t, ...roadmap, worklog: worklog.slice(-3).reverse() }
  })
  return {
    ...summary,
    todo,
    issues: issues.sort((a, b) => b.count - a.count),
    requests: [...requests].sort((a, b) => Number(isOpenReq(b)) - Number(isOpenReq(a)) || byPriority(a, b)),
    teams,
    sessions,
    live,
    git: gitStatus(project.path),
  }
}

/** 변경 감지용 서명: 기록 파일들과 세션 기록의 수정 시각 */
export function signature(project) {
  const p = project.path
  const files = [
    join(p, 'TODO.md'),
    join(p, 'package.json'),
    join(p, 'docs', 'verification-issues.md'),
    join(p, '.dev-team', 'requests.json'),
    ...TEAMS.flatMap(t => ['roadmap.md', 'worklog.md'].map(f => join(p, '.dev-team', 'teams', t.key, f))),
    ...list(join(p, '.dev-team', 'live')).map(f => join(p, '.dev-team', 'live', f)),
  ]
  // Git 상태는 10초 캐시라, 파일을 고치거나 커밋·push 하면 늦어도 그 안에 화면이 바뀐다
  const g = gitSummary(p)
  const gitSig = g ? [g.branch, g.changedFiles, g.staged, g.ahead, g.behind, g.lastCommit?.hash, g.fetchedAt].join('|') : ''
  return [...files.map(mtime), sessionsSignature(p), gitSig].join(',')
}
