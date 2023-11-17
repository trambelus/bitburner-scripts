// findps.js
// given patterns for filenames and hostnames, lists, kills, restarts, or tails matching processes.

import { getConfiguration } from "./helpers"

const thisScript = 'findps.js' // hardcoded to save ram

const argsSchema = [
  ['l', ''], // list matching processes
  ['k', ''], // kill matching processes
  ['r', ''], // restart matching processes
  ['f', ''], // tail matching processes
  ['s', ''], // server to match on (default: current server)
]

class ServerIterator {
  constructor (ns) {
    this.ns = ns
    this.completed = []
  }

  * getIterator (home) {
    const self = this
    yield * (function* scan (target) {
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

function plural(n, pluralForm='s') {
  return n === 1 ? '' : pluralForm
}

function checkWild (pattern, str) {
  return new RegExp('^' + pattern.replace('*', '.*') + '$').test(str)
  // TODO: support actual regexes instead of just wildcard globbing?
}

export function* iterate (ns, targetServer, targetScript) {
  const home = ns.getHostname()
  const servers = new ServerIterator(ns).getIterator(home)
  // iterate and handle matches
  for (const server of servers) {
    // check server name against pattern
    if (!checkWild(targetServer, server)) continue
    // filter to matching scripts (except the current one)
    const procs = ns.ps(server).filter(proc => !(proc.filename === thisScript && server === home) && checkWild(targetScript, proc.filename))
    for (const proc of procs) {
      yield [server, proc]
    }
  }
}

export async function handleActions(ns, options) {
  if (options['l'] === '' && options['k'] === '' && options['r'] === '' && options['f'] === '') {
    options['l'] = '*' // default to listing all processes (might flood the terminal, so may change this later)
  }
  // default to only this server
  const targetServer = options['s'] || ns.getHostname()
  if (options['l'] !== '') {
    const targetScript = options['l']
    let hits = 0
    const servers = new Set()
    for (let [server, proc] of iterate(ns, targetServer, targetScript)) {
      ns.tprint(`${server} pid=${proc.pid} t=${proc.threads} ${proc.filename} ${proc.args.join(' ')} ${proc.temporary ? '(temporary)' : ''}}`)
      hits++
    }
    if (hits > 0) {
      ns.tprint(`Total: ${hits} process${plural(hits, 'es')} on ${servers.size} server${plural(servers.size)}.`)
    } else {
      ns.tprint(`No matching processes found.`)
    }
  }
  if (options['k'] !== '') {
    let hits = 0
    const servers = new Set()
    const targetScript = options['k']
    for (let [server, proc] of iterate(ns, targetServer, targetScript)) {
      if (!ns.kill(proc.filename, server, ...proc.args)) {
        ns.print(`ERROR: Failed to kill ${proc.filename} on ${server}`)
      } else {
        ns.print(`SUCCESS: Killed ${proc.filename} on ${server} with pid ${proc.pid} and args "${proc.args.join(' ')}"`)
        hits++
        servers.add(server)
      }
    }
    if (hits > 0) {
      ns.tprint(`Killed ${hits} process${plural(hits, 'es')} on ${servers.size} server${plural(servers.size)}.`)
    } else {
      ns.tprint(`No matching processes found.`)
    }
  }
  if (options['r'] !== '') {
    const targetScript = options['r']
    let hits = 0
    const servers = new Set()
    for (let [server, proc] of iterate(ns, targetServer, targetScript)) {
      if (!ns.kill(proc.filename, server, ...proc.args)) {
        ns.print(`ERROR: Failed to kill ${proc.filename} on ${server}`)
        return
      }
      const pid = ns.exec(proc.filename, server, 1, ...proc.args)
      if (!pid) {
        ns.print(`ERROR: Failed to restart ${proc.filename} on ${server}`)
        return
      }
      ns.print(`SUCCESS: Restarted ${proc.filename} on ${server} with pid ${pid} and args "${proc.args.join(' ')}"`)
      hits++
      servers.add(server)
    }
    if (hits > 0) {
      ns.tprint(`Restarted ${hits} process${plural(hits, 'es')} on ${servers.size} server${plural(servers.size)}.`)
    } else {
      ns.tprint(`No matching processes found.`)
    }
  }
  if (options['f'] !== '') {
    const targetScript = options['f']
    let hits = 0
    for (let [server, proc] of iterate(ns, targetServer, targetScript)) {
      ns.tail(proc.filename, server, ...proc.args)
      // no return value, so might as well assume it worked
      ns.print(`Attempted to tail ${proc.filename} on ${server} with args "${proc.args.join(' ')}"`)
      hits++
    }
    if (hits > 0) {
      ns.tprint(`Opened ${hits} tail window${plural(hits)}.`)
    }
  }
}

export function autocomplete (data) {
  // autocomplete for script names (TODO: server names too?)
  return data.scripts
}

export async function main (ns) {
  ns.disableLog('ALL')
  const options = getConfiguration(ns, argsSchema)
  if (options === null) return // help message printed by getConfiguration
  ns.print(`Running with options: ${JSON.stringify(options, (k, v) => k !== '_' ? v : undefined, 2)}`)
  await handleActions(ns, options)
}
