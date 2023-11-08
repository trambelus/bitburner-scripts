// gym.js
import { log, getNsDataThroughFile } from './helpers'

const win = [].map.constructor('return this')()
const doc = [].map.constructor('return this.document')()

const argsSchema = [
  ['strength', 0], // strength score target
  ['defense', 0], // defense score target
  ['dexterity', 0], // dexterity score target
  ['agility', 0], // agility score target
  ['stats', 0], // shorthand to override all of the above if higher than them
  ['period', '10s'], // time spent on each before cycling to the next
  ['gym', 'Powerhouse Gym'] // gym to train at. not sure why you would ever change this.
]

const gymLocations = {
  'Crush Fitness Gym': 'Aevum',
  'Snap Fitness Gym': 'Aevum',
  'Iron Gym': 'Sector-12',
  'Powerhouse Gym': 'Sector-12',
  'Millenium Fitness Gym': 'Volhaven'
}

export function autocomplete (data) {
  data.flags(argsSchema)
  return []
}

function parseTime (timeStr) {
  let ret = 0
  const years = timeStr.match(/(\d+)\s*y/)
  const days = timeStr.match(/(\d+)\s*d/)
  const hours = timeStr.match(/(\d+)\s*h/)
  const minutes = timeStr.match(/(\d+)\s*m/)
  const seconds = timeStr.match(/(\d+)\s*s/)
  if (years) { ret += parseInt(years[1]) * 60 * 60 * 24 * 365 }
  if (days) { ret += parseInt(days[1]) * 60 * 60 * 24 }
  if (hours) { ret += parseInt(hours[1]) * 60 * 60 }
  if (minutes) { ret += parseInt(minutes[1]) * 60 }
  if (seconds) { ret += parseInt(seconds[1]) }
  return ret * 1000
}

// shorthand function for finding an element by querySelector and filtering by text
export function queryFilter (query, filter) {
  return [...doc.querySelectorAll(query)].find(e => e.innerText.trim().match(filter))
}

async function safeSleep (ms) {
  // sleep function that's not affected by time shenanigans (e.g. infiltrator.js)
  return new Promise(resolve => (win._setTimeout ?? win.setTimeout)(resolve, ms))
}

async function safeInterval (fn, ms) {
  // interval function that's not affected by time shenanigans (e.g. infiltrator.js)
  const interval = win._setInterval ?? win.setInterval
  return interval(fn, ms)
}

export default class GymHandler {
  constructor (ns, target, period = 10e3, gym = 'Powerhouse Gym', verbose = false) {
    ns.disableLog('ALL')
    this.ns = ns
    this.target = target
    this.period = period
    this.gym = gym
    this.verbose = verbose
  }

  async startGymTraining (stat, gym) {
    return await getNsDataThroughFile(this.ns, 'ns.singularity.gymWorkout(ns.args[0], ns.args[1], ns.args[2])', '/Temp/gym-workout.txt', [gym, stat, false])
  }

  async ensureCity (targetCity) {
    if (this.player.city !== targetCity) {
      if (this.player.money < 200000 || !(await getNsDataThroughFile(this.ns, 'ns.singularity.travelToCity(ns.args[0])', '/Temp/travel-to-city.txt', [targetCity]))) {
        return false
      }
      await safeSleep(1000)
    }
    return true
  }

  async trainOneRound (strTarget = this.target, defTarget = this.target, dexTarget = this.target, agiTarget = this.target, period = this.period, gym = this.gym) {
    // Do a single round of training all unreached stats
    // Return true if all targets have been reached, false otherwise

    // Get player info
    this.player = await getNsDataThroughFile(this.ns, 'ns.getPlayer()', '/Temp/player-info.txt')
    // Validate gym
    if (!(gym in gymLocations)) {
      log(this.ns, `ERROR: unknown gym '${gym}'`)
      return
    }

    const targetCity = gymLocations[gym]
    const targetStats = {
      strength: strTarget,
      defense: defTarget,
      dexterity: dexTarget,
      agility: agiTarget
    }
    // Silently remove any stats that have already been reached
    for (const stat in targetStats) {
      if (targetStats[stat] <= this.player.skills[stat]) {
        delete targetStats[stat]
      }
    }
    if (Object.keys(targetStats).length === 0) {
      if (this.verbose) log(this.ns, 'All stat targets have already been reached.', false, 'info')
      return true
    }
    // Allow the user to stop this script by clicking the "Stop training" button in the UI
    let cancel = false
    const cancelHook = function () {
      const btn = queryFilter('button', 'Stop training at gym')
      if (!btn) return
      const fn = btn.onclick // existing click handler
      if (fn._hooked) return
      btn.onclick = () => {
        log(this.ns, 'Stopping training...')
        cancel = true
        fn()
      }
      btn.onclick._hooked = true
      log(this.ns, 'Hooked cancel button.')
    }
    const cancelHookInterval = safeInterval(cancelHook, 100)

    if (this.verbose) log(this.ns, `Current target stats: ${Object.keys(targetStats).join(', ')}`)
    try {
      for (const stat in targetStats) {
        // Update player info
        this.player = await getNsDataThroughFile(this.ns, 'ns.getPlayer()', '/Temp/player-info.txt')
        // Break if there's any reason to stop
        if (cancel) break
        if (!(await this.ensureCity(targetCity))) {
          log(`ERROR: could not travel to ${targetCity}. Exiting...`)
          return
        }
        // Start training
        if (this.verbose) log(this.ns, `Training ${stat}, target ${targetStats[stat]}`)
        const result = await this.startGymTraining(stat, gym)
        if (result === false) {
          log(this.ns, 'WARN: gym training failed, probably due to unexpected traveling')
          continue
        }
        await safeSleep(period)
      }
      // Update player info and check if all targets have been reached
      this.player = await getNsDataThroughFile(this.ns, 'ns.getPlayer()', '/Temp/player-info.txt')
      for (const stat in targetStats) {
        if (targetStats[stat] <= this.player.skills[stat]) {
          log(this.ns, `Reached target ${stat} of ${targetStats[stat]}`, false, 'success')
          delete targetStats[stat]
        }
      }
      if (Object.keys(targetStats).length === 0) {
        log(this.ns, 'All stat targets have been reached.', false, 'success')
        return true
      }
      return false
    }
    finally {
      clearInterval(cancelHookInterval)
    }
  }

  async trainContinuous (strTarget = this.target, defTarget = this.target, dexTarget = this.target, agiTarget = this.target, period = this.period, gym = this.gym) {
    let done = false
    while (!done) {
      done = await this.trainOneRound(strTarget, defTarget, dexTarget, agiTarget, period, gym)
      await this.ns.asleep(0)
    }
  }
  
}

/** @param {NS} ns */
export async function main (ns) {
  ns.disableLog('ALL')
  const options = ns.flags(argsSchema)
  const period = parseTime(options.period)
  if (options.stats > options.strength) options.strength = options.stats
  if (options.stats > options.defense) options.defense = options.stats
  if (options.stats > options.dexterity) options.dexterity = options.stats
  if (options.stats > options.agility) options.agility = options.stats
  const handler = new GymHandler(ns, options.stats, period, options.gym)
  await handler.trainContinuous(options.strength, options.defense, options.dexterity, options.agility, period, options.gym)
}
