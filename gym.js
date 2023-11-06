// gym.js
import { log, getNsDataThroughFile } from './helpers'

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
      await this.ns.asleep(1000)
    }
    return true
  }

  async train (strTarget = this.target, defTarget = this.target, dexTarget = this.target, agiTarget = this.target, period = this.period, gym = this.gym) {
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
  
    // Allow the user to stop this script by clicking the "Stop training" button in the UI
    let cancel = false
    const cancelHook = function () {
      const btn = queryFilter('button', 'Stop training at gym')
      if (!btn) return
      const fn = btn.onclick
      if (fn._hooked) return
      btn.onclick = () => {
        log(this.ns, 'Stopping training...')
        cancel = true
        fn()
      }
      btn.onclick._hooked = true
      log(this.ns, 'Hooked cancel button.')
    }
  
    const interval = setInterval(cancelHook, 100)
  
    try {
      /* eslint-disable-next-line no-unmodified-loop-condition */
      while (!cancel) {
        if (this.verbose) log(this.ns, `Current target stats: ${Object.keys(targetStats).join(', ')}`)
        for (const stat in targetStats) {
          // Break if there's any reason to stop
          if (cancel) break
          if (targetStats[stat] < this.player.skills[stat]) {
            log(this.ns, `Target reached for ${stat}!`)
            delete targetStats[stat]
            continue
          }
          if (!(await this.ensureCity(targetCity))) {
            log(`ERROR: could not travel to ${targetCity}. Exiting...`)
            return
          }
          // Update player info
          this.player = await getNsDataThroughFile(this.ns, 'ns.getPlayer()', '/Temp/player-info.txt')
          // Start training
          if (this.verbose) log(this.ns, `Training ${stat}, target ${targetStats[stat]}`)
          const result = await this.startGymTraining(stat, gym)
          if (result === false) {
            log(this.ns, 'WARN: gym training failed, probably due to unexpected traveling')
            continue
          }
          await this.ns.asleep(period)
        }
        if (Object.keys(targetStats).length === 0) {
          log(this.ns, 'All stat targets have been reached. Exiting...')
          return
        }
        await this.ns.asleep(0)
      }
    } finally {
      clearInterval(interval)
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
  await handler.train(options.strength, options.defense, options.dexterity, options.agility, period, options.gym)
}
