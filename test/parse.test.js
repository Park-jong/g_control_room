import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseIssues, parseTeamRoadmap, parseTodo, parseWorklog } from '../server/parse.js'

const fixture = name => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')

test('TODO.md: 제목·스택·버전·진행 체크리스트', () => {
  const t = parseTodo(fixture('TODO.md'))
  assert.equal(t.title, '별빛 디펜스')
  assert.equal(t.stack, 'Phaser 4 + TypeScript + Vite, 테스트 vitest.')
  assert.equal(t.version, '0.2.0')
  assert.equal(t.stateDate, '2026-11-18')
  assert.deepEqual(
    t.pipeline.map(p => [p.step, p.status]),
    [
      [1, 'done'],
      [2, 'done'],
      [3, 'done'],
      [7, 'skipped'],
      [4, 'done'],
      [5, 'done'],
      [6, 'doing'],
      [8, 'todo'],
    ],
  )
  assert.equal(t.pipeline[3].note, '건너뜀: 나중에 배포')
  assert.equal(t.deploy, '(deploy-setup 후 주소)')
})

test('TODO.md: 단계·항목·목적과 진행 집계', () => {
  const t = parseTodo(fixture('TODO.md'))
  assert.equal(t.stages.length, 2)
  const [s1, s2] = t.stages
  assert.equal(s1.key, '1')
  assert.equal(s1.title, '핵심 루프')
  assert.equal(s1.status, 'done')
  assert.match(s1.purpose, /한 판을 끝까지/)
  assert.equal(s2.status, 'doing')
  assert.deepEqual(
    s2.items.map(i => [i.id, i.status]),
    [
      ['2-1', 'done'],
      ['2-2', 'doing'],
      ['2-3', 'todo'],
    ],
  )
  assert.equal(s2.items[0].why, '적 다양성이 핵심 재미')
  assert.equal(s2.items[0].text, '적 3종 데이터 추가 (numbers.md 2장)')
  assert.deepEqual(t.tasks, { total: 5, done: 3, doing: 1 })
})

test('TODO.md: 다음 할 일·결정 대기·완료 표·해석·결정 기록', () => {
  const t = parseTodo(fixture('TODO.md'))
  assert.deepEqual(t.next, ['2-2 마무리'])
  assert.deepEqual(t.pending.map(p => p.text), ['보스 등장 시점'])
  assert.deepEqual(t.completed[1], ['1', '핵심 루프', '0.1.0 abc1234'])
  assert.equal(t.interpretations.length, 1)
  assert.deepEqual(t.decisions, ['2026-11-17: 세로 화면으로 결정 — 이유: 모바일 우선'])
})

test('템플릿 그대로인 TODO.md 도 깨지지 않는다', () => {
  const t = parseTodo(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'gamestudio', 'skills', 'roadmap', 'todo-template.md'), 'utf8'))
  assert.equal(t.title, '<가제>')
  assert.equal(t.stages.length, 2)
  assert.deepEqual(t.decisions, [])
})

test('검증 문제 기록: 단계·횟수·예방 규칙, 주석 안의 예시는 무시', () => {
  const issues = parseIssues(fixture('verification-issues.md'))
  assert.deepEqual(
    issues.map(i => [i.id, i.level, i.count]),
    [
      ['V2', 'critical', 3],
      ['V1', 'warning', 2],
      ['V3', 'note', 1],
    ],
  )
  assert.equal(issues[0].rule, '빈 배열 테스트를 함께 쓴다')
  assert.equal(issues[1].cause, '렌더 루프에서 매 프레임 객체 생성')
})

test('팀 로드맵과 업무 기록', () => {
  const r = parseTeamRoadmap(fixture('team-roadmap.md'))
  assert.equal(r.todo.length, 2)
  assert.deepEqual(r.todo[0], { priority: 'P0', item: '저장 버그', source: 'REQ-003', owner: '클라이언트', status: '진행' })
  const w = parseWorklog(fixture('worklog.md'))
  assert.equal(w.length, 2)
  assert.equal(w[1].date, '2026-11-18')
  assert.equal(w[1].title, '적 3종')
  assert.ok(w[1].lines.some(l => l.startsWith('참여 팀원')))
})
