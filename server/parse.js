// gamestudio 플러그인이 만드는 기록 파일(TODO.md, .dev-team/, docs/verification-issues.md)을 화면용 데이터로 바꾼다.
// 형식은 플러그인 템플릿이 정하지만 사람이 고치기도 하므로, 못 읽는 줄은 버리고 계속 진행한다.

/** 체크 표시 → 상태. 템플릿: [ ] 대기 / [~] 진행 중 / [x] 완료 / [-] 건너뜀 */
const CHECK = { ' ': 'todo', '~': 'doing', x: 'done', X: 'done', '-': 'skipped' }
const CHECK_LINE = /^\s*-\s*\[([ xX~-])\]\s*(.*)$/

/** 마크다운을 heading 단위로 나눈다. level 2(##)와 3(###)만 쓴다 */
export function splitSections(md, level) {
  const mark = '#'.repeat(level) + ' '
  const out = []
  let cur = null
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith(mark)) {
      cur = { title: line.slice(mark.length).trim(), lines: [] }
      out.push(cur)
    } else if (cur && !(level === 3 && /^## /.test(line))) {
      cur.lines.push(line)
    } else if (cur && level === 3) {
      cur = null
    }
  }
  return out
}

const findSection = (sections, test) => sections.find(s => test(s.title))
const nonEmpty = lines => lines.map(l => l.trimEnd()).filter(l => l.trim() !== '' && l.trim() !== '---')
/** "- 내용" / "1. 내용" 목록 항목만, 기호를 뗀 내용으로 */
const listItems = lines =>
  nonEmpty(lines)
    .map(l => /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l)?.[1])
    .filter(t => t !== undefined && t !== '' && !/^\[[ xX~-]\]\s*$/.test(t) && t !== '(없음)')

function parseCheck(line) {
  const m = CHECK_LINE.exec(line)
  if (!m) return null
  return { status: CHECK[m[1]] ?? 'todo', text: m[2].trim() }
}

/** 표에서 머리줄·구분줄을 뺀 데이터 행. 각 행은 칸 배열 */
export function tableRows(lines) {
  const rows = lines.filter(l => l.trim().startsWith('|'))
  return rows
    .slice(2)
    .map(r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()))
    .filter(cells => cells.some(c => c !== ''))
}

/** "## gamestudio 진행"(예전 "## gamemanager 진행"·"## gamekit 진행") 체크리스트 → 개발 흐름 8단계.
 *  TODO.md 의 줄 순서와 상관없이 단계 번호순으로 돌려준다. 번호 없는 줄은 뒤에 원래 순서대로 둔다. */
function parsePipeline(sections) {
  const sec = findSection(sections, t => /^(gamestudio|gamemanager|gamekit) 진행/.test(t))
  if (!sec) return []
  return sec.lines
    .map(parseCheck)
    .filter(Boolean)
    .map(({ status, text }) => {
      // "6. 개발 (메모) — 덧붙인 말" 처럼 괄호 메모 뒤에 말이 더 붙어도 번호·이름·메모를 읽는다
      const m = /^(\d+)\.\s*(.*)$/.exec(text)
      if (!m) return { step: null, label: text, note: '', status }
      const rest = m[2]
      const label = rest.split(/\s*[(—]/)[0].trim()
      const paren = /\((.*)\)/.exec(rest)?.[1] ?? ''
      const tail = /—\s*([^()]*)$/.exec(rest)?.[1].trim() ?? ''
      return { step: Number(m[1]), label, note: [paren, tail].filter(Boolean).join(' — '), status }
    })
    .sort((a, b) => (a.step ?? Infinity) - (b.step ?? Infinity))
}

/** "### 3단계: 이름" 블록 → 목적·완료 조건·범위 밖·위험과 항목들 */
function parseStage(sec) {
  const meta = {}
  const items = []
  for (const line of sec.lines) {
    const item = parseCheck(line)
    if (item) {
      const m = /^(\S+?)\.\s+(.*)$/.exec(item.text)
      const [text, why] = (m ? m[2] : item.text).split(/\s+—\s+왜:\s*/)
      items.push({ id: m ? m[1] : '', text: text.trim(), why: why?.trim() ?? '', status: item.status })
      continue
    }
    const kv = /^(목적(?:\(왜\))?|완료 조건(?:\(무엇\))?|범위 밖|위험)\s*:\s*(.*)$/.exec(line.trim())
    if (kv) {
      const key = { 목적: 'purpose', 완료: 'done', 범위: 'outOfScope', 위험: 'risk' }[kv[1].split(/[ (]/)[0]]
      meta[key] = kv[2].trim()
    }
  }
  const m = /^(\S+)단계\s*[:：]\s*(.*)$/.exec(sec.title)
  const doneCount = items.filter(i => i.status === 'done' || i.status === 'skipped').length
  return {
    key: m ? m[1] : sec.title,
    title: m ? m[2].trim() : sec.title,
    ...meta,
    items,
    status:
      items.length === 0 ? 'todo' : doneCount === items.length ? 'done' : items.some(i => i.status !== 'todo') ? 'doing' : 'todo',
  }
}

/** TODO.md 전체 */
export function parseTodo(md) {
  const h2 = splitSections(md, 2)
  const title = (/^#\s+(.+)$/m.exec(md)?.[1] ?? '').replace(/\s*작업 목록\s*$/, '').trim()
  const stack = /^기술 스택\s*:\s*(.+)$/m.exec(md)?.[1]?.trim() ?? ''

  const stateSec = findSection(h2, t => t.startsWith('현재 상태'))
  const stateHead = stateSec ? /\(([^)]*)\)/.exec(stateSec.title)?.[1] ?? '' : ''
  const state = stateSec ? listItems(stateSec.lines) : []
  const deploy = state.map(l => /^배포\s*:\s*(.*)$/.exec(l)?.[1]).find(Boolean) ?? ''

  const workSec = findSection(h2, t => t.startsWith('작업 목록'))
  const h3 = workSec ? splitSections(['## x', ...workSec.lines].join('\n'), 3) : []
  const completedSec = h3.find(s => s.title === '완료')
  const stages = h3.filter(s => /단계/.test(s.title) && s.title !== '완료').map(parseStage)

  const items = stages.flatMap(s => s.items)
  return {
    title,
    stack,
    version: /v(\d+\.\d+\.\d+)/.exec(stateHead)?.[1] ?? '',
    stateDate: /(\d{4}-\d{2}-\d{2})/.exec(stateHead)?.[1] ?? '',
    pipeline: parsePipeline(h2),
    state,
    deploy,
    next: listItems(findSection(h2, t => t.startsWith('다음 할 일'))?.lines ?? []),
    pending: (findSection(h2, t => t.startsWith('결정 대기'))?.lines ?? [])
      .map(parseCheck)
      .filter(c => c && c.text !== ''),
    completed: completedSec ? tableRows(completedSec.lines) : [],
    stages,
    tasks: {
      total: items.length,
      done: items.filter(i => i.status === 'done' || i.status === 'skipped').length,
      doing: items.filter(i => i.status === 'doing').length,
    },
    interpretations: listItems(findSection(h2, t => t.startsWith('코드가 정한 해석'))?.lines ?? []).filter(l => !l.startsWith('<')),
    decisions: listItems(findSection(h2, t => t.startsWith('결정 기록'))?.lines ?? []).filter(l => !/^YYYY/.test(l)),
  }
}

/** docs/verification-issues.md → 항목들 (🚨 3회 이상 / ⚠️ 2회 / 기록 1회) */
export function parseIssues(md) {
  const body = md.replace(/<!--[\s\S]*?-->/g, '')
  return splitSections(body, 3)
    .map(sec => {
      const m = /^(🚨|⚠️)?\s*(V\d+)\.\s*(.*?)\s*(?:\((\d+)회\))?\s*$/u.exec(sec.title)
      if (!m) return null
      const field = name =>
        sec.lines.map(l => new RegExp(`^\\s*-\\s*\\**${name}\\**\\s*:\\s*(.*)$`).exec(l)?.[1]).find(Boolean)?.replace(/\*\*/g, '').trim() ?? ''
      const count = Number(m[4] ?? 1)
      return {
        id: m[2],
        title: m[3],
        count,
        level: m[1] === '🚨' || count >= 3 ? 'critical' : m[1] ? 'warning' : 'note',
        rule: field('예방 규칙'),
        cause: field('근본 원인'),
        check: field('확인 방법'),
        occurred: field('발생'),
      }
    })
    .filter(Boolean)
}

/** 팀 로드맵 → "할 일" 표 행 */
export function parseTeamRoadmap(md) {
  const h2 = splitSections(md, 2)
  const todo = findSection(h2, t => t.startsWith('할 일'))
  const goal = findSection(h2, t => t.includes('목표'))
  return {
    goal: goal ? nonEmpty(goal.lines).join(' ') : '',
    todo: todo ? tableRows(todo.lines).map(([priority, item, source, owner, status]) => ({ priority, item, source, owner, status })) : [],
  }
}

/** 팀 업무 기록 → 항목들 (최근 것이 마지막) */
export function parseWorklog(md) {
  return splitSections(md, 2).map(sec => {
    const m = /^(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.*)$/.exec(sec.title)
    return { date: m?.[1] ?? '', title: m?.[2] ?? sec.title, lines: listItems(sec.lines) }
  })
}
