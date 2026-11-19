import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

let root
let summarize

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'cr-projects-'))
  // 실제 세션 기록을 읽지 않도록 Claude 기록 위치를 빈 임시 폴더로 바꾼 뒤 모듈을 불러온다
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  ;({ summarize } = await import('../server/projects.js'))
})

after(() => rmSync(root, { recursive: true, force: true }))

test('목록 요약: 현재 단계는 번호순, 결정 대기는 체크되지 않은 것만 센다', () => {
  const game = join(root, 'game')
  mkdirSync(game)
  copyFileSync(join(FIXTURES, 'TODO.md'), join(game, 'TODO.md'))

  const s = summarize({ id: 'g', path: game })

  assert.equal(s.current, '6. 개발')
  assert.deepEqual(
    s.pipeline.map(p => p.step),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
  assert.equal(s.decisions, 1)
  assert.ok(s.lastActivity > 0)
})
