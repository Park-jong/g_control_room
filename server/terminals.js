// 웹 터미널: 서버에서 가상 터미널(node-pty)로 claude 나 셸을 띄우고, 입출력을 WebSocket 으로 주고받는다.
// 브라우저를 새로 고쳐도 터미널은 계속 돌고, 다시 붙으면 최근 출력을 다시 보내 준다.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import pty from 'node-pty'

import { resolveClaude } from './config.js'
import './pty-quiet.js'

/** 다시 붙을 때 보내 줄 최근 출력 크기 */
const REPLAY_CHARS = 400_000

export class Terminals {
  /** @param {{ getConfig: () => any, onChange: () => void }} deps */
  constructor({ getConfig, onChange }) {
    this.getConfig = getConfig
    this.onChange = onChange
    /** @type {Map<string, any>} */
    this.items = new Map()
    /** 터미널 id → 출력을 받을 함수들 */
    this.listeners = new Map()
  }

  /** 실행할 프로그램과 인자. mode: claude | continue | resume | shell */
  command(mode, resumeId) {
    const config = this.getConfig()
    if (mode === 'shell') return { file: config.shell, args: [], label: config.shell.replace(/\.exe$/i, '') }
    const args = []
    if (config.usePluginDir && config.pluginDir && existsSync(config.pluginDir)) args.push('--plugin-dir', config.pluginDir)
    if (mode === 'continue') args.push('--continue')
    if (mode === 'resume') {
      if (!/^[A-Za-z0-9-]+$/.test(resumeId ?? '')) throw new Error('세션 id 형식이 올바르지 않습니다')
      args.push('--resume', resumeId)
    }
    const label = { claude: 'claude', continue: 'claude (이어서)', resume: 'claude (세션 재개)' }[mode] ?? 'claude'
    return { file: resolveClaude(config), args, label }
  }

  create({ cwd, projectId, projectName, mode = 'claude', resumeId, cols = 120, rows = 30 }) {
    if (!existsSync(cwd)) throw new Error(`폴더가 없습니다: ${cwd}`)
    const { file, args, label } = this.command(mode, resumeId)

    // 대시보드를 Claude Code 안에서 띄웠을 때 물려받는 표시를 지워, 터미널의 claude 가 새 세션으로 시작하게 한다.
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE_ENTRYPOINT

    const proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env, useConpty: true })
    const id = randomUUID()
    const item = {
      id,
      projectId,
      projectName,
      cwd,
      mode,
      title: `${projectName} · ${label}`,
      command: [file, ...args].join(' '),
      createdAt: Date.now(),
      exited: false,
      exitCode: null,
      buffer: '',
      proc,
    }
    this.items.set(id, item)

    proc.onData(data => {
      item.buffer = (item.buffer + data).slice(-REPLAY_CHARS)
      for (const fn of this.listeners.get(id) ?? []) fn({ t: 'out', id, data })
    })
    proc.onExit(({ exitCode }) => {
      item.exited = true
      item.exitCode = exitCode
      for (const fn of this.listeners.get(id) ?? []) fn({ t: 'exit', id, code: exitCode })
      this.onChange()
    })
    this.onChange()
    return this.public(item)
  }

  public(item) {
    const { proc, buffer, ...rest } = item
    return rest
  }

  list() {
    return [...this.items.values()].map(i => this.public(i))
  }

  /** 출력 구독. 붙자마자 최근 출력을 한 번 보낸다. 해제 함수를 돌려준다 */
  attach(id, send) {
    const item = this.items.get(id)
    if (!item) return null
    send({ t: 'replay', id, data: item.buffer, exited: item.exited, code: item.exitCode })
    if (!this.listeners.has(id)) this.listeners.set(id, new Set())
    this.listeners.get(id).add(send)
    return () => this.listeners.get(id)?.delete(send)
  }

  input(id, data) {
    const item = this.items.get(id)
    if (item && !item.exited && typeof data === 'string') item.proc.write(data)
  }

  resize(id, cols, rows) {
    const item = this.items.get(id)
    const ok = n => Number.isInteger(n) && n > 1 && n < 1000
    if (item && !item.exited && ok(cols) && ok(rows)) {
      try {
        item.proc.resize(cols, rows)
      } catch {
        // 막 끝난 프로세스
      }
    }
  }

  /** 탭 순서 바꾸기. 주어진 id 순서대로 앞에 두고, 빠진 터미널은 원래 순서대로 뒤에 둔다 */
  reorder(ids) {
    const wanted = (Array.isArray(ids) ? ids : []).filter(id => this.items.has(id))
    const rest = [...this.items.keys()].filter(id => !wanted.includes(id))
    this.items = new Map([...new Set([...wanted, ...rest])].map(id => [id, this.items.get(id)]))
    this.onChange()
  }

  /** 닫기: 돌고 있으면 끝내고 목록에서 뺀다 */
  close(id) {
    const item = this.items.get(id)
    if (!item) return false
    if (!item.exited) {
      try {
        item.proc.kill()
      } catch {
        // 이미 끝남
      }
    }
    this.items.delete(id)
    this.listeners.delete(id)
    this.onChange()
    return true
  }

  closeAll() {
    for (const id of [...this.items.keys()]) this.close(id)
  }
}
