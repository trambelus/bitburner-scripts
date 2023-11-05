// tkill.ns
// given patterns for filenames and hostnames, kills matching processes on matching hosts

const thisScript = 'tkill.js' // hardcoded to save ram

class ServerIterator {
  constructor (ns) {
    this.ns = ns
    this.fn = () => {}
    this.completed = []
  }

  onEach (fn) {
    this.fn = fn
    return this
  }

  * getIterator (home) {
    const self = this
    yield * (function * scan (target) {
      self.fn(target)
      self.completed.push(target)
      yield target
      const nextTargets = self.ns.scan(target)
        .filter(host => !self.completed.includes(host))
      for (const nt of nextTargets) {
        yield * scan(nt)
      }
    })(home)
  }
}

function checkWild (pattern, str) {
  return new RegExp('^' + pattern.replace('*', '.*') + '$').test(str)
}

export function kill (ns, targetScript, targetServer) {
  const home = ns.getHostname()
  // enumerate server generator so we can ensure the home server is at the end of the list
  const servers = [...new ServerIterator(ns).getIterator(home)].filter(s => checkWild(targetServer, s))
  // if the current server is in the list, move it to the end
  servers.splice(servers.length - 1, 0, servers.splice(servers.indexOf(home), 1)[0])
  // iterate and kill
  for (const server of servers) {
    // filter to matching scripts (except the current one)
    const procs = ns.ps(server).filter(proc => proc.filename !== thisScript && checkWild(targetScript, proc.filename))
    for (const proc of procs) {
      if (ns.kill(proc.pid)) {
        ns.tprint(`Killed ${proc.filename} on ${server}`)
      }
    }
  }
}

export async function main (ns) {
  ns.disableLog('ALL')
  if (ns.args.length === 0 || ns.args[0] === '-h') {
    ns.tprint('Usage: run tkill.ns [scriptNames] [servers]')
    return
  }
  const targetScript = ns.args[0]
  // default to just nuking scripts everywhere
  const targetServer = ns.args[1] || '*'
  kill(ns, targetScript, targetServer)
  ns.tprint('Complete')
  // kill current script
}
