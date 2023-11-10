// services.js
// This is sort of a plumbing file, it's not really meant to be run directly
// except as an autoexec to clear existing services immediately after a reload.

import { log, formatDuration } from 'helpers.js'

export const _win = [].map.constructor('return this')()

const reloadDelay = 3e3

export async function stopService (ns, serviceName, writeback = true) {
  const contents = ns.read('services.txt')

  if (contents === '') {
    return []
  }

  try {
    const services = JSON.parse(contents)
    const serviceIndex = services.findIndex(s => s.name === serviceName)
    if (serviceIndex === -1) {
      return services
    }
    // remove from service array, clear interval, write back
    const intervalId = services.splice(serviceIndex, 1)[0].intervalId
    if (intervalId === -1) return services // not a real service, just a boot log
    _win.clearInterval(intervalId)
    log(ns, `Cleared previous interval with id ${intervalId}`, false, 'info')
    
    if (writeback) {
      await ns.write('services.txt', JSON.stringify(services, null, 2), 'w')
    }

    return services
  }
  catch (err) {
    if (err instanceof SyntaxError) {
      log(ns, `WARNING: service listing for ${serviceName} is invalid: ${contents}`)
    } else throw err
  }
}
  
export async function registerService (ns, serviceName, intervalId, params = {}) {
  // kill previous service with this name, if any
  const services = await stopService(ns, serviceName, false)
  const newService = { name: serviceName, started: Date.now(), intervalId, params }
  services.push(newService)
  // write info to services file
  await ns.write('services.txt', JSON.stringify(services, null, 2), 'w')
  log(ns, `Registered new service ${serviceName} with id ${intervalId}`)
  return newService
}

export async function main (ns) {
  ns.disableLog('ALL')

  if (ns.args[0] === 'boot') {
    // Read last boot time from services file, if available
    const contents = ns.read('services.txt')
    let timeSinceLastBoot = 'an unknown time'
    if (contents !== '') {
      try {
        const services = JSON.parse(contents)
        const bootService = services.find(s => s.name === 'game')
        if (bootService) {
          timeSinceLastBoot = formatDuration(Date.now() - bootService.started)
        }
      }
      catch (err) {
        if (err instanceof SyntaxError) {
          log(ns, `WARNING: could not parse services.txt: ${contents}`, true)
        } else throw err
      }
    }
    // clear services file
    // using write instead of rm because of ram cost (why does rm still cost ram?)
    await ns.write('services.txt', '', 'w')
    // register a dummy service to log the time of the reload
    const newService = await registerService(ns, 'game', -1)
    log(ns, `INFO: Game loaded at ${new Date(newService.started).toISOString()}`, true)
    log(ns, `INFO: Last loaded ${timeSinceLastBoot} ago`, true)
    return
  }

  if (ns.args[0] === 'list') {
    // list services
    const contents = ns.read('services.txt')
    if (contents === '') {
      log(ns, 'No services registered')
      return
    }
    const services = JSON.parse(contents)
    for (const service of services) {
      log(ns, `${service.intervalId === -1 ? '' : service.intervalId + ': '}` +
              `${service.name} started ${new Date(service.started).toISOString()}`, true)
    }
    return
  }

  if (ns.args[0] === 'stop') {
    // stop a service
    const serviceName = ns.args[1]
    const services = await stopService(ns, serviceName)
    if (services.length === 0) {
      log(ns, `No services found with name ${serviceName}`)
    }
    return
  }

  if (ns.args[0] === 'stopall') {
    // stop all services
    const contents = ns.read('services.txt')
    if (contents === '') {
      log(ns, 'No services registered', true)
      return
    }
    const services = JSON.parse(contents)
    for (const service of services) {
      const intervalId = service.intervalId
      if (intervalId === -1) continue // not a real service, just a boot log
      _win.clearInterval(intervalId)
      log(ns, `Cleared service ${service.name} with id ${intervalId}`, true)
    }
    await ns.write('services.txt', '', 'w')
    return
  }

  if (ns.args[0] === 'reload') {
    // reload the game after a delay
    log(ns, `INFO: Reloading in ${reloadDelay} ms...`, true, 'info')
    await ns.sleep(reloadDelay)
    _win.location.reload()
    return
  }

  if (ns.args.length === 0 || ns.args[0] === 'help') {
    // print help
    log(ns, 'INFO: Usage:'
     + '\n  services.js boot'
     + '\n    - clears services and logs the time of the reload (run this on autoexec)'
     + '\n  services.js list'
     + '\n    - lists all running services'
     + '\n  services.js stop <service>'
     + '\n    - stops the specified service'
     + '\n  services.js stopall'
     + '\n    - stops all running services'
     + '\n  services.js reload'
     + '\n    - reloads the game window'
     , true)
    return
  }

}