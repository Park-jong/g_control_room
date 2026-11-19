// 게임 폴더의 Git 상태: 커밋 안 된 변경, push 안 된 커밋(ahead), 원격에서 받을 커밋(behind), 마지막 커밋.
// ahead/behind 는 마지막으로 원격을 확인(fetch)한 시점 기준이다. 원격 확인은 사용자가 버튼을 눌렀을 때만 한다.
import { execFile, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

/** 같은 폴더를 이 시간 안에 다시 묻지 않는다 (변경 감지가 2초마다 돌기 때문) */
const TTL_MS = 10_000
const MAX_FILES = 50
const STATUS_TIMEOUT_MS = 5_000
const FETCH_TIMEOUT_MS = 30_000

// GIT_OPTIONAL_LOCKS=0: 상태를 읽느라 index.lock 을 잡지 않는다 (사용자가 동시에 커밋해도 부딪히지 않음)
// GIT_TERMINAL_PROMPT=0: 인증이 필요하면 묻지 말고 바로 실패한다 (창 없이 멈추는 것 방지)
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
// 한글 파일 이름을 \353\214... 처럼 바꾸지 않는다
const GIT_ARGS = ['-c', 'core.quotePath=false']

const cache = new Map()

function git(cwd, args) {
  const r = spawnSync('git', [...GIT_ARGS, ...args], { cwd, env: GIT_ENV, encoding: 'utf8', timeout: STATUS_TIMEOUT_MS, windowsHide: true })
  return r.status === 0 ? r.stdout : null
}

/** `git status --porcelain=v2 --branch` 출력 → 브랜치·ahead/behind·변경 파일 */
export function parseStatus(text) {
  const s = { branch: '', upstream: '', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, files: [] }
  const addFile = (code, path) => s.files.length < MAX_FILES && s.files.push({ code, path })
  for (const line of text.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.head ')) s.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) s.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) [s.ahead, s.behind] = [Number(m[1]), Number(m[2])]
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // 1 XY sub mH mI mW hH hI path  /  2 XY sub mH mI mW hH hI Xscore path\torig
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') s.staged++
      if (xy[1] !== '.') s.unstaged++
      const fields = line.split(' ')
      const path = fields.slice(line.startsWith('1 ') ? 8 : 9).join(' ').split('\t')[0]
      addFile(xy.replace(/\./g, ' '), path)
    } else if (line.startsWith('u ')) {
      s.conflicts++
      addFile('UU', line.split(' ').slice(10).join(' '))
    } else if (line.startsWith('? ')) {
      s.untracked++
      addFile('??', line.slice(2))
    }
  }
  // 커밋 안 된 파일 수. 한 파일이 staged·unstaged 양쪽에 걸려도 한 번만 센다
  s.changedFiles = text.split('\n').filter(l => /^[12u?] /.test(l)).length
  return s
}

function readStatus(path) {
  const out = git(path, ['status', '--porcelain=v2', '--branch'])
  if (out === null) return null // Git 저장소가 아니거나 git 이 없음
  const s = parseStatus(out)
  const log = git(path, ['log', '-1', '--format=%h%x1f%s%x1f%ct'])
  const [hash, subject, ct] = log?.trim().split('\x1f') ?? []
  s.lastCommit = hash ? { hash, subject, at: Number(ct) * 1000 } : null
  const dir = gitDirOf(path)
  s.fetchedAt = dir ? (safeMtime(join(dir, 'FETCH_HEAD')) ?? 0) : 0
  return s
}

/** .git 폴더 위치는 바뀌지 않으므로 한 번만 묻는다 (워크트리면 .git 이 파일이라 직접 찾지 않음) */
const gitDirs = new Map()
function gitDirOf(path) {
  if (!gitDirs.has(path)) gitDirs.set(path, git(path, ['rev-parse', '--absolute-git-dir'])?.trim() || null)
  return gitDirs.get(path)
}

const safeMtime = p => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}

/** 게임 폴더의 Git 상태 (Git 저장소가 아니면 null). 짧게 캐시한다 */
export function gitStatus(path, now = Date.now()) {
  const hit = cache.get(path)
  if (hit && now - hit.at < TTL_MS) return hit.value
  const value = readStatus(path)
  cache.set(path, { at: now, value })
  return value
}

/** 목록 화면과 변경 감지용 요약 (파일 목록 없이) */
export function gitSummary(path) {
  const g = gitStatus(path)
  if (!g) return null
  const { files, ...rest } = g
  return rest
}

/** 원격 확인: git fetch. 끝나면 캐시를 비워 다음 요청에서 ahead/behind 를 다시 읽는다 */
export function gitFetch(path) {
  return new Promise(resolve => {
    execFile('git', [...GIT_ARGS, 'fetch', '--quiet'], { cwd: path, env: GIT_ENV, timeout: FETCH_TIMEOUT_MS, windowsHide: true }, (err, _out, stderr) => {
      cache.delete(path)
      if (!err) return resolve({ ok: true })
      const last = String(stderr || err.message).trim().split('\n').at(-1) ?? ''
      resolve({ ok: false, error: err.killed ? '원격 확인이 30초 안에 끝나지 않았습니다' : last })
    })
  })
}
