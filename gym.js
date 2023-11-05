// gym.js
import { log, getNsDataThroughFile } from './helpers'

let _ns
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

async function startGymTraining (stat, gym) {
  return await getNsDataThroughFile(_ns, 'ns.singularity.gymWorkout(ns.args[0], ns.args[1], ns.args[2])', '/Temp/gym-workout.txt', [gym, stat, false])
}

async function ensureCity (player, targetCity) {
  if (player.city !== targetCity) {
    if (player.money < 200000 || !(await getNsDataThroughFile(_ns, 'ns.singularity.travelToCity(ns.args[0])', '/Temp/travel-to-city.txt', [targetCity]))) {
      return false
    }
    await _ns.asleep(1000)
  }
  return true
}

export async function doGainz (strTarget, defTarget, dexTarget, agiTarget, period = 10e3, gym = 'Powerhouse Gym') {
  // Validate gym
  if (!(gym in gymLocations)) {
    log(_ns, `ERROR: unknown gym '${gym}'`)
    return
  }
  const targetCity = gymLocations[gym]

  let player = await getNsDataThroughFile(_ns, 'ns.getPlayer()', '/Temp/player-info.txt')

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
      log(_ns, 'Stopping training...')
      cancel = true
      fn()
    }
    btn.onclick._hooked = true
    log(_ns, 'Hooked cancel button.')
  }

  const interval = setInterval(cancelHook, 100)

  try {
    /* eslint-disable-next-line no-unmodified-loop-condition */
    while (!cancel) {
      log(_ns, `Current target stats: ${Object.keys(targetStats).join(', ')}`)
      for (const stat in targetStats) {
        if (cancel) break
        if (targetStats[stat] < player.skills[stat]) {
          log(_ns, `Target reached for ${stat}!`)
          delete targetStats[stat]
          continue
        }
        if (!(await ensureCity(player, targetCity))) {
          log(`ERROR: could not travel to ${targetCity}. Exiting...`)
          return
        }
        player = await getNsDataThroughFile(_ns, 'ns.getPlayer()', '/Temp/player-info.txt')
        // player = _ns.getPlayer() // accuracy matters more than ram minimization here, so we'll just use the native function
        log(_ns, `Training ${stat}, target ${targetStats[stat]}`)
        const result = await startGymTraining(stat, gym)
        if (result === false) {
          log(_ns, 'WARN: gym training failed, probably due to unexpected traveling')
          continue
        }
        await _ns.asleep(period)
      }
      if (Object.keys(targetStats).length === 0) {
        log(_ns, 'All stat targets have been reached. Exiting...')
        return
      }
      await _ns.asleep(0)
    }
  } finally {
    clearInterval(interval)
  }
}

/** @param {NS} ns */
export async function main (ns) {
  _ns = ns
  _ns.disableLog('ALL')
  const options = ns.flags(argsSchema)
  const period = parseTime(options.period)
  if (options.stats > options.strength) options.strength = options.stats
  if (options.stats > options.defense) options.defense = options.stats
  if (options.stats > options.dexterity) options.dexterity = options.stats
  if (options.stats > options.agility) options.agility = options.stats
  await doGainz(options.strength, options.defense, options.dexterity, options.agility, period, options.gym)
}
