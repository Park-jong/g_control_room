// control_room 대시보드 화면. 서버 API 로 데이터를 받고, WebSocket 으로 변경 알림과 터미널 입출력을 주고받는다.
// 파일과 세션 기록에서 온 글자는 모두 textContent 로만 넣는다 (HTML 로 해석하지 않음).

const $ = sel => document.querySelector(sel)

/** 요소 만들기: h('div', { class: 'x', onclick }, '글자', 자식요소, [자식들]) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

// 선 아이콘 (24×24, stroke). 고정 문자열이라 innerHTML 로 넣어도 안전하다
const ICONS = {
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  resume: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<path d="M5 12h14"/>',
  tasks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  commit: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  next: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="m12 16 4-4-4-4"/>',
  ask: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  cycle: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
}

/** 아이콘 요소. 뜻은 감싼 요소의 title/aria-label 로 전한다 */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = ICONS[name] ?? ''
  return svg
}

/** 아이콘만 있는 버튼. title 이 툴팁이자 읽기 이름 */
const iconBtn = (name, title, onclick, cls = 'ghost') => h('button', { class: `btn small icon-btn ${cls}`, type: 'button', title, 'aria-label': title, onclick }, icon(name))

const STATUS_ICON = { done: 'check', doing: 'play', skipped: 'minus' }

const STATUS_TEXT = { done: '완료', doing: '진행 중', todo: '대기', skipped: '건너뜀', running: '진행 중', waiting: '대기', failed: '실패', stale: '응답 없음' }
const REQ_STATUS = { open: '접수', accepted: '수락', in_progress: '처리 중', done: '완료', rejected: '반려' }
const TEAM_NAME = { design: '기획 팀', tech: '개발 팀', content: '콘텐츠 팀', qa: 'QA 팀', user: '사용자' }
const TEAM_SHORT = { design: '기획', tech: '개발', content: '콘텐츠', qa: 'QA', user: '사용자' }
const route = r => `${TEAM_SHORT[r.from] ?? r.from} → ${TEAM_SHORT[r.to] ?? r.to}`
const ROLE_LABEL = {
  'design-lead': '기획 팀장',
  'system-designer': '시스템 기획',
  'level-designer': '레벨 디자이너',
  'balance-designer': '밸런스 기획',
  'tech-lead': '개발 팀장',
  'client-programmer': '클라이언트',
  'server-programmer': '서버',
  'tools-engineer': '툴/빌드',
  'engine-engineer': '엔진/최적화',
  'content-lead': '콘텐츠 팀장',
  'scenario-writer': '시나리오 작가',
  'art-director': '아트 디렉터',
  modeler: '3D 모델러',
  'model-manager': '3D 모델 관리',
  'sound-designer': '사운드 기획',
  'qa-lead': 'QA 팀장',
  tester: '테스터',
  'code-reviewer': '코드 리뷰어',
  'fable-modeler': 'Fable 3D 모델러',
}
const QUICK = [
  { text: '/dev-team-status', enter: true, icon: 'users', label: '현황', title: '조직 현황' },
  { text: '/dev-team ', enter: false, icon: 'send', label: '맡기기', title: '조직에 작업 맡기기 (뒤에 작업 내용 입력)' },
  { text: '/gamestudio:dev-cycle ', enter: false, icon: 'cycle', label: '사이클', title: '코드 작업 사이클 (뒤에 작업 내용 입력)' },
  { text: '/gamestudio:new-game', enter: true, icon: 'next', label: '다음 단계', title: '진행 단계 확인·다음 단계' },
  { text: '/gamestudio:commit-release', enter: true, icon: 'commit', label: '커밋', title: '버전·CHANGELOG 확인 후 커밋' },
]

const state = {
  projects: [],
  /** 첫 목록을 받기 전에는 "게임 없음" 대신 불러오는 중으로 보인다 */
  loaded: false,
  selectedId: localGet('selected'),
  detail: null,
  /** 마지막으로 그린 상세 데이터. 같으면 다시 그리지 않는다 */
  detailJson: null,
  /** 작업 탭에서 사용자가 펴고 접은 단계 ("게임id:단계" → 펼침 여부). 다시 그려도 유지 */
  stageOpen: new Map(),
  /** 글자를 끌어 선택하는 동안 미뤄 둔 다시 그리기 */
  renderPending: false,
  /** 주소의 #탭이름 이 있으면 그 탭부터 (북마크용) */
  tab: location.hash.slice(1) || localGet('tab') || 'overview',
  reqFilter: 'open',
  terminals: [],
  activeTerm: null,
  config: null,
}

function localGet(k) {
  try {
    return localStorage.getItem(`cr.${k}`)
  } catch {
    return null
  }
}
function localSet(k, v) {
  try {
    localStorage.setItem(`cr.${k}`, v)
  } catch {
    // 저장 못 해도 동작에는 문제없음
  }
}

// ───────────── 서버 통신 ─────────────

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

function toast(text, isError = false) {
  const el = h('div', { class: `toast${isError ? ' error' : ''}`, role: 'status' }, text)
  document.body.append(el)
  setTimeout(() => el.remove(), isError ? 6000 : 2500)
}

const rel = ms => {
  if (!ms) return ''
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}
const dot = s => h('span', { class: 'dot', dataset: { s }, title: STATUS_TEXT[s] ?? s, 'aria-label': STATUS_TEXT[s] ?? s })

// ───────────── 데이터 불러오기 ─────────────

let loadingList = false
async function loadProjects() {
  if (loadingList) return
  loadingList = true
  try {
    state.projects = await api('projects')
    state.loaded = true
    if (!state.projects.some(p => p.id === state.selectedId)) state.selectedId = state.projects[0]?.id ?? null
    renderList()
    renderNewTermButton()
    renderTermTabs()
    if (state.selectedId) await loadDetail()
    else renderDetail()
  } catch (e) {
    toast(e.message, true)
  } finally {
    loadingList = false
  }
}

async function loadDetail() {
  const id = state.selectedId
  if (!id) return
  try {
    const d = await api(`projects/${id}`)
    if (state.selectedId !== id) return
    // Claude 가 일하는 동안 기록이 몇 초마다 바뀐다. 내용이 같으면 그대로 두고, 다르면 선택·펼침을 해치지 않게 다시 그린다
    const json = JSON.stringify(d)
    if (state.detail && json === state.detailJson) return
    state.detailJson = json
    state.detail = d
    refreshDetail()
  } catch (e) {
    toast(e.message, true)
  }
}

/** 상세 안에서 글자를 선택하고 있으면 선택이 풀릴 때까지 다시 그리기를 미룬다 */
function selectingInDetail() {
  const sel = window.getSelection()
  return Boolean(sel && !sel.isCollapsed && sel.rangeCount && $('#detail').contains(sel.getRangeAt(0).commonAncestorContainer))
}
function refreshDetail() {
  if (selectingInDetail()) {
    state.renderPending = true
    return
  }
  state.renderPending = false
  renderDetail()
}
document.addEventListener('selectionchange', () => {
  if (state.renderPending && !selectingInDetail()) refreshDetail()
})

function select(id) {
  state.selectedId = id
  localSet('selected', id)
  state.detail = null
  state.detailJson = null
  renderList()
  renderDetail()
  renderNewTermButton()
  loadDetail()
}

// ───────────── 게임 목록 ─────────────

function renderList() {
  const list = $('#game-list')
  list.replaceChildren(
    ...state.projects.map(p =>
      h(
        'li',
        {},
        h(
          'button',
          { class: 'game', type: 'button', 'aria-current': String(p.id === state.selectedId), onclick: () => select(p.id) },
          h(
            'div',
            { class: 'game-top' },
            h('span', { class: 'game-name' }, p.name),
            h('span', { class: 'faint game-when', title: [p.version && `v${p.version}`, p.lastActivity && `마지막 활동 ${new Date(p.lastActivity).toLocaleString()}`].filter(Boolean).join('\n') }, rel(p.lastActivity) || (p.version && `v${p.version}`)),
          ),
          h(
            'div',
            { class: 'game-sub' },
            h('span', { class: 'game-cur', title: p.hasTodo ? `현재 단계: ${p.current}` : '' }, p.error ?? (p.hasTodo ? [icon('flag'), p.current] : 'TODO.md 없음')),
            h(
              'span',
              { class: 'badges' },
              p.decisions > 0 && h('span', { class: 'badge ask', title: `내가 정해야 할 결정 대기 ${p.decisions}개` }, icon('ask'), p.decisions),
              p.runningAgents > 0 && h('span', { class: 'badge live', title: `진행 중 에이전트 ${p.runningAgents}명` }, icon('bot'), p.runningAgents),
              !p.runningAgents && p.activeSessions > 0 && h('span', { class: 'badge live', title: '최근 2분 안에 Claude 세션이 움직임' }, icon('terminal')),
              p.p0 > 0 && h('span', { class: 'badge danger', title: `P0 요청 ${p.p0}건 (현재 단계를 막는 문제)` }, icon('alert'), p.p0),
              p.openRequests > 0 && h('span', { class: 'badge', title: `열린 타 팀 요청 ${p.openRequests}건` }, icon('inbox'), p.openRequests),
              p.issues?.critical > 0 && h('span', { class: 'badge warn', title: `반드시 지킬 재발 방지 규칙 ${p.issues.critical}개` }, '🚨', p.issues.critical),
            ),
          ),
          !p.error && h('div', { class: 'mini-steps', 'aria-label': `개발 흐름 ${p.pipelineDone}/${p.pipeline.length} 단계 완료` }, p.pipeline.map(s => h('span', { dataset: { s: s.status }, title: `${s.step ?? ''}. ${s.label} — ${STATUS_TEXT[s.status]}` }))),
        ),
      ),
    ),
  )
  $('#game-count').textContent = state.projects.length ? `${state.projects.length}개` : ''
}

// ───────────── 상세 ─────────────

const TABS = [
  ['overview', '개요'],
  ['work', '작업'],
  ['teams', '팀·요청'],
  ['issues', '검증 기록'],
  ['sessions', '세션·에이전트'],
]

function renderDetail() {
  const root = $('#detail')
  if (!state.loaded) {
    root.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'))
    return
  }
  if (!state.projects.length) {
    root.replaceChildren(
      h(
        'div',
        { class: 'welcome' },
        h('h1', {}, '아직 등록된 게임이 없습니다'),
        h('p', {}, '설정에서 게임들이 모여 있는 상위 폴더나 게임 폴더를 추가하세요. TODO.md 나 .dev-team 이 있는 폴더를 게임으로 찾습니다.'),
        h('button', { class: 'btn primary', type: 'button', onclick: openSettings }, '게임 폴더 추가'),
      ),
    )
    return
  }
  const d = state.detail
  if (!d) {
    root.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'))
    return
  }
  if (d.error) {
    root.replaceChildren(h('div', { class: 'welcome' }, h('h1', {}, d.name), h('p', {}, `${d.error}: ${d.path}`)))
    return
  }
  const counts = {
    work: d.tasks.total ? `${d.tasks.done}/${d.tasks.total}` : '',
    teams: d.openRequests || '',
    issues: d.issues.length || '',
    sessions: d.runningAgents || d.activeSessions || '',
  }
  const body = { overview, work, teams, issues, sessions }[state.tab]?.(d) ?? overview(d)
  const scroll = root.scrollTop
  root.replaceChildren(
    h(
      'div',
      { class: 'detail-head' },
      h(
        'div',
        { style: 'min-width:0' },
        h(
          'div',
          { class: 'title-row' },
          h('h1', {}, d.name),
          d.version && h('span', { class: 'ver' }, `v${d.version}`),
          iconBtn('folder', `${d.path} (눌러서 경로 복사)`, () => navigator.clipboard?.writeText(d.path).then(() => toast('경로를 복사했습니다'), () => {})),
        ),
        d.todo?.stack && h('div', { class: 'stack', title: d.todo.stack }, d.todo.stack),
      ),
      h(
        'div',
        { class: 'head-actions' },
        h('button', { class: 'btn small primary', type: 'button', title: 'Claude 새 세션을 터미널에서 열기', onclick: () => newTerminal('claude') }, icon('play'), 'Claude'),
        h('button', { class: 'btn small', type: 'button', title: '마지막 세션 이어서', onclick: () => newTerminal('continue') }, icon('resume'), '이어서'),
        d.todo?.deploy && /^https?:\/\//.test(d.todo.deploy.split(' ')[0]) && h('a', { class: 'btn small ghost', href: d.todo.deploy.split(' ')[0], target: '_blank', rel: 'noreferrer', title: d.todo.deploy.split(' ')[0] }, icon('external'), '배포'),
      ),
    ),
    h(
      'div',
      { class: 'tabs', role: 'tablist' },
      TABS.map(([key, label]) =>
        h(
          'button',
          {
            class: 'tab',
            role: 'tab',
            type: 'button',
            'aria-selected': String(state.tab === key),
            onclick: () => {
              state.tab = key
              localSet('tab', key)
              history.replaceState(null, '', `#${key}`)
              renderDetail()
              $('#detail').scrollTop = 0
            },
          },
          label,
          counts[key] !== '' && h('span', { class: 'count' }, counts[key]),
        ),
      ),
    ),
    body,
  )
  root.scrollTop = scroll
}

const listOrEmpty = (items, empty = '없음') => (items.length ? h('ul', {}, items.map(t => h('li', {}, t))) : h('p', { class: 'empty' }, empty))

function overview(d) {
  const t = d.todo
  const reqP0 = d.requests.filter(r => r.priority === 'P0' && ['open', 'accepted', 'in_progress'].includes(r.status))
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'pipeline', 'aria-label': '개발 흐름' },
      d.pipeline.map(s =>
        h(
          'div',
          { class: 'step', dataset: { s: s.status }, title: [`${s.step ? `${s.step}단계 ` : ''}${s.label} — ${STATUS_TEXT[s.status]}`, s.note].filter(Boolean).join('\n') },
          h('div', { class: 'step-top' }, h('span', { class: 'step-num' }, s.step ?? ''), STATUS_ICON[s.status] && h('span', { class: 'step-icon' }, icon(STATUS_ICON[s.status]))),
          h('div', { class: 'step-label' }, s.label),
        ),
      ),
    ),
    !d.hasTodo && h('p', { class: 'muted' }, 'TODO.md 가 없습니다. 터미널에서 /gamestudio:new-game 으로 시작하면 진행 단계가 기록됩니다.'),
    h(
      'div',
      { class: 'stats' },
      stat('tasks', '작업', d.tasks.total ? `${d.tasks.done} / ${d.tasks.total}` : '–', d.tasks.doing ? `진행 중 ${d.tasks.doing}` : '', d.tasks.total ? d.tasks.done / d.tasks.total : null),
      stat('inbox', '열린 요청', String(d.openRequests), d.p0 ? `P0 ${d.p0}` : ''),
      stat('shield', '검증 기록', String(d.issues.length), d.issues.filter(i => i.level === 'critical').length ? `🚨 ${d.issues.filter(i => i.level === 'critical').length}` : ''),
      stat('bot', '에이전트', String(d.runningAgents), d.activeSessions ? `활동 세션 ${d.activeSessions}` : ''),
    ),
    h(
      'div',
      { class: 'grid-2' },
      h('div', { class: 'card' }, h('h3', {}, '현재 상태', t?.stateDate && h('span', { class: 'faint' }, t.stateDate)), listOrEmpty(t?.state ?? [])),
      h('div', { class: 'card' }, h('h3', {}, '다음 할 일'), listOrEmpty(t?.next ?? [])),
      h(
        'div',
        { class: `card${d.decisions ? ' attention' : ''}` },
        h('h3', {}, h('span', { class: 'h3-main' }, d.decisions > 0 && icon('ask'), '결정 대기'), d.decisions > 0 && h('span', { class: 'faint' }, '내가 정할 것')),
        listOrEmpty((t?.pending ?? []).filter(p => p.status !== 'done').map(p => p.text), '사용자가 정할 것이 없습니다'),
      ),
      reqP0.length > 0 && h('div', { class: 'card' }, h('h3', { title: '현재 단계를 막는 문제' }, 'P0 요청'), listOrEmpty(reqP0.map(r => `${r.id} ${route(r)} · ${r.title}`))),
      h('div', { class: 'card' }, h('h3', {}, '최근 결정 기록'), listOrEmpty((t?.decisions ?? []).slice(-5).reverse())),
    ),
  )
}

function stat(iconName, label, value, note, ratio = null) {
  return h(
    'div',
    { class: 'stat' },
    h('div', { class: 'stat-label' }, icon(iconName), label),
    h('div', { class: 'stat-value' }, value),
    note && h('div', { class: 'stat-note' }, note),
    ratio !== null && h('div', { class: 'bar' }, h('span', { style: `width:${Math.round(ratio * 100)}%` })),
  )
}

function work(d) {
  const t = d.todo
  if (!t) return h('p', { class: 'empty' }, 'TODO.md 가 없습니다. /gamestudio:roadmap 으로 단계 계획을 만들면 여기에 표시됩니다.')
  const firstOpen = t.stages.findIndex(s => s.status !== 'done')
  return h(
    'div',
    {},
    t.completed.length > 0 &&
      h(
        'div',
        { class: 'card', style: 'margin-bottom:14px' },
        h('h3', {}, '완료된 단계'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '단계'), h('th', {}, '내용'), h('th', {}, '버전·커밋'))), h('tbody', {}, t.completed.map(r => h('tr', {}, r.slice(0, 3).map(c => h('td', {}, c))))))),
      ),
    t.stages.length === 0 && h('p', { class: 'empty' }, '작업 목록에 단계가 없습니다.'),
    t.stages.map((s, i) => {
      const done = s.items.filter(x => x.status === 'done' || x.status === 'skipped').length
      const key = `${d.id}:${s.key}`
      return h(
        'details',
        {
          class: 'stage',
          open: state.stageOpen.get(key) ?? (i === firstOpen || s.status === 'doing'),
          ontoggle: ev => state.stageOpen.set(key, ev.currentTarget.open),
        },
        h(
          'summary',
          {},
          h('span', { class: 'stage-key' }, `${s.key}단계`),
          h('span', { class: 'stage-name' }, dot(s.status), h('span', { class: 'stage-title' }, s.title)),
          h('span', { class: 'stage-prog' }, s.items.length ? `${done}/${s.items.length}` : ''),
        ),
        h(
          'div',
          { class: 'stage-body' },
          h(
            'dl',
            { class: 'meta' },
            [
              ['목적(왜)', s.purpose],
              ['완료 조건', s.done],
              ['범위 밖', s.outOfScope],
              ['위험', s.risk],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
          ),
          s.items.length
            ? h(
                'ul',
                { class: 'items' },
                s.items.map(it => h('li', {}, dot(it.status), h('span', { class: 'iid' }, it.id), h('span', {}, it.text, it.why && h('span', { class: 'why' }, `왜: ${it.why}`)))),
              )
            : h('p', { class: 'empty' }, '항목 없음'),
        ),
      )
    }),
    h('div', { class: 'grid-2', style: 'margin-top:14px' }, h('div', { class: 'card' }, h('h3', {}, '코드가 정한 해석'), listOrEmpty(t.interpretations)), h('div', { class: 'card' }, h('h3', {}, '결정 기록'), listOrEmpty([...t.decisions].reverse()))),
  )
}

function teams(d) {
  const isOpen = r => ['open', 'accepted', 'in_progress'].includes(r.status)
  const reqs = state.reqFilter === 'open' ? d.requests.filter(isOpen) : d.requests
  const setFilter = f => () => {
    state.reqFilter = f
    renderDetail()
  }
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'card', style: 'margin-bottom:14px' },
      h(
        'h3',
        {},
        '타 팀 요청',
        h(
          'span',
          { class: 'filter' },
          h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': String(state.reqFilter === 'open'), onclick: setFilter('open') }, `열린 요청 ${d.requests.filter(isOpen).length}`),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': String(state.reqFilter === 'all'), onclick: setFilter('all') }, `전체 ${d.requests.length}`),
        ),
      ),
      reqs.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              {},
              h('thead', {}, h('tr', {}, ['ID', '순위', '방향', '유형', '제목', '상태', '접수'].map(c => h('th', {}, c)))),
              h(
                'tbody',
                {},
                reqs.map(r =>
                  h(
                    'tr',
                    { class: isOpen(r) ? '' : 'closed', title: r.priorityReason ? `우선순위 근거: ${r.priorityReason}` : '' },
                    h('td', {}, r.id),
                    h('td', {}, h('span', { class: 'prio', dataset: { p: r.priority } }, r.priority)),
                    h('td', { class: 'nowrap' }, route(r)),
                    h('td', { class: 'nowrap' }, r.kind === 'feedback' ? '피드백' : '요구'),
                    h('td', {}, r.title),
                    h('td', {}, REQ_STATUS[r.status] ?? r.status),
                    h('td', {}, r.createdAt),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'empty' }, '요청이 없습니다'),
    ),
    h(
      'div',
      { class: 'grid-2' },
      d.teams.map(t =>
        h(
          'div',
          { class: 'card' },
          h('h3', {}, t.label, t.todo.length > 0 && h('span', { class: 'faint' }, `할 일 ${t.todo.length}`)),
          t.goal && h('p', { class: 'muted', style: 'margin:0 0 8px' }, t.goal),
          t.todo.length
            ? h('ul', {}, t.todo.slice(0, 6).map(x => h('li', {}, h('span', { class: 'prio', dataset: { p: x.priority } }, x.priority), ' ', x.item, x.status && h('span', { class: 'faint' }, ` · ${x.status}`))))
            : h('p', { class: 'empty' }, '할 일 없음'),
          h('h3', { style: 'margin-top:12px' }, '최근 업무 기록'),
          t.worklog.length
            ? t.worklog.map(w => h('div', { style: 'margin-bottom:8px' }, h('div', {}, h('strong', {}, w.title), ' ', h('span', { class: 'faint' }, w.date)), listOrEmpty(w.lines.slice(0, 4))))
            : h('p', { class: 'empty' }, '기록 없음'),
        ),
      ),
    ),
  )
}

function issues(d) {
  if (!d.issues.length) return h('p', { class: 'empty' }, '검증 문제 기록이 없습니다. dev-cycle 의 QA 단계에서 문제가 나오면 docs/verification-issues.md 에 쌓입니다.')
  const lv = { critical: ['🚨', '반드시 지킬 규칙'], warning: ['⚠️', '주의'], note: ['', '기록'] }
  return h(
    'div',
    {},
    d.issues.map(i =>
      h(
        'div',
        { class: 'issue', dataset: { l: i.level } },
        h('div', { class: 'issue-title' }, lv[i.level]?.[0] && h('span', { title: lv[i.level][1] }, lv[i.level][0]), `${i.id}. ${i.title}`, h('span', { class: 'faint', title: `${i.count}번 나옴` }, `×${i.count}`)),
        i.rule && h('div', { class: 'issue-rule', title: '예방 규칙' }, icon('shield'), h('span', {}, i.rule)),
        h(
          'dl',
          { class: 'issue-meta' },
          [
            ['원인', i.cause],
            ['확인', i.check],
            ['발생', i.occurred],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
        ),
      ),
    ),
  )
}

function orgTree(live) {
  const label = r => live.labels?.[r] ?? ROLE_LABEL[r] ?? r
  const role = r => {
    const st = live.roles?.[r] ?? { status: 'waiting', runs: 0 }
    return h(
      'div',
      { class: `role${st.status === 'waiting' ? ' idle' : ''}` },
      dot(st.status),
      h('span', {}, label(r)),
      st.status !== 'waiting' && h('span', { class: 'faint' }, STATUS_TEXT[st.status] + (st.runs > 1 ? ` · ${st.runs}회차` : '') + (st.detail ? ` · ${st.detail}` : '')),
      st.status === 'running' && st.task && h('span', { class: 'task' }, `— ${st.task}`),
    )
  }
  return h(
    'div',
    { class: 'org' },
    h('div', { class: 'role' }, dot(live.active && Object.values(live.roles ?? {}).some(s => s.status === 'running') ? 'running' : 'waiting'), h('strong', {}, '총괄 디렉터 (메인 세션)')),
    (live.teams ?? []).map(t => {
      const busy = [t.lead, ...t.members].some(r => (live.roles?.[r]?.status ?? 'waiting') !== 'waiting')
      return h('div', { class: 'org-team' }, role(t.lead), busy ? h('div', { class: 'org-team' }, t.members.map(role)) : h('div', { class: 'faint', style: 'font-size:12px;margin-left:18px' }, `팀원 ${t.members.length}명`))
    }),
    (live.extra ?? []).filter(r => live.roles?.[r]).map(r => h('div', { style: 'margin-top:6px' }, role(r))),
  )
}

function sessions(d) {
  const activeLive = d.live.filter(l => l.active)
  const pastLive = d.live.filter(l => !l.active && l.task)
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'grid-2', style: 'margin-bottom:14px' },
      activeLive.length
        ? activeLive.map(l => h('div', { class: 'card' }, h('h3', {}, '조직 현황 · 진행 중', h('span', { class: 'faint' }, rel(l.updatedAt))), l.task && h('p', { style: 'margin:0 0 8px' }, `작업: ${l.task}`), orgTree(l)))
        : h('div', { class: 'card' }, h('h3', {}, '조직 현황'), h('p', { class: 'empty', title: '터미널에서 /dev-team <작업> 으로 맡기면 팀장·팀원 진행 상황이 여기에 보입니다' }, '진행 중인 조직 작업이 없습니다')),
      pastLive.length > 0 && h('div', { class: 'card' }, h('h3', {}, '최근 조직 작업'), listOrEmpty(pastLive.slice(0, 5).map(l => `${l.task} · ${rel(l.updatedAt)}${l.ended ? ' · 세션 종료' : ''}`))),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Claude Code 세션', h('span', { class: 'faint' }, `최근 ${d.sessions.length}개`)),
      d.sessions.length
        ? d.sessions.map(s =>
            h(
              'div',
              { class: 'session' },
              h(
                'div',
                { class: 'session-top' },
                h(
                  'div',
                  { style: 'min-width:0' },
                  h('div', { class: 'session-title' }, s.title),
                  h('div', { class: 'session-meta' }, h('span', { title: `세션 ${s.id}` }, rel(s.updatedAt)), s.agents.length > 0 && h('span', { title: `서브에이전트 ${s.agents.length}개` }, icon('bot'), s.agents.length)),
                ),
                h('div', { class: 'head-actions' }, s.active && h('span', { class: 'badge live', title: '최근 2분 안에 움직임' }, '활동 중'), iconBtn('terminal', '이 세션을 터미널에서 재개', () => newTerminal('resume', s.id), '')),
              ),
              s.agents.length > 0 &&
                h(
                  'ul',
                  { class: 'agents' },
                  s.agents.slice(0, 12).map(a =>
                    h('li', {}, dot(a.status), h('span', {}, ROLE_LABEL[a.role] ?? a.type), h('span', { class: 'muted' }, a.description), h('span', { class: 'faint' }, `${a.model} · ${rel(a.updatedAt)}`)),
                  ),
                ),
            ),
          )
        : h('p', { class: 'empty' }, '이 폴더에서 실행한 Claude Code 세션이 없습니다.'),
    ),
  )
}

// ───────────── 터미널 ─────────────

const views = new Map() // 터미널 id → { term, fit, el, attached }
const TERM_THEME = {
  background: '#0b0e13',
  foreground: '#d8dce6',
  cursor: '#7c8aff',
  selectionBackground: '#3a4a8a88',
  black: '#1c212b',
  brightBlack: '#5d667a',
}

function ensureView(item) {
  if (views.has(item.id)) return views.get(item.id)
  const el = h('div', { class: 'term-view', hidden: true })
  $('#term-host').append(el)
  const term = new window.Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: TERM_THEME,
  })
  const fit = new window.FitAddon.FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new window.WebLinksAddon.WebLinksAddon())
  term.open(el)
  // 글자를 선택한 채 Ctrl+C 는 복사 (선택이 없으면 그대로 중단 신호를 보냄)
  term.attachCustomKeyEventHandler(ev => {
    if (ev.type === 'keydown' && ev.ctrlKey && (ev.key === 'c' || ev.key === 'C') && term.hasSelection()) {
      navigator.clipboard?.writeText(term.getSelection()).catch(() => {})
      term.clearSelection()
      return false
    }
    return true
  })
  term.onData(data => wsSend({ t: 'in', id: item.id, data }))
  term.onResize(({ cols, rows }) => wsSend({ t: 'resize', id: item.id, cols, rows }))
  const view = { term, fit, el, attached: false }
  views.set(item.id, view)
  return view
}

function attachView(id) {
  const v = views.get(id)
  if (v && !v.attached && ws?.readyState === WebSocket.OPEN) {
    v.attached = true
    wsSend({ t: 'attach', id })
  }
}

function fitActive() {
  const v = views.get(state.activeTerm)
  if (!v || $('#term-panel').classList.contains('collapsed')) return
  try {
    v.fit.fit()
    wsSend({ t: 'resize', id: state.activeTerm, cols: v.term.cols, rows: v.term.rows })
  } catch {
    // 숨겨져 있어 크기를 잴 수 없음
  }
}

function showTerminal(id) {
  state.activeTerm = id
  for (const [tid, v] of views) v.el.hidden = tid !== id
  renderTermTabs()
  if (id) {
    attachView(id)
    requestAnimationFrame(() => {
      fitActive()
      views.get(id)?.term.focus()
    })
  }
}

function renderTermTabs() {
  const tabs = $('#term-tabs')
  tabs.replaceChildren(
    ...state.terminals.map(t =>
      h(
        'div',
        { class: `term-tab${t.exited ? ' exited' : ''}`, role: 'tab', 'aria-selected': String(t.id === state.activeTerm), title: t.command, onclick: () => showTerminal(t.id) },
        h('span', { class: 'state', 'aria-label': t.exited ? '종료됨' : '실행 중' }),
        h('span', { class: 'label' }, t.title),
        h(
          'button',
          {
            class: 'close',
            type: 'button',
            title: t.exited ? '닫기' : '종료하고 닫기',
            'aria-label': '터미널 닫기',
            onclick: ev => {
              ev.stopPropagation()
              closeTerminal(t)
            },
          },
          '×',
        ),
      ),
    ),
  )
  // 열린 터미널이 없으면 탭 줄만 남기고 아래 칸을 줄여 상세 화면에 자리를 준다
  const empty = !state.terminals.length
  $('#term-panel').classList.toggle('empty', empty)
  if (empty) tabs.append(h('span', { class: 'term-hint', title: '브라우저를 새로 고쳐도 터미널은 계속 실행됩니다' }, icon('terminal'), state.selectedId ? '열린 터미널 없음' : '게임을 먼저 등록하세요'))
  requestAnimationFrame(fitActive)
}

function renderQuick() {
  $('#quick').replaceChildren(
    h('span', { class: 'label', title: '빠른 명령: 실행 중인 Claude 터미널에 입력합니다' }, icon('zap')),
    ...QUICK.map(q =>
      h(
        'button',
        {
          class: 'btn small ghost',
          type: 'button',
          title: `${q.title}\n${q.text.trim()}`,
          'aria-label': q.title,
          onclick: () => {
            const t = state.terminals.find(x => x.id === state.activeTerm)
            if (!t || t.exited) return toast('실행 중인 Claude 터미널을 먼저 여세요', true)
            wsSend({ t: 'in', id: t.id, data: q.text + (q.enter ? '\r' : '') })
            views.get(t.id)?.term.focus()
          },
        },
        icon(q.icon),
        h('span', { class: 'q-label' }, q.label),
      ),
    ),
  )
}

function renderNewTermButton() {
  $('#new-term').disabled = !state.selectedId
}

async function newTerminal(mode, resumeId) {
  if (!state.selectedId) return
  $('#new-term-menu').hidden = true
  setCollapsed(false)
  try {
    const item = await api('terminals', { method: 'POST', body: { projectId: state.selectedId, mode, resumeId, cols: 120, rows: 30 } })
    upsertTerminal(item)
    showTerminal(item.id)
  } catch (e) {
    toast(e.message, true)
  }
}

async function closeTerminal(t) {
  if (!t.exited && !confirm(`"${t.title}" 터미널을 종료할까요? 실행 중인 작업도 함께 끝납니다.`)) return
  try {
    await api(`terminals/${t.id}`, { method: 'DELETE' })
  } catch (e) {
    toast(e.message, true)
  }
}

function upsertTerminal(item) {
  const i = state.terminals.findIndex(t => t.id === item.id)
  if (i >= 0) state.terminals[i] = item
  else state.terminals.push(item)
  ensureView(item)
}

/** 서버의 터미널 목록과 맞춘다 (다른 탭에서 열고 닫은 것 포함) */
function syncTerminals(items) {
  const ids = new Set(items.map(i => i.id))
  for (const [id, v] of views) {
    if (!ids.has(id)) {
      v.term.dispose()
      v.el.remove()
      views.delete(id)
    }
  }
  state.terminals = items
  for (const item of items) ensureView(item)
  if (!ids.has(state.activeTerm)) state.activeTerm = items.at(-1)?.id ?? null
  showTerminal(state.activeTerm)
}

function setCollapsed(c) {
  $('#term-panel').classList.toggle('collapsed', c)
  const toggle = $('#term-toggle')
  toggle.replaceChildren(icon(c ? 'up' : 'down'))
  toggle.title = c ? '터미널 펴기' : '터미널 접기'
  toggle.setAttribute('aria-label', toggle.title)
  localSet('termCollapsed', c ? '1' : '')
  if (!c) requestAnimationFrame(fitActive)
}

// 터미널 높이 조절
function setupSplitter() {
  const panel = $('#term-panel')
  const saved = Number(localGet('termHeight'))
  if (saved > 80) panel.style.setProperty('--term-h', `${saved}px`)
  const splitter = $('#splitter')
  splitter.addEventListener('pointerdown', ev => {
    splitter.setPointerCapture(ev.pointerId)
    splitter.classList.add('dragging')
    const move = e => {
      const height = Math.min(window.innerHeight - 160, Math.max(120, window.innerHeight - e.clientY))
      panel.style.setProperty('--term-h', `${height}px`)
      localSet('termHeight', String(Math.round(height)))
      if (panel.classList.contains('collapsed')) setCollapsed(false)
    }
    const up = () => {
      splitter.classList.remove('dragging')
      splitter.removeEventListener('pointermove', move)
      fitActive()
    }
    splitter.addEventListener('pointermove', move)
    splitter.addEventListener('pointerup', up, { once: true })
  })
  new ResizeObserver(() => fitActive()).observe($('#term-host'))
}

// ───────────── WebSocket ─────────────

let ws = null
let retry = 0
const wsSend = msg => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))

let changeTimer = null
function connect() {
  const conn = $('#conn')
  ws = new WebSocket(`ws://${location.host}/ws`)
  ws.addEventListener('open', () => {
    retry = 0
    // 연결되어 있을 때는 초록 점만 보이고, 문제가 있을 때만 글자를 띄운다
    conn.dataset.state = 'open'
    conn.textContent = ''
    conn.title = '서버에 연결됨'
    for (const v of views.values()) v.attached = false
    for (const v of views.values()) v.term.reset()
    if (state.activeTerm) attachView(state.activeTerm)
    loadProjects()
  })
  ws.addEventListener('message', ev => {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.t === 'out') views.get(msg.id)?.term.write(msg.data)
    else if (msg.t === 'replay') {
      const v = views.get(msg.id)
      if (v) {
        v.term.reset()
        v.term.write(msg.data)
        if (msg.exited) v.term.write(`\r\n\x1b[90m[프로세스 종료: ${msg.code}]\x1b[0m\r\n`)
      }
    } else if (msg.t === 'exit') {
      views.get(msg.id)?.term.write(`\r\n\x1b[90m[프로세스 종료: ${msg.code ?? '?'}]\x1b[0m\r\n`)
    } else if (msg.t === 'terminals') syncTerminals(msg.items)
    else if (msg.t === 'projects') loadProjects()
    else if (msg.t === 'changed') {
      // 활동 중에는 기록이 자주 바뀌므로 묶어서 한 번만 다시 불러온다
      clearTimeout(changeTimer)
      changeTimer = setTimeout(async () => {
        try {
          state.projects = await api('projects')
          renderList()
        } catch {
          // 다음 알림 때 다시
        }
        if (msg.ids.includes(state.selectedId)) loadDetail()
      }, 400)
    }
  })
  ws.addEventListener('close', () => {
    conn.dataset.state = 'closed'
    conn.textContent = '연결 끊김 · 다시 연결 중'
    conn.title = ''
    setTimeout(connect, Math.min(10000, 500 * 2 ** retry++))
  })
}

// ───────────── 설정 ─────────────

async function openSettings() {
  const dlg = $('#settings')
  const form = $('#settings-form')
  $('#settings-error').hidden = true
  try {
    state.config = await api('config')
  } catch (e) {
    return toast(e.message, true)
  }
  const c = state.config
  form.roots.value = c.roots.join('\n')
  form.projects.value = c.projects.join('\n')
  form.claudePath.value = c.claudePath
  form.claudePath.placeholder = c.claudeResolved
  form.pluginDir.value = c.pluginDir
  form.usePluginDir.checked = c.usePluginDir
  form.shell.value = c.shell
  dlg.showModal()
}

function setupSettings() {
  const dlg = $('#settings')
  const form = $('#settings-form')
  $('#open-settings').addEventListener('click', openSettings)
  $('#settings-cancel').addEventListener('click', () => dlg.close())
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const lines = v => v.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    try {
      state.config = await api('config', {
        method: 'PUT',
        body: {
          roots: lines(form.roots.value),
          projects: lines(form.projects.value),
          claudePath: form.claudePath.value,
          pluginDir: form.pluginDir.value,
          usePluginDir: form.usePluginDir.checked,
          shell: form.shell.value,
        },
      })
      dlg.close()
      toast('저장했습니다')
      loadProjects()
    } catch (e) {
      const err = $('#settings-error')
      err.textContent = e.message
      err.hidden = false
    }
  })
}

// ───────────── 시작 ─────────────

function setupMenus() {
  const menu = $('#new-term-menu')
  $('#new-term').addEventListener('click', ev => {
    ev.stopPropagation()
    menu.hidden = !menu.hidden
  })
  menu.addEventListener('click', ev => {
    const mode = ev.target.closest('button')?.dataset.mode
    if (mode) newTerminal(mode)
  })
  document.addEventListener('click', () => (menu.hidden = true))
  $('#term-toggle').addEventListener('click', () => setCollapsed(!$('#term-panel').classList.contains('collapsed')))
}

$('#open-settings').replaceChildren(icon('settings'))
$('#new-term').replaceChildren(icon('plus'), icon('down'))
setupSettings()
setupMenus()
setupSplitter()
renderQuick()
renderNewTermButton()
renderTermTabs()
setCollapsed(localGet('termCollapsed') === '1')
renderDetail()
connect()
// 상대 시간("3분 전")이 낡지 않게 가끔 다시 그린다
setInterval(() => {
  renderList()
  if (state.detail && state.tab === 'sessions') refreshDetail()
}, 30000)
