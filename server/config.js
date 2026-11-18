// 대시보드 설정과 접속 토큰. control_room/.local/ 에 저장한다 (git 제외).
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 설정·토큰 저장 위치. 테스트할 때는 CONTROL_ROOM_DATA_DIR 로 바꾼다 */
const LOCAL_DIR = process.env.CONTROL_ROOM_DATA_DIR ? resolve(process.env.CONTROL_ROOM_DATA_DIR) : join(APP_DIR, '.local')
const CONFIG_FILE = join(LOCAL_DIR, 'config.json')
const TOKEN_FILE = join(LOCAL_DIR, 'token')

/** 기본값. 플러그인 폴더는 이 대시보드 옆의 gamestudio/ */
const DEFAULTS = {
  port: 4317,
  /** 게임들이 모여 있는 상위 폴더. 바로 아래 폴더 중 게임 프로젝트를 찾는다 */
  roots: [],
  /** 상위 폴더와 상관없이 직접 추가한 게임 폴더 */
  projects: [],
  /** 비우면 PATH 에서 찾는다 */
  claudePath: '',
  pluginDir: resolve(APP_DIR, '..', 'gamestudio'),
  /** 플러그인을 설치하지 않았으면 claude 를 --plugin-dir 로 띄운다. 설치했으면 끄세요 (두 벌로 동작함) */
  usePluginDir: true,
  /** 터미널 "셸" 메뉴로 띄울 프로그램 */
  shell: 'powershell.exe',
}

const ensureDir = () => mkdirSync(LOCAL_DIR, { recursive: true })

export function loadConfig() {
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    // 처음 실행
  }
  return { ...DEFAULTS, ...saved }
}

const asPaths = v => (Array.isArray(v) ? v : []).map(p => String(p).trim()).filter(Boolean).map(p => resolve(p))

/** 화면에서 바꿀 수 있는 값만 받아 저장한다 */
export function saveConfig(patch) {
  const cur = loadConfig()
  const next = {
    ...cur,
    ...(patch.roots !== undefined && { roots: [...new Set(asPaths(patch.roots))] }),
    ...(patch.projects !== undefined && { projects: [...new Set(asPaths(patch.projects))] }),
    ...(typeof patch.claudePath === 'string' && { claudePath: patch.claudePath.trim() }),
    ...(typeof patch.pluginDir === 'string' && { pluginDir: patch.pluginDir.trim() }),
    ...(typeof patch.usePluginDir === 'boolean' && { usePluginDir: patch.usePluginDir }),
    ...(typeof patch.shell === 'string' && patch.shell.trim() !== '' && { shell: patch.shell.trim() }),
  }
  ensureDir()
  writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/** 북마크가 계속 동작하도록 토큰은 한 번 만들어 저장해 둔다 */
export function loadToken() {
  try {
    const t = readFileSync(TOKEN_FILE, 'utf8').trim()
    if (t.length >= 32) return t
  } catch {
    // 새로 만든다
  }
  ensureDir()
  const t = randomBytes(24).toString('hex')
  writeFileSync(TOKEN_FILE, t, { mode: 0o600 })
  return t
}

/** claude 실행 파일. 설정값 → PATH 순서 */
export function resolveClaude(config) {
  if (config.claudePath && existsSync(config.claudePath)) return config.claudePath
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(cmd, ['claude'], { encoding: 'utf8' }).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    return found.find(p => p.toLowerCase().endsWith('.exe')) ?? found[0] ?? 'claude'
  } catch {
    return 'claude'
  }
}
