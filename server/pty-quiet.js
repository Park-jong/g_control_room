// node-pty(1.1.0)의 Windows 터미널 종료 때 서버 창에 찍히는 "AttachConsole failed" 스택을 막는다.
//
// 원인: kill() 이 콘솔 프로세스 목록을 얻는 보조 프로세스(conpty_console_list_agent)를 fork 한 직후 의사 콘솔을 닫는다.
// 보조 프로세스가 콘솔에 붙을 때는 셸이 이미 끝나 있어 예외로 죽고, 그 스택이 부모의 stderr 로 그대로 나온다.
// 터미널은 정상적으로 닫히고(node-pty 가 5초 뒤 셸 pid 만 정리), 서버도 영향이 없어서 이 보조 프로세스의 출력만 버린다.
// node-pty 를 고친 버전이 나오면 이 파일을 지운다.
import childProcess from 'node:child_process'

const AGENT = 'conpty_console_list_agent'

if (process.platform === 'win32' && !childProcess.fork.quietPty) {
  const originalFork = childProcess.fork
  const fork = function (modulePath, ...rest) {
    if (typeof modulePath === 'string' && modulePath.includes(AGENT)) {
      // node-pty 는 fork(경로, [셸 pid]) 로만 부른다. silent: 자식 stdout/stderr 를 부모 창에 잇지 않는다
      const [args = [], options = {}] = rest
      return originalFork.call(this, modulePath, args, { ...options, silent: true })
    }
    return originalFork.call(this, modulePath, ...rest)
  }
  fork.quietPty = true
  childProcess.fork = fork
}
