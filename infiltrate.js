// Provides a function to infiltrate a faction repeatedly until a goal is met.
// This is useful for farming rep or money.
// Usage: run the script with goals specified as positional arguments, e.g.:
// run infiltrate.js Illuminati:1000000 $:1000000000
// The script will trade to the Illuminati until you have 1M rep, then sell intel until you have $1B.
// If no goals are specified, the script will enter manual mode, where it will infiltrate until you click the "Stop Infiltration Loop" button.
// The script will automatically sell the intel at the end of the loop if the "Auto-sell" checkbox is checked (only visible in manual mode).
// The script will automatically stop if it fails 3 times in a row.
// Author: Trambelus

// TODO: investigate slowdown over repeated runs (maybe due to memory leak?)
// TODO: support 'all' or '*' as a target to boost rep with all factions
// TODO: script does not always detect when focus has been pulled away and the infiltration has been canceled
// TODO: investigate circumstances where multiple loop controls are added to the page (might be fixed by the above)
// TODO: make sure these recent changes don't tank RAM usage before BN4 is complete (should be fine, but double-check)
// TODO: choose targets other than ECorp if required rep is lower, or if ECorp is not available

import { log, getNsDataThroughFile, formatMoney, formatNumberShort,
         setInfiltrationActive, setInfiltrationInactive, parseShortNumber } from './helpers'
import { rewardsFile } from './infiltrator-service'
import { loopCountFile } from './services'

const win = [].map.constructor('return this')()
/* eslint-disable-next-line dot-notation */
const doc = win['document']

let _ns

const argsSchema = [
  ['auto-sell', false], // automatically sell the intel at the end of the loop (in manual mode)
  ['reload-interval', 25], // reload the page every N loops (0 = never)
  // best to set this such that the total time between refreshes is more than the default autopilot reset time (5 minutes)
  // assuming optimistically that each loop takes 30 seconds, this value can go as low as 10
]
// globals so they can interact with controls
let autoSell = false
let targetLabelText = 'Manual infiltration mode'
let progressLabelText = '0/0'
let resetLoopCount = 0
let moneyReward, repReward // filled in by the infiltrator service when it starts, and later populated here

const failLimit = 3

const canInfiltrateFor = {
  // endgame
  'Illuminati': true, 'Daedalus': true, 'The Covenant': true,
  // corps
  'ECorp': true, 'MegaCorp': true, 'Bachman & Associates': true, 'Blade Industries': true, 'NWO': true, 'Clarke Incorporated': true,
  'OmniTek Incorporated': true, 'Four Sigma': true, 'KuaiGong International': true, 'Fulcrum Secret Technologies': true,
  // midgame
  'BitRunners': true, 'The Black Hand': true, 'NiteSec': true,
  // locations
  'Aevum': true, 'Chongqing': true, 'Ishima': true, 'New Tokyo': true, 'Sector-12': true, 'Volhaven': true,
  // crime
  'Speakers for the Dead': true, 'The Dark Army': true, 'The Syndicate': true, 'Silhouette': true, 'Tetrads': true, 'Slum Snakes': true,
  // earlygame
  'Netburners': true, 'Tian Di Hui': true, 'CyberSec': true,
  // special
  'Bladeburners': false, 'Church of the Machine God': false, 'Shadows of Anarchy': false
}

async function sleep (ms) {
  // sleep function that's not affected by time shenanigans (e.g. infiltrator)
  return new Promise(resolve => (win._setTimeout ?? win.setTimeout)(resolve, ms))
}

export function autocomplete (data) {
  data.flags(argsSchema)
  return []
}

/** @param {import(".").NS} ns */
export async function main (ns) {
  _ns = ns
  _ns.disableLog('ALL')
  _ns.tail()
  const options = _ns.flags(argsSchema)
  const goals = options['_'] // the positional arguments

  _ns.print(`Running with options: ${JSON.stringify(options, null, 2)}`)

  autoSell = options['auto-sell']

  const chain = new LoopActionChain()

  for (const goal of goals) {

    let [target, value] = goal.split(':')
    target = target.replace(/_/g, ' ').trim()
    if (value === undefined) {
      log(_ns, `WARNING: No value specified for target: ${target}. Skipping...`, true)
      continue
    }
    const targetKeys = Object.keys(canInfiltrateFor)
    let targetIndex = -1
    // startsWith check first)
    targetIndex = targetKeys.findIndex(k => k.toLowerCase().startsWith(target.toLowerCase()))
    if (targetIndex === -1)
      // then a substring check
      targetIndex = targetKeys.findIndex(k => k.toLowerCase().includes(target.toLowerCase()))

    if (targetIndex !== -1) target = targetKeys[targetIndex]
    else if (target !== '$') {
      log(_ns, `WARNING: Invalid target: ${target}. Skipping...`, true)
      continue
    }

    if (target === '$') {
      chain.add(LoopAction.sell().setGoal(value))
    }
    else {
      // value must be one of: a number, 'max', or 'donate'. the strings will be evaluated later.
      chain.add(LoopAction.trade(target).setGoal(value))
    }
  }
  if (goals.length === 0) {
    chain.add(LoopAction.manual().setGoal(0))
  }
  try {
    await infiltrateLoop(chain, options['reload-interval'])
  }
  catch (err) {
    log(_ns, err.toString())
    throw err
  }
}

async function evaluateDonate () {
  const favorToDonate = await getNsDataThroughFile(_ns, 'ns.getFavorToDonate()')
  const repToFavor = (rep) => Math.ceil(25500 * 1.02 ** (rep - 1) - 25000);
  const value = repToFavor(favorToDonate)
  log(_ns, `Setting goal to donate to ${target}: ${formatNumberShort(value)}`)
  return value
}

async function evaluateMax (faction) {
  // this is a complicated one. highest-rep aug must be:
  // - offered by the faction
  // - not owned by the player
  // - not NeuroFlux Governor
  // - not accessible via a different faction that the player has more rep with
  // - have the highest rep requirement of any aug that meets the above criteria

  const ownedAugs = await getNsDataThroughFile(_ns, 'ns.singularity.getOwnedAugmentations()')
  const factionAugs = await getNsDataThroughFile(_ns, 'ns.singularity.getAugmentationsFromFaction(ns.args[0])', null, [faction])
  const joinedFactionData = []
  for (const f of (await getNsDataThroughFile(_ns, 'ns.getPlayer()')).factions) {
    // load the faction data here to keep the time complexity down, even if it's a bit redundant
    const fRep = await getNsDataThroughFile(_ns, 'ns.singularity.getFactionRep(ns.args[0])', null, [f])
    const fAugs = await getNsDataThroughFile(_ns, 'ns.singularity.getAugmentationsFromFaction(ns.args[0])', null, [f])
    joinedFactionData.push({ name: f, rep: fRep, augs: fAugs })
  }

  let highestRep = 0
  for (const aug of factionAugs) {
    if (aug === 'NeuroFlux Governor') continue

    const rep = await getNsDataThroughFile(_ns, 'ns.singularity.getAugmentationRepReq(ns.args[0])', null, [aug])

    if (rep < highestRep) continue // this aug has lower rep than the current highest, so skip it
    if (ownedAugs.includes(aug)) continue // player already owns this aug, so skip it

    // check if the player has more rep with another faction that offers this aug
    let betterOption = false
    for (const factionData of joinedFactionData) {
      if (factionData.name === faction) continue // don't check the faction we're currently trading with
      if (factionData.rep < rep) continue // player has less rep with this faction, so best to get the aug from the original faction
      if (factionData.augs.includes(aug)) {
        // player has more rep with this faction and it offers the aug, so this is a better option
        betterOption = true
        break
      }
    }
    if (!betterOption) highestRep = rep
  }
  if (highestRep === 0) {
    log(_ns, `WARNING: Could not find any unowned augs offered by ${faction}. Setting target rep to zero.`, true)
  } else {
    log(_ns, `Setting goal to max rep aug with ${faction}: ${formatNumberShort(highestRep)}`)
  }
  return highestRep
}

function addControls (onclick) {
  const styles = doc.createElement('style')
  // need to re-add controls if they already exist, because the old ones are out of scope
  if (doc.getElementById('infiltration-loop-controls')) removeControls()
  styles.textContent = `
    .infil-controls {
      font-family: 'Consolas', monospace;
      padding: 0.5em;
      border: 1px #333 solid;
    }
    .infil-button {
      background-color: #252525;
      color: #ccccae;
      border: 1px #888 solid;
      padding: 0.5em;
      margin: 0.5em;
      font-family: inherit;
      border-radius: 2px;
      cursor: pointer;
      transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
    }
    .infil-button:hover {
      background-color: #333;
      color: #fff;
    }
    .infil-label {
      color: #ccccae;
      font-family: inherit;
      margin: 0.5em;
      cursor: pointer;
      transition: color 0.2s ease-in-out, color 0.2s ease-in-out;
    }
    .infil-label:hover {
      color: #fff;
    }
    .infil-checkbox {
      margin: 0.5em;
      accent-color: #ccccae;
    }
  `
  doc.head.appendChild(styles)
  // add labels to indicate progress, a button to cancel the loop, and a checkbox to enable auto-sell

  const targetLabel = doc.createElement('label')
  targetLabel.innerText = targetLabelText
  targetLabel.classList.add('infil-label')

  const progressLabel = doc.createElement('label')
  progressLabel.innerText = progressLabelText
  progressLabel.classList.add('infil-label')

  const btn = doc.createElement('button')
  btn.innerText = 'Stop Infiltration Loop'
  btn.classList.add('infil-button')
  btn.onclick = onclick

  let autoSellLabel = null
  if (targetLabelText.includes('Manual infiltration mode')) {
    const checkbox = doc.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = autoSell
    checkbox.classList.add('infil-checkbox')
    checkbox.onchange = () => { autoSell = checkbox.checked }
    autoSellLabel = doc.createElement('label')
    autoSellLabel.innerText = 'Auto-sell'
    autoSellLabel.classList.add('infil-label')
    autoSellLabel.appendChild(checkbox)
  }

  const div = doc.createElement('div')
  div.id = 'infiltration-loop-controls'
  div.classList.add('infil-controls')
  div.appendChild(targetLabel)
  div.appendChild(doc.createElement('br'))
  div.appendChild(progressLabel)
  div.appendChild(doc.createElement('br'))
  div.appendChild(btn)
  if (autoSellLabel !== null) {
    div.appendChild(doc.createElement('br'))
    div.appendChild(autoSellLabel)
  }
  const insertAbove = doc.querySelector('#root').children[0].children[1].children[0].children[0].children[1]
  insertAbove.insertAdjacentElement('beforebegin', div)
}

function removeControls () {
  // remove hooks
  const btn = doc.querySelector('#infiltration-loop-controls button')
  if (btn) btn.onclick = null
  const checkbox = doc.querySelector('#infiltration-loop-controls input')
  if (checkbox) checkbox.onchange = null
  // remove the button and checkbox
  const controls = doc.getElementById('infiltration-loop-controls')
  if (controls) controls.remove()
}

export class LoopAction {
  constructor (type, target, goal) {
    this.type = type
    this.target = target
    this.goal = goal
  }
  setGoal (goal) {
    // if it ends with x (but not max), multiply by the appropriate reward
    if (goal?.toLowerCase().endsWith('x') && goal !== 'max') {
      if (this.type === 'sell') {
        const multiplier = parseShortNumber(goal.slice(0, -1))
        log(_ns, `Setting goal to sell for ${multiplier}× money reward: ${formatMoney(moneyReward * multiplier)}`)
        this.goal = Math.floor(moneyReward * multiplier)
        return this
      }
      else if (this.type === 'trade') {
        const multiplier = parseShortNumber(goal.slice(0, -1))
        log(_ns, `Setting goal to trade for ${multiplier}× rep reward: ${formatNumberShort(repReward * multiplier)}`)
        this.goal = Math.floor(repReward * multiplier)
        return this
      }
    }
    // otherwise, parse it as a number
    const parsed = parseShortNumber(goal)
    if (isNaN(parsed)) {
      // if it's not a number, it must be 'max' or 'donate', and it must be a trade action
      if (this.type === 'sell') {
        throw new Error('Goal must be a number for a sell action')
      }
      if (goal !== 'max' && goal !== 'donate') {
        throw new Error('Goal must be a number, "max", or "donate" for a trade action')
      }
      this.goal = goal // just store the string for now
    } else {
      this.goal = parsed
    }
    return this // allow chaining
  }
  async evaluateGoal () {
    // replace this.goal with the actual value.
    // don't call this until we're actually working on this action, or values may not be up to date.
    // (specifically, 'max' goals may evaluate differently depending on other factions' rep)
    if (this.goal === 'max') {
      this.goal = await evaluateMax(this.target)
    }
    else if (this.goal === 'donate') {
      this.goal = await evaluateDonate()
    }
  }
  static sell () {
    return new LoopAction('sell')
  }
  static trade (target) {
    if (!target) throw new Error('Target must be specified for a trade action')
    return new LoopAction('trade', target)
  }
  static manual () {
    return new LoopAction('manual')
  }
}

export class LoopActionChain {
  constructor () {
    this.actions = []
  }
  add (action) {
    if (!(action instanceof LoopAction)) throw new Error('Invalid action')
    this.actions.push(action)
    return this // allow chaining
  }
  * iterator () {
    for (const action of this.actions) {
      yield action
    }
  }
}

async function checkGoal (action, loopCount) {
  log(_ns, `Checking goal for action: ${JSON.stringify(action, null, 2)}`)
  if (action.type === 'sell') {
    // update player, since we just sold some stuff
    const player = await getNsDataThroughFile(_ns, 'ns.getPlayer()')
    if (player.money >= action.goal) {
      log(_ns, `Goal met. Current money: ${formatMoney(player.money)}.`)
      return true
    } else {
      log(_ns, `Current money: ${formatMoney(player.money)}. Goal: ${formatMoney(action.goal)}.`)
      targetLabelText = `(${resetLoopCount}) Selling for cash`
      const loopsUntilFinished = Math.ceil((action.goal - player.money) / moneyReward)
      progressLabelText = `${formatMoney(player.money)} / ${formatMoney(action.goal)} [${loopsUntilFinished}]`
    }
  }
  else if (action.type === 'trade') {
    await action.evaluateGoal() // replace action.goal with the actual value, if necessary

    // ensure that the faction is valid (it's enough to check if it's just a key of canInfiltrateFor)
    if (!canInfiltrateFor[action.target]) {
      log(_ns, `ERROR: Invalid faction selected: ${action.target}.`, true)
      return true
    }
    const currentRep = await getNsDataThroughFile(_ns, 'ns.singularity.getFactionRep(ns.args[0])', null, [action.target])
    if (currentRep >= action.goal) {
      log(_ns, `Goal met. Current rep with ${action.target}: ${formatNumberShort(currentRep)}.`)
      return true
    } else {
      log(_ns, `Current rep with ${action.target}: ${formatNumberShort(currentRep)}. Goal: ${formatNumberShort(action.goal)}.`)
      targetLabelText = `(${resetLoopCount}) ${action.target}`
      progressLabelText = `${formatNumberShort(currentRep)} / ${formatNumberShort(action.goal)} [${Math.ceil((action.goal - currentRep) / repReward)}]`
    }
  }
  else if (action.type === 'manual') {
    if (loopCount === action.goal && action.goal > 0) {
      log(_ns, `Goal met. Current loop count: ${loopCount}.`)
      return true
    } else {
      log(_ns, `Starting loop ${loopCount + 1} of ${action.goal <= 0 ? 'infinite' : action.goal}.`)
      targetLabelText = `(${resetLoopCount}) Manual infiltration mode}`
      progressLabelText = `${loopCount + 1}/${action.goal <= 0 ? '∞' : action.goal}`
      if (action.goal > 0) {
        // show the number of loops remaining
        progressLabelText += ` [${action.goal - loopCount}]`
      }
    }
  }
  return false
}

async function nextUnmetGoal (iterator, loopCount) {
  let iteration = iterator.next()
  while (!iteration.done) {
    if (await checkGoal(iteration.value, loopCount)) {
      iteration = iterator.next()
    } else {
      return iteration
    }
  }
  return { done: true }
}

export async function infiltrateLoop (actionChain, reloadInterval = 0) {

  await sleep(1000) // wait a moment in case the rewards file hasn't been written yet
  let loopCount = 0 // used for manual mode
  resetLoopCount = Number(await _ns.read(loopCountFile)) // used for reloading; parses to 0 if file doesn't exist, so that's fine
  let actions = actionChain.iterator()
  let iteration = await nextUnmetGoal(actions, loopCount)

  setInfiltrationActive(_ns)
  try {
    while (true) {
      // if rewards variables aren't set, set them now
      if (moneyReward === undefined || repReward === undefined) {
        const contents = await _ns.read(rewardsFile)
        if (contents !== '') {
          const rewards = JSON.parse(contents)
          moneyReward = rewards.moneyGain
          repReward = rewards.repGain
          // log(_ns, `Money reward: ${formatMoney(moneyReward)}. Rep reward: ${formatNumberShort(repReward)}.`)
        }
        // otherwise, just assume it hasn't been written yet.
        // if infiltrator-service.js fails to write the file, something has gone very wrong, so don't worry about it here.
      }
      // check if we've reached the end of the chain
      if (iteration.done) {
        log(_ns, 'SUCCESS: All infiltration actions completed.', true, 'success')
        break
      }
      const currentAction = iteration.value
      if (currentAction.type === 'sell') {
        log(_ns, `Current action: Sell for cash until you have ${formatMoney(currentAction.goal)}.`)
      }
      else if (currentAction.type === 'trade') {
        log(_ns, `Current action: Trade to ${currentAction.target} until you have ${formatNumberShort(currentAction.goal)} rep.`)
      }
      
      const player = await getNsDataThroughFile(_ns, 'ns.getPlayer()')
      const validFactions = player.factions.filter(f => canInfiltrateFor[f])
      // ensure that the selected faction, if any, is valid
      if (currentAction.type === 'trade' && !validFactions.includes(currentAction.target)) {
        log(_ns, `ERROR: Invalid faction selected: ${currentAction.target}. Valid factions are: ${validFactions.map(f => f.name).join(', ')}.`, true)
        break
      }

      // do the infiltration
      const result = await infiltrateOnce(currentAction)

      resetLoopCount++ // even failures count towards the reset loop count
      await _ns.write(loopCountFile, resetLoopCount.toString(), 'w')
      // reload if we've reached the reload interval
      if (resetLoopCount >= reloadInterval && reloadInterval > 0) {
        log(_ns, `Reloading page after ${loopCount} loops...`, true, 'info')
        await saveAndReload()
        log(_ns, 'ERROR: Reload failed. Exiting loop.', true)
        break
      }

      // check the result
      if (result === 'cancel') {
        log(_ns, 'Infiltration loop canceled.')
        break
      }
      else if (result === 'fail') {
        log(_ns, 'Infiltration loop failed.')
        break
      }
      else if (result === 'success') {
        loopCount++
        if (await checkGoal(currentAction, loopCount)) {
          iteration = await nextUnmetGoal(actions, loopCount)
        }
      }
      else {
        log(_ns, `ERROR: Invalid result: ${result}.`, true)
        break
      }
    }
  } finally {
    setInfiltrationInactive(_ns)
  }
}

export async function infiltrateOnce (action) {
  // Returns one of: ['success', 'fail', 'cancel']
  if (action === undefined) action = LoopAction.manual()
  if (!(action instanceof LoopAction)) throw new Error('Invalid action')

  let canceled = false
  let consecutiveFails = 0

  const cancelHook = function () {
    const btn = [...doc.getElementsByTagName('button')].find(e => e.innerText.includes('Cancel Infiltration'))
    if (!btn) return
    const fn = btn.onclick
    if (fn._hooked) return
    btn.onclick = () => { canceled = true; removeControls; fn() }
    btn.onclick._hooked = true
  }

  // Wrap the loop in a try/catch so that we can remove the controls if the loop fails
  try {
    // Retry loop (up to failLimit times)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (consecutiveFails > failLimit) {
        log(_ns, `ERROR: More than ${failLimit} consecutive failures detected. Exiting loop.`)
        return 'fail'
      }
      if (!ensureAevum()) {
        log(_ns, 'ERROR: Could not find ECorp in Aevum.')
        return 'fail'
      }
      await sleep(0)
      getEcorp().click()
      clickTrusted(queryFilter('button', 'Infil'))
      log(_ns, `${consecutiveFails > 0 ? 'Res' : 'S'}tarted loop.`)

      addControls(() => { canceled = true; removeControls() })
      // wait for the infiltration to complete
      let fail = false
      while (!infiltrationComplete()) {
        await sleep(300)
        cancelHook()
        if (getEcorp()) {
          // booted to city! assume this means the infiltration failed
          fail = true
          break
        }
        if (canceled) {
          // user canceled the loop, so just return
          return 'cancel'
        }
      }
      if (fail) {
        console.log('### INFILTRATION FAILED ###')
        log(_ns, `Infiltration failed. ${consecutiveFails === 0 ? 'No' : consecutiveFails} previous failure${consecutiveFails === 1 ? '' : 's'}.`)
        consecutiveFails++
        continue
      }
      console.log('---INFILTRATION SUCCESS---')
      _ns.print('--')
      if (action.type === 'trade') {
        // Set the dropdown to the target
        const inputNode = queryFilter('input.MuiSelect-nativeInput')
        if (inputNode) {
          inputNode[Object.keys(inputNode)[1]].onChange({ target: { value: action.target } })
          // give it a moment to update
          await sleep(100)
          // check that the value was set correctly
          if (inputNode.value === action.target) {
            // click trade button
            const tradeBtn = queryFilter('button', 'Trade')
            if (tradeBtn) {
              log(_ns, `Trading to ${action.target}`)
              tradeBtn.click()
              save()
              return 'success'
            } else {
              log(_ns, 'ERROR: Could not find trade button.', false, 'error')
            }
          } else {
            log(_ns, `ERROR: Could not set target to ${action.target}.`, false, 'error')
          }
        } else {
          log(_ns, 'ERROR: Could not find dropdown input.', false, 'error')
        }
      }
      else if (action.type === 'sell' || autoSell) {
        // click sell button
        const sellBtn = queryFilter('button', 'Sell')
        if (sellBtn) {
          log(_ns, `Selling for ${sellBtn.innerText.split('\n').at(-1)}`)
          sellBtn.click()
          save()
          return 'success'
        } else {
          log(_ns, 'ERROR: Could not find sell button.', false, 'error')
        }
      }
      // either we're in manual mode, or the action couldn't be completed
      // wait for the user to make a choice on selling intel
      log(_ns, 'Waiting for user to sell intel...')
      while (queryFilter('h4', 'Infiltration successful!') !== undefined) {
        await sleep(1000)
      }
      // the user probably clicked one of the options if we're out of that loop, so assume success
      return 'success'
    }
  }
  finally {
    removeControls()
  }
}

function save () {
  const saveButton = queryFilter('button[aria-label="save game"]')
  if (!saveButton) {
    log(_ns, 'ERROR: Could not find save button.', false)
    return false
  }
  saveButton.click()
  return true
}

async function saveAndReload () {
  if (!save()) return
  // reset the loop count
  await _ns.write(loopCountFile, '0', 'w')
  await sleep(100)
  location.reload()
  await sleep(10e3) // page should reload sometime in this interval
}

function queryFilter (query, filter) {
  return [...doc.querySelectorAll(query)].find(e => e.innerText.trim().match(filter))
}

function selectBestTarget (city, canTravel = true, repOrMoneyNeeded = null) {
  // returns the best target for the given city, based on what the player needs and whether they can travel
  // if repOrMoneyNeeded is specified, the target must provide at least that much rep or money
  // if not, the highest-reward target is chosen
}

function ensureAevum () {
  if (_ns.getPlayer().city !== 'Aevum' && !_ns.singularity.travelToCity('Aevum')) {
    log(_ns, 'ERROR: Sorry, you need at least $200k to travel.')
    return false
  }
  const stopWorkButton = queryFilter('button', 'Stop Infiltration') ? null : queryFilter('button', 'Stop') // avoid false positives from "Stop Infiltration"
  if (stopWorkButton) {
    stopWorkButton.click()
  }
  queryFilter('p', 'City')?.click()
  if (getEcorp() === null) {
    // another script probably called travelToCity and the UI got stuck, so force a redraw
    log(_ns, 'WARN: Player is in Aevum, but ECorp could not be located. Forcing a redraw...')
    queryFilter('p', 'Terminal')?.click()
    queryFilter('p', 'City')?.click()
  }
  if (getEcorp() === null) {
    // if that didn't work, just abort
    return false
  }
  return true
}

function getEcorp () {
  return doc.querySelector('[aria-label="ECorp"]')
}

function clickTrusted (node) {
  const handler = Object.keys(node)[1]
  if (node[handler] === undefined) {
    log(_ns, 'WARNING: Could not find click target.', false)
    return
  }
  node[handler].onClick({ isTrusted: true })
}

function infiltrationComplete () {
  const ret = queryFilter('h4', 'Infiltration successful!') !== undefined
  return ret
}
