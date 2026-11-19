import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseStatus } from '../server/git.js'

test('git status: 브랜치·ahead/behind·파일 종류별 수를 읽는다', () => {
  const out = [
    '# branch.oid 0123456789abcdef',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 aaa bbb src/staged.ts',
    '1 .M N... 100644 100644 100644 aaa bbb src/unstaged.ts',
    '1 MM N... 100644 100644 100644 aaa bbb src/both.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 docs/새 이름.md\tdocs/old.md',
    'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts',
    '? 메모.txt',
    '',
  ].join('\n')

  const s = parseStatus(out)

  assert.equal(s.branch, 'main')
  assert.equal(s.upstream, 'origin/main')
  assert.equal(s.ahead, 2)
  assert.equal(s.behind, 1)
  assert.equal(s.staged, 3)
  assert.equal(s.unstaged, 2)
  assert.equal(s.conflicts, 1)
  assert.equal(s.untracked, 1)
  assert.equal(s.changedFiles, 6)
  assert.deepEqual(
    s.files.map(f => f.path),
    ['src/staged.ts', 'src/unstaged.ts', 'src/both.ts', 'docs/새 이름.md', 'src/conflict.ts', '메모.txt'],
  )
})

test('git status: 원격 브랜치가 없으면 upstream 이 비고 ahead/behind 는 0', () => {
  const s = parseStatus('# branch.oid (initial)\n# branch.head main\n')
  assert.equal(s.upstream, '')
  assert.equal(s.ahead, 0)
  assert.equal(s.changedFiles, 0)
})
