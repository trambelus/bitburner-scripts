/* infiltrator-service.js
 * Fully-automated infiltrator
 * This file uses a service paradigm, or a zero-RAM task running almost-invisibly via setInterval.
 * Information on running services is stored in the local file `services.txt`.
 * Running this file will launch the service (killing any previous instances), store its info, and quickly exit.
 * TODO: add support for time-stretched human assistance mode, maybe
 */

import { log, formatMoney, formatNumberShort, tryGetBitNodeMultipliers, getNsDataThroughFile } from './helpers'
import { registerService, stopService } from './services'

// delays for setTimeout and setInterval above this threshold are not modified
// (helps prevent issues with hacking scripts)
const maxDelayCutoff = 30e3

let infiltrationTimeFactor, keyDelay

// interval to check for infiltration/game updates
const tickInterval = 50

// unique name to prevent overlaps
const serviceName = 'infiltrator'

// file for storing infiltration rewards
export const rewardsFile = '/Temp/infiltratorRewards.txt'

// boost given by WKSharmonizer aug
const WKSharmonizerMult = 1.5

const _win = [].map.constructor('return this')()
const _doc = [].map.constructor('return this.document')()

const argsSchema = [
  ['stop', false], // set to stop the old service and not start a new one
  ['timeFactor', 0.2], // interval multiplier to apply during infiltrations (set to 1 to disable)
  ['keyDelay', 1], // delay in ms between keystrokes
  ['allowedHost', 'home'], // error out if running anywhere other than here (service logic is dependent on local file system)
  ['listLocations', false], // don't run the service, just list the locations and rewards
  ['preview', ''] // don't run the service, just preview the effects of installing a set of augments
    // (useful for knowing whether the next augment install will ruin your rep gains)
]

export function autocomplete (data) {
  data.flags(argsSchema)
  return []
}

// log to console with prefix and no spamming
let lastLog
function logConsole (str) {
  if (str === lastLog) return
  console.log('infiltrator-service.js: ' + str)
  lastLog = str
}

// shorthand function for finding an element by querySelector and filtering by text
export function queryFilter (query, filter, parent = _doc) {
  return [...parent.querySelectorAll(query)].find(e => e.innerText.trim().match(filter))
}

function addCss () {
  const css = `<style id="infilCss">
  @keyframes rgPulse {
    0% { color: #f00 }
    100% { color: #0f0 }
  }
  .infiltrationEnabled {
    animation-name: rgPulse;
    animation-duration: 1s;
    animation-iteration-count: infinite;
    animation-direction: alternate
  }
  .rewardTooltip {
    color: #0d0;
    font-family: Consolas;
    margin: auto;
  }
  </style>`
  _doc.getElementById('infilCss')?.remove()
  _doc.head.insertAdjacentHTML('beforeend', css)
}

async function sleep (ms) {
  // sleep function that's not affected by time shenanigans (e.g. infiltrator)
  return new Promise(resolve => (_setTimeout ?? setTimeout)(resolve, ms))
}

// compress/stretch setInterval and setTimeout, to make infiltrations easier
// for a human or faster if fully automated.
// return true if anything was changed.
let lastFactor = 1
function setTimeFactor (factor = 1) {
  // backup native functions if necessary
  if (_win._setTimeout === undefined) { _win._setTimeout = _win.setTimeout }
  if (_win._setInterval === undefined) { _win._setInterval = _win.setInterval }
  // return early if possible
  if (factor === lastFactor) return false
  // if factor is 1, don't bother wrapping
  if (factor === 1) {
    _win.setTimeout = _win._setTimeout
    _win.setInterval = _win._setInterval
    lastFactor = factor
    return true
  }
  // wrap setTimeout and setInterval
  _win.setTimeout = function (fn, delay, ...args) {
    if (delay < maxDelayCutoff) {
      return _win._setTimeout(fn, Math.round(delay * factor), ...args)
    } else {
      return _win._setTimeout(fn, delay, ...args)
    }
  }
  _win.setInterval = function (fn, delay, ...args) {
    if (delay < maxDelayCutoff) {
      return _win._setInterval(fn, Math.round(delay * factor), ...args)
    } else {
      return _win._setInterval(fn, delay, ...args)
    }
  }
  lastFactor = factor
  return true
}

function autoSetTimeFactor () {
  const lvlReg = /^Level:?\s+\d+\s*\/\s*\d+$/
  const levelElement = queryFilter('h5', lvlReg)

  if (levelElement === undefined) {
    if (setTimeFactor(1)) {
      logConsole('Infiltration not detected: removing injection')
      purgeEventListenerCache()
    }
  } else {
    if (setTimeFactor(infiltrationTimeFactor)) {
      logConsole('Infiltration detected: injecting middleware')
    }
  }
}

// event listener stuff, stolen from https://github.com/stracker-phil/bitburner/blob/main/daemon/infiltrate.js

function pressKey (key) {
  const keyCode = key.charCodeAt(0)

  /* eslint-disable-next-line no-undef */
  const keyboardEvent = new KeyboardEvent('keydown', {
    key,
    keyCode
  })

  _doc.dispatchEvent(keyboardEvent)
}

/**
 * Wrap all event listeners with a custom function that injects
 * the "isTrusted" flag.
 */
export function wrapEventListeners () {
  if (!_doc._addEventListener) {
    _doc._addEventListener = _doc.addEventListener

    _doc.addEventListener = function (type, callback, options) {
      let handler = false

      // For this script, we only want to modify "keydown" events.
      if (type === 'keydown') {
        handler = function (...args) {
          if (!args[0].isTrusted) {
            const hackedEv = {}

            for (const key in args[0]) {
              if (key === 'isTrusted') {
                // If the event has an "isTrusted" member, set it to true
                hackedEv.isTrusted = true
              } else if (typeof args[0][key] === 'function') {
                // For function members of the event, bind them to the original
                hackedEv[key] = args[0][key].bind(args[0])
              } else {
                // For everything else, just copy it over
                hackedEv[key] = args[0][key]
              }
            }

            args[0] = hackedEv
          }

          return callback.apply(callback, args)
        }

        // Copy over all members of the original callback
        for (const prop in callback) {
          if (typeof callback[prop] === 'function') {
            handler[prop] = callback[prop].bind(callback)
          } else {
            handler[prop] = callback[prop]
          }
        }

        if (!this.eventListeners) {
          this.eventListeners = {}
        }
        if (!this.eventListeners[type]) {
          this.eventListeners[type] = []
        }
        this.eventListeners[type].push({
          listener: callback,
          useCapture: options,
          wrapped: handler
        })
      }

      return this._addEventListener(
        type,
        handler || callback,
        options
      )
    }
  }

  if (!_doc._removeEventListener) {
    _doc._removeEventListener = _doc.removeEventListener

    _doc.removeEventListener = function (type, callback, options) {
      if (type === 'keydown') {

        if (!this.eventListeners) {
          this.eventListeners = {}
        }
        if (!this.eventListeners[type]) {
          this.eventListeners[type] = []
        }

        for (let i = 0; i < this.eventListeners[type].length; i++) {
          if (
            this.eventListeners[type][i].listener === callback &&
            this.eventListeners[type][i].useCapture === options
          ) {
            if (this.eventListeners[type][i].wrapped) {
              callback = this.eventListeners[type][i].wrapped
            }

            this.eventListeners[type].splice(i, 1)
            break
          }
        }

        if (this.eventListeners[type].length === 0) {
          delete this.eventListeners[type]
        }
      }

      return this._removeEventListener(type, callback, options)
    }
  }
}

export function purgeEventListenerCache () {
  if (_doc.eventListeners['keydown']) {
    console.log(`Purging ${_doc.eventListeners['keydown'].length} event listeners`)
    _doc.eventListeners['keydown'].forEach(listener => {
      _doc.removeEventListener('keydown', listener.listener, listener.useCapture)
    })
    _doc.eventListeners['keydown'] = [] // hopefully the GC takes care of the rest
  }
}

/**
 * Revert the "wrapEventListeners" changes.
 */
export function unwrapEventListeners () {
  if (_doc._addEventListener) {
    _doc.addEventListener = _doc._addEventListener
    delete _doc._addEventListener
  }
  if (_doc._removeEventListener) {
    _doc.removeEventListener = _doc._removeEventListener
    delete _doc._removeEventListener
  }
  delete _doc.eventListeners
}

// navigation functions for MinesweeperGame and Cyberpunk2077Game
function getPathSingle (sizeX, sizeY, startPt, endPt) {
  const size = [sizeX, sizeY]
  // handle wrapping
  for (let i = 0; i <= 1; i++) {
    if (Math.abs(startPt[i] - endPt[i]) > size[i] / 2) {
      // shove either startPt or endPt past bounds so it moves backwards and wraps around
      if (startPt[i] < endPt[i]) startPt[i] += size[i]
      else endPt[i] += size[i]
    }
  }
  let ret = ''
  // calculate x offset
  if (startPt[0] < endPt[0]) ret += 'd'.repeat(endPt[0] - startPt[0])
  else ret += 'a'.repeat(startPt[0] - endPt[0])
  // calculate y offset
  if (startPt[1] < endPt[1]) ret += 's'.repeat(endPt[1] - startPt[1])
  else ret += 'w'.repeat(startPt[1] - endPt[1])
  return ret
}

function getPathSequential (sizeX, sizeY, points, start = [0, 0]) {
  const ret = []
  const routePoints = [start, ...points]
  for (let i = 0; i < routePoints.length - 1; i++) {
    ret.push(getPathSingle(sizeX, sizeY, routePoints[i], routePoints[i + 1]))
  }
  return ret
}

function getNodeIndex (node) {
  let idx
  for (idx = 0; node?.previousSibling !== null; node = node.previousSibling, idx++) { /* ._. */ }
  return idx
}

function pressStart () {
  const infiltrating = queryFilter('h4', 'Infiltrating') !== undefined
  if (!infiltrating) return
  queryFilter('button', 'Start')?.click()
}

class InfiltrationService {
  constructor (ns, rewardInfo = []) {
    const self = this
    addCss()
    wrapEventListeners()
    self.rewardInfo = rewardInfo
    self.tickComplete = true
    self.automationEnabled = true // leaving this in to support a possible future human-assist mode with no keypresses
  }

  async sendKeyString (str) {
    for (const c of str) {
      pressKey(c)
      await sleep(keyDelay)
    }
  }

  infilButtonUpdate () {
    const self = this
    const buttonNode = queryFilter('button', 'Infiltrate Company')
    if (buttonNode === undefined) {
      return
    }
    buttonNode.classList.add('infiltrationEnabled')
    // if we've already added a tooltip, return
    if (_doc.getElementsByClassName('rewardTooltip')[0]) return
    // get the name of the company we're at
    // check tooltip first, in case we've backdoored and text is wonky
    const titleSpan = buttonNode.parentNode.parentNode.firstChild.nextSibling
    const companyName = titleSpan.ariaLabel ? titleSpan.ariaLabel.slice(22, -1) : titleSpan.textContent
    const info = self.rewardInfo.find(c => c.name === companyName)
    // this function may be called before the reward info is loaded, so just return if we don't have it yet
    if (!info) return
    const rewardStr = `${formatMoney(info.moneyGain)}, ${formatNumberShort(info.repGain)} rep (${info.maxClearanceLevel})`
    buttonNode.insertAdjacentHTML('afterend', `<span class='rewardTooltip'>${rewardStr}</span>`)
  }

  markSolution () {
    // TODO
  }

  clearSolution () {
    // TODO
  }

  async cyberpunk () {
    await sleep(10) // possible fix for a failure to detect the game
    let targetElement = queryFilter('h5', 'Targets:')
    if (!targetElement) return
    logConsole('Game active: Cyberpunk2077 game')
    const targetValues = targetElement.innerText.split('Targets: ')[1].trim().split(/\s+/)
    const grid = queryFilter('p', /^[0-9A-F]{2}$/, targetElement.parentNode).parentNode
    const size = ~~(grid.childElementCount ** 0.5)
    const routePoints = []
    // get coords of each target
    for (const target of targetValues) {
      const node = [...grid.children].filter(el => el.innerText.trim() === target)[0]
      routePoints.push([getNodeIndex(node) % size, ~~(getNodeIndex(node) / size)])
    }
    const pathStr = getPathSequential(size, size, routePoints).join(' ') + ' '
    logConsole(`Sending path: '${pathStr}'`)
    await this.sendKeyString(pathStr)
    while (targetElement !== undefined) {
      await sleep(50)
      targetElement = queryFilter('h5', 'Targets:')
    }
  }

  async mines () {
    const memoryPhaseText = 'Remember all the mines!'
    const markPhaseText = 'Mark all the mines!'

    const header = queryFilter('h4', memoryPhaseText)
    if (!header) return
    logConsole('Game active: Minesweeper game')
    // const gridElements = [..._doc.querySelectorAll('span')].filter(el => el.innerText.trim().match(/^\[[X.\s?]\]$/))
    const grid = header.nextSibling
    const gridElements = [...grid.children]
    if (gridElements.length === 0) return
    // get size
    const sizeX = ~~(gridElements.length ** 0.5)
    const sizeY = gridElements.length / sizeX // grid may have an extra row, so account for that
    if (sizeY !== ~~sizeY) {
      logConsole('ERROR: non-rectangular grid???')
      return
    }
    const mineCoords = []
    // get coordinates for each mine
    gridElements.map(el => {
      if (el.firstChild?.getAttribute('data-testid') === 'ReportIcon') {
        mineCoords.push([getNodeIndex(el) % sizeX, ~~(getNodeIndex(el) / sizeX)])
      }
    })
    // trace code to print the known coords
    // console.log('Mine coords: ' + JSON.stringify(mineCoords))
    // print the number of mines
    // console.log(`Mines: ${mineCoords.length}`)
    // print the solution string
    for (let y = 0; y < sizeY; y++) {
      const row = []
      for (let x = 0; x < sizeX; x++) {
        row.push(mineCoords.some(coord => coord[0] === x && coord[1] === y) ? '[X]' : '[ ]')
      }
      console.log(row.join(' '))
    }
    // wait for mark phase
    while (queryFilter('h4', memoryPhaseText)) {
      await sleep(50)
    }
    // wait just a bit longer, to make sure the grid is updated
    await sleep(50)
    // send solution string
    const pathStr = getPathSequential(sizeX, sizeY, mineCoords).join(' ') + ' '
    logConsole(`Mine solution string: ${pathStr}`)
    await this.sendKeyString(pathStr)
    // wait for end
    while (queryFilter('h4', markPhaseText)) {
      await sleep(50)
    }
  }

  async slash () {
    const self = this
    if (!self.automationEnabled) return
    const activeText = 'Attack when his guard is down!'
    let activeElement = queryFilter('h4', activeText)
    while (activeElement !== undefined) {
      logConsole('Game active: Slash game')
      if (queryFilter('h4', 'Preparing?')) {
        await sleep(1)
        await self.sendKeyString(' ')
      }
      await sleep(1)
      activeElement = queryFilter('h4', activeText)
    }
  }

  async brackets () {
    const self = this
    if (!self.automationEnabled) return
    const activeText = 'Close the brackets'
    let activeElement = queryFilter('h4', activeText)
    if (activeElement === undefined) return
    logConsole('Game active: Bracket game')
    const bracketText = activeElement.nextSibling.innerText
    const closeText = bracketText.split('').reverse().join('')
      .replace('|', '') // just in case
      .replaceAll('<', '>')
      .replaceAll('(', ')')
      .replaceAll('[', ']')
      .replaceAll('{', '}')
    await self.sendKeyString(closeText)
    while (activeElement !== undefined) {
      activeElement = queryFilter('h4', activeText)
      await sleep(50)
    }
  }

  async cheatCode () {
    const self = this
    if (!self.automationEnabled) return
    const arrowsMap = { '↑': 'w', '→': 'd', '↓': 's', '←': 'a' }
    const activeText = 'Enter the Code!'
    let activeElement = queryFilter('h4', activeText)
    let lastArrow
    while (activeElement !== undefined) {
      logConsole('Game active: Cheat Code game')
      const arrow = activeElement?.nextSibling?.innerText
      if (arrow !== lastArrow) {
        if (arrow in arrowsMap) {
          await self.sendKeyString(arrowsMap[arrow])
          // logConsole(`Sent '${arrowsMap[arrow]}'`)
          lastArrow = arrow
        } else {
          return
        }
      }
      activeElement = queryFilter('h4', activeText)
      await sleep(10)
    }
  }

  async backwardGame () {
    const self = this
    if (!self.automationEnabled) return
    const activeText = 'Type it'
    let activeElement = queryFilter('h4', activeText)
    if (activeElement === undefined) return
    logConsole('Game active: Backward game')
    const text = activeElement.nextSibling.innerText
    await self.sendKeyString(text.toLowerCase())
    while (activeElement !== undefined) {
      activeElement = queryFilter('h4', activeText)
      await sleep(50)
    }
  }

  async bribeGame () {
    const self = this
    if (!self.automationEnabled) return
    const activeText = 'Say something nice about the guard'
    let activeElement = queryFilter('h4', activeText)
    let lastWord
    const positive = [
      'affectionate',
      'agreeable',
      'bright',
      'charming',
      'creative',
      'determined',
      'energetic',
      'friendly',
      'funny',
      'generous',
      'polite',
      'likable',
      'diplomatic',
      'helpful',
      'giving',
      'kind',
      'hardworking',
      'patient',
      'dynamic',
      'loyal',
      'straightforward'
    ]
    while (activeElement !== undefined) {
      logConsole('Game active: Bribe game')
      // use hint from SoA augment, if available
      const upArrowIsBest = globalThis.getComputedStyle(activeElement.nextSibling).color === globalThis.getComputedStyle(activeElement).color
      const currentWord = activeElement.nextSibling.nextSibling.innerText
      if (positive.includes(currentWord)) {
        // console.log(`!!! ${currentWord} !!!`)
        await self.sendKeyString(' ')
      } else if (lastWord !== currentWord) {
        // console.log(currentWord)
        await self.sendKeyString(upArrowIsBest ? 'w' : 's')
        lastWord = currentWord
      }
      activeElement = queryFilter('h4', activeText)
      await sleep(5)
    }
  }

  async wireCuttingGame () {
    const self = this
    if (!self.automationEnabled) return
    const activeText = 'Cut the wires'
    const activeElement = queryFilter('h4', activeText)
    if (activeElement === undefined) return
    logConsole('Game active: Wire Cutting game')

    // sleep for a bit, since hint extraction sometimes fails
    await sleep(100)

    // extract hints
    const hints = [...activeElement.parentNode.querySelectorAll('p')].map(el => el.innerText).join('')
    const colorHints = hints.match(/(?<=colored ).+?(?=\.)/g)
      .map(s => { return { white: 'white', blue: 'blue', red: 'red', yellow: 'rgb(255, 193, 7)' }[s] })
    const numberHints = hints.match(/(?<=number ).+?(?=\.)/g)
    const solution = new Set()
    numberHints.forEach(n => { solution.add(n) })

    // find the first div containing wire elements
    const wireDiv = queryFilter('p', /^\|[-#./█|]\|$/).parentNode

    const wireCount = [...wireDiv.children].filter(el => el.innerText.match(/^\d$/)).length
    // get just the first two rows
    const wireNodes = [...wireDiv.children].slice(wireCount, wireCount * 3)
    // loop through the rows and check their colors
    let i = 0
    for (const wire of wireNodes) {
      if (colorHints.includes(wire.style.color)) {
        solution.add(((i % wireCount) + 1).toString())
      }
      i++
    }
    // send solution string
    const solutionStr = Array.from(solution).join('')
    logConsole(`Sending solution: ${solutionStr}`)
    await this.sendKeyString(solutionStr)
    // wait for end
    while (queryFilter('h4', activeText) !== undefined) {
      await sleep(50)
    }
  }

  async tick () {
    const self = this
    // prevent overlapping execution
    if (!self.tickComplete) return
    self.tickComplete = false
    try {
      // Add visual indicator to infiltration screen
      self.infilButtonUpdate()
      // Press start if it's visible
      pressStart()
      // Adjust time speed if we're infiltrating
      autoSetTimeFactor()
      // Match the symbols!
      await self.cyberpunk()
      // Mark all the mines!
      await self.mines()
      // Attack when his guard is down!
      await self.slash()
      // Close the brackets
      await self.brackets()
      // Enter the code
      await self.cheatCode()
      // Type it backward
      await self.backwardGame()
      // Say something nice about the guard
      await self.bribeGame()
      // Cut the wires
      await self.wireCuttingGame()
      // allow this function to be executed again
      self.tickComplete = true
    }
    catch (e) {
      // This is basically ON ERROR RESUME NEXT, but it's important that the infiltrator can resume
      // because it's difficult to tell when it's crashed and needs to be restarted.
      logConsole(`ERROR: ${e}`)
      self.tickComplete = true
    }
  }

  start () {
    const self = this
    // ensure that _setInterval gets set first
    setTimeFactor(1)
    // use _setInterval instead of setInterval to guarantee no time fuckery
    self.intId = _win._setInterval(self.tick.bind(self), tickInterval)
    return self.intId
  }
}

// calculation stuff

const locationInfo = [{
  name: 'AeroCorp',
  maxClearanceLevel: 12,
  startingSecurityLevel: 8.18
}, {
  name: 'Bachman & Associates',
  maxClearanceLevel: 15,
  startingSecurityLevel: 8.19
}, {
  name: 'Clarke Incorporated',
  maxClearanceLevel: 18,
  startingSecurityLevel: 9.55
}, {
  name: 'ECorp',
  maxClearanceLevel: 37,
  startingSecurityLevel: 17.02
}, {
  name: 'Fulcrum Technologies',
  maxClearanceLevel: 25,
  startingSecurityLevel: 15.54
}, {
  name: 'Galactic Cybersystems',
  maxClearanceLevel: 12,
  startingSecurityLevel: 7.89
}, {
  name: 'NetLink Technologies',
  maxClearanceLevel: 6,
  startingSecurityLevel: 3.29
}, {
  name: 'Aevum Police Headquarters',
  maxClearanceLevel: 6,
  startingSecurityLevel: 5.35
}, {
  name: 'Rho Construction',
  maxClearanceLevel: 5,
  startingSecurityLevel: 5.02
}, {
  name: 'Watchdog Security',
  maxClearanceLevel: 7,
  startingSecurityLevel: 5.85
}, {
  name: 'KuaiGong International',
  maxClearanceLevel: 25,
  startingSecurityLevel: 16.25
}, {
  name: 'Solaris Space Systems',
  maxClearanceLevel: 18,
  startingSecurityLevel: 12.59
}, {
  name: 'Nova Medical',
  maxClearanceLevel: 12,
  startingSecurityLevel: 5.02
}, {
  name: 'Omega Software',
  maxClearanceLevel: 10,
  startingSecurityLevel: 3.2
}, {
  name: 'Storm Technologies',
  maxClearanceLevel: 25,
  startingSecurityLevel: 5.38
}, {
  name: 'DefComm',
  maxClearanceLevel: 17,
  startingSecurityLevel: 7.18
}, {
  name: 'Global Pharmaceuticals',
  maxClearanceLevel: 20,
  startingSecurityLevel: 5.9
}, {
  name: 'Noodle Bar',
  maxClearanceLevel: 5,
  startingSecurityLevel: 2.5
}, {
  name: 'VitaLife',
  maxClearanceLevel: 25,
  startingSecurityLevel: 5.52
}, {
  name: 'Alpha Enterprises',
  maxClearanceLevel: 10,
  startingSecurityLevel: 3.62
}, {
  name: 'Blade Industries',
  maxClearanceLevel: 25,
  startingSecurityLevel: 10.59
}, {
  name: 'Carmichael Security',
  maxClearanceLevel: 15,
  startingSecurityLevel: 4.66
}, {
  name: 'DeltaOne',
  maxClearanceLevel: 12,
  startingSecurityLevel: 5.9
}, {
  name: 'Four Sigma',
  maxClearanceLevel: 25,
  startingSecurityLevel: 8.18
}, {
  name: 'Icarus Microsystems',
  maxClearanceLevel: 17,
  startingSecurityLevel: 6.02
}, {
  name: 'Joe\'s Guns',
  maxClearanceLevel: 5,
  startingSecurityLevel: 3.13
}, {
  name: 'MegaCorp',
  maxClearanceLevel: 31,
  startingSecurityLevel: 16.36
}, {
  name: 'Universal Energy',
  maxClearanceLevel: 12,
  startingSecurityLevel: 5.9
}, {
  name: 'CompuTek',
  maxClearanceLevel: 15,
  startingSecurityLevel: 3.59
}, {
  name: 'Helios Labs',
  maxClearanceLevel: 18,
  startingSecurityLevel: 7.28
}, {
  name: 'LexoCorp',
  maxClearanceLevel: 15,
  startingSecurityLevel: 4.35
}, {
  name: 'NWO',
  maxClearanceLevel: 50,
  startingSecurityLevel: 8.53
}, {
  name: 'OmniTek Incorporated',
  maxClearanceLevel: 25,
  startingSecurityLevel: 7.74
}, {
  name: 'Omnia Cybersystems',
  maxClearanceLevel: 22,
  startingSecurityLevel: 6
}, {
  name: 'SysCore Securities',
  maxClearanceLevel: 18,
  startingSecurityLevel: 4.77
}]

export function calculateSkill (exp, mult = 1) {
  return Math.max(Math.floor(mult * (32 * Math.log(exp + 534.5) - 200)), 1)
}

function calcReward (player, startingDifficulty) {
  const xpMult = 10 * 60 * 15
  const stats =
    calculateSkill((player?.mults.strength_exp ?? 1) * xpMult, (player?.mults.strength ?? 1)) +
    calculateSkill((player?.mults.defense_exp ?? 1) * xpMult, (player?.mults.defense ?? 1)) +
    calculateSkill((player?.mults.agility_exp ?? 1) * xpMult, (player?.mults.agility ?? 1)) +
    calculateSkill((player?.mults.dexterity_exp ?? 1) * xpMult, (player?.mults.dexterity ?? 1)) +
    calculateSkill((player?.mults.charisma_exp ?? 1) * xpMult, (player?.mults.charisma ?? 1))
  let difficulty = startingDifficulty - Math.pow(stats, 0.9) / 250 - (player.intelligence ?? 0) / 1600
  if (difficulty < 0) difficulty = 0
  if (difficulty > 3) difficulty = 3
  return difficulty
}

export function getAllRewards (ns, bnMults, player, wks = false, display = false) {
  const locations = JSON.parse(JSON.stringify(locationInfo)) // deep copy
  for (const location of locations) {
    const levelBonus = location.maxClearanceLevel * Math.pow(1.01, location.maxClearanceLevel)
    const reward = calcReward(player, location.startingSecurityLevel)
    location.repGain =
      Math.pow(reward + 1, 1.1) *
      Math.pow(location.startingSecurityLevel, 1.2) *
      30 *
      levelBonus *
      (wks ? WKSharmonizerMult : 1) *
      (bnMults?.InfiltrationRep ?? 1)
    location.moneyGain =
      Math.pow(reward + 1, 2) *
      Math.pow(location.startingSecurityLevel, 3) *
      3e3 *
      levelBonus *
      (wks ? WKSharmonizerMult : 1) *
      (bnMults?.InfiltrationMoney ?? 1)
    location.repScore = location.repGain / location.maxClearanceLevel
    location.moneyScore = location.moneyGain / location.maxClearanceLevel
  }
  // sort and display
  locations.sort((a, b) => a.repScore - b.repScore) // worst to best
  if (display) {
    for (const location of locations) {
      log(ns, location.name, true)
      log(ns, `  ${Math.round(location.repGain)} rep, ${formatMoney(location.moneyGain)}, ${location.maxClearanceLevel} levels`, true)
      log(ns, `  ${formatMoney(location.moneyScore.toPrecision(4))} / lvl`, true)
      log(ns, `  ${(location.repScore.toPrecision(4))} rep / lvl`, true)
    }
  }
  return locations
}

function round(num, n) {
  if (n === undefined) n = 0
  if (num == 0) return 0
  const d = Math.ceil(Math.log10(num < 0 ? -num : num))
  const power = n - d
  const magnitude = Math.pow(10, power)
  const shifted = Math.round(num * magnitude)
  return shifted / magnitude
}

function evaluateMultipliers(str) {
  // given a string like '1.5*1.5*1.5' or '1.5^3' (equivalent), return the result
  str = str.toString()
  // if the string is invalid, return 1
  try {
    // first, expand the ^ notation into a series of multiplications
    let powerReg = /([0-9.]+)\^([0-9.]+)/
    let match
    while ((match = powerReg.exec(str)) !== null) {
      const base = Number(match[1])
      const exponent = Number(match[2])
      if (exponent !== Math.floor(exponent)) throw new Error('Exponent must be an integer')
      const replacement = (base + '*').repeat(exponent).slice(0, -1)
      str = str.replace(match[0], replacement)
    }
    // now evaluate the multiplications
    return str.split('*').reduce((a, b) => a * b)
  }
  catch {
    return 1
  }
}

export async function simulateAugInstall(ns, player, upgrades, bnMults, wks) {
  // Create a copy of the player object to avoid modifying the original
  const simulatedPlayer = JSON.parse(JSON.stringify(player))

  // Define the stats that can be specified by 'all' key
  const stats = ['strength', 'strength_exp', 'defense', 'defense_exp', 'dexterity', 'dexterity_exp', 'agility', 'agility_exp', 'charisma', 'charisma_exp'];
  upgrades['strength'] ??= upgrades['str']
  upgrades['strength_exp'] ??= upgrades['str_exp']
  upgrades['defense'] ??= upgrades['def']
  upgrades['defense_exp'] ??= upgrades['def_exp']
  upgrades['dexterity'] ??= upgrades['dex']
  upgrades['dexterity_exp'] ??= upgrades['dex_exp']
  upgrades['agility'] ??= upgrades['agi']
  upgrades['agility_exp'] ??= upgrades['agi_exp']
  // Apply the upgrades
  for (const stat in simulatedPlayer.mults) {
    let upgradeCalculated = 1
    if (upgrades.hasOwnProperty(stat) && upgrades[stat] !== undefined) {
      // stat may be specified in x*y*z format, so multiply it all together before applying it
      upgradeCalculated = evaluateMultipliers(upgrades[stat])
    }
    // if 'all' is specified, multiply that in too
    if (upgrades.hasOwnProperty('all') && stats.includes(stat)) {
      upgradeCalculated *= evaluateMultipliers(upgrades['all'])
    }
    if (upgradeCalculated !== 1) {
      simulatedPlayer.mults[stat] *= upgradeCalculated
      // Log the change
      log(ns, `${stat}: ${round(player.mults[stat], 4)} -> ${round(simulatedPlayer.mults[stat], 4)} ` +
              `(+${round((simulatedPlayer.mults[stat] / player.mults[stat] - 1) * 100, 4)}%)`)
    }
  }
  // log(ns, `Simulated player: ${JSON.stringify(simulatedPlayer.mults, null, 2)}`)

  // Calculate the rewards for the original player
  const originalRewards = getAllRewards(ns, bnMults, player, wks, false)

  // Calculate the rewards for the simulated player
  const simulatedRewards = getAllRewards(ns, bnMults, simulatedPlayer, wks, false)

  // Find the ECorp location in the rewards
  const simulatedECorp = simulatedRewards.find(r => r.name === 'ECorp')
  const originalECorp = originalRewards.find(r => r.name === 'ECorp')

  // Compare the rewards
  if (simulatedECorp && originalECorp) {
    // Are they the same?
    if (simulatedECorp.repGain === originalECorp.repGain && simulatedECorp.moneyGain === originalECorp.moneyGain) {
      log(ns, 'The rep and money gains are unchanged.', true)
      log(ns, `For ECorp, the rep gain would be ${formatNumberShort(simulatedECorp.repGain)}, and the money gain would be ${formatMoney(simulatedECorp.moneyGain)}.`, true)
    } else {
      log(ns, `For ECorp, the rep gain would change from ${formatNumberShort(originalECorp.repGain)} to ${formatNumberShort(simulatedECorp.repGain)}, and the money gain would change from ${formatMoney(originalECorp.moneyGain)} to ${formatMoney(simulatedECorp.moneyGain)}.`, true)
    }
  }
}

// SoA aug check
async function hasSoaAug (ns) {
  try {
    const augs = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt')
    return augs.some(aug => aug.toLowerCase().includes('wks harmonizer'))
  } catch (err) {
    log(ns, `WARN: Could not get list of owned augs: ${err.toString()}`)
    log(ns, 'WARN: Assuming no WKS harmonizer aug is installed.')
  }
  return false
}

export async function main (ns) {
  ns.disableLog('ALL')
  const options = ns.flags(argsSchema)
  if (options.stop) {
    setTimeFactor(1)
    await stopService(ns, serviceName)
    return
  }
  // get BN multipliers first to feed reward info to infiltration service
  const bnMults = await tryGetBitNodeMultipliers(ns) ?? { InfiltrationRep: 1, InfiltrationMoney: 1 }
  const player = await getNsDataThroughFile(ns, 'ns.getPlayer()', '/Temp/player-info.txt')
  const wks = await hasSoaAug(ns)

  if (options.listLocations) {
    getAllRewards(ns, bnMults, player, wks, true)
    return
  }
  if (options.preview) {
    try {
      const upgrades = JSON.parse(options.preview)
      await simulateAugInstall(ns, player, upgrades, bnMults, wks)
    }
    catch (err) {
      log(ns, `ERROR: Could not parse upgrade string: ${err.toString()}`, true)
    }
    return
  }


  // set time factor
  infiltrationTimeFactor = options.timeFactor
  keyDelay = options.keyDelay
  // ensure that we're running this on home, if necessary
  const host = ns.getHostname()
  if (host !== options.allowedHost) {
    log(ns, `ERROR: script is running on ${host}, not on ${options.allowedHost} as required. Exiting.`, true)
    return
  }

  const locations = getAllRewards(ns, bnMults, player, wks)
  // Write the best reward to a file
  const bestReward = locations[locations.length - 1]
  await ns.write(rewardsFile, JSON.stringify(bestReward, ['name', 'moneyGain', 'repGain'], 2), 'w')

  log(ns, `Time factor: ${infiltrationTimeFactor}`, true)
  log(ns, `Infiltration multipliers: ${bnMults?.InfiltrationRep}× rep (${formatNumberShort(bestReward.repGain)}), ` +
          `${bnMults?.InfiltrationMoney}× money (${formatMoney(bestReward.moneyGain)})`, true)
  log(ns, `WKS harmonizer aug: ${wks ? 'yes' : 'no'}`, true)
  
  // launch service and see if it connects
  const service = new InfiltrationService(ns, locations)
  const intervalId = service.start()
  await registerService(ns, serviceName, intervalId, options)
  log(ns, `Started infiltration service: tF = ${infiltrationTimeFactor}`, false, 'success')
  log(ns, `Infiltration service is running with interval ID ${intervalId}`, true)
  log(ns, 'Script will now exit.')
}
