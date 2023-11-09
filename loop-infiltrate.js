import { log } from './helpers'

const win = [].map.constructor('return this')()
/* eslint-disable-next-line dot-notation */
const doc = win['document']

let _ns

const argsSchema = [
  ['auto-sell', false], // disable automatically selling the intel at the end of the loop
  ['n', 0], // number of times to run the loop (0 = infinite)
]
let autoSell = false
const failLimit = 3

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
  ns.print(`Running with options: ${JSON.stringify(options, (k, v) => k !== '_' ? v : undefined, 2)}`)
  autoSell = options['auto-sell']
  const maxLoops = options['n']
  try {
    await mainLoop(maxLoops)
  } catch (err) {
    log(_ns, err.toString())
    throw err
  }
}

async function mainLoop (maxLoops = 0) {
  let canceled = false
  let consecutiveFails = 0

  function addControls () {
    // add a button to cancel the loop, and a checkbox to enable auto-sell
    const btn = doc.createElement('button')
    btn.innerText = 'Stop Infiltration Loop'
    btn.className = 'css-1e71pau'
    btn.onclick = () => {
      canceled = true
      removeControls()
    }
    const checkbox = doc.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = autoSell
    checkbox.onchange = () => { autoSell = checkbox.checked }
    const label = doc.createElement('label')
    label.innerText = 'Auto-sell'
    label.appendChild(checkbox)
    const div = doc.createElement('div')
    div.id = 'infiltration-loop-controls'
    div.style = 'font-family: Consolas; color: lime; padding: 0.5em; border: 1px #333 solid;'
    div.appendChild(label)
    div.appendChild(doc.createElement('br'))
    div.appendChild(btn)
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

  const cancelHook = function () {
    const btn = [...doc.getElementsByTagName('button')].find(e => e.innerText.includes('Cancel Infiltration'))
    if (!btn) return
    const fn = btn.onclick
    if (fn._hooked) return
    btn.onclick = () => { canceled = true; fn() }
    btn.onclick._hooked = true
  }
  let loopCount = 0
  /* eslint-disable-next-line no-unmodified-loop-condition */
  while (!canceled) {
    let fail = false
    if (consecutiveFails > failLimit) {
      log(_ns, `ERROR: More than ${failLimit} consecutive failures detected. Exiting loop.`)
      break
    }
    if (!ensureAevum()) {
      log(_ns, 'ERROR: Could not find ECorp in Aevum.')
      break
    }
    await _ns.asleep(0)
    getEcorp().click()
    clickTrusted(queryFilter('button', 'Infil'))
    log(_ns, `Started iteration #${loopCount+1}`)
    // Wrap the loop in a try/catch so that we can remove the controls if the loop fails
    addControls()
    try {
      while (!infiltrationComplete()) {
        await _ns.asleep(1000)
        cancelHook()
        if (getEcorp()) {
          // booted to city!
          fail = true
          break
        }
        if (canceled) {
          break
        }
        // log(ns, 'Waiting')
      }
      if (fail) {
        console.log('### INFILTRATION FAILED ###')
        consecutiveFails++
        continue
      }
      console.log('---INFILTRATION SUCCESS---')
      consecutiveFails = 0
      if (autoSell) {
        // automatically click sell button
        const sellBtn = queryFilter('button', 'Sell')
        if (sellBtn) {
          log(_ns, `Selling for ${sellBtn.innerText.split('\n').at(-1)}`)
          sellBtn.click()
        }
      } else {
        // wait for the user to make a choice on selling intel
        while (queryFilter('h4', 'Infiltration successful!') !== undefined) {
          await _ns.asleep(1000)
        }
      }
      loopCount++
      if (loopCount === maxLoops) {
        log(_ns, `INFO: Reached max loop count of ${maxLoops}. Exiting loop.`)
        break
      }
      await _ns.asleep(1000)
    }
    finally {
      removeControls()
    }
  }
}

function queryFilter (query, filter) {
  return [...doc.querySelectorAll(query)].find(e => e.innerText.trim().match(filter))
}

function ensureAevum () {
  if (_ns.getPlayer().city !== 'Aevum' && !_ns.singularity.travelToCity('Aevum')) {
    log(_ns, 'ERROR: Sorry, you need at least $200k to travel.')
    return false
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
  node[handler].onClick({ isTrusted: true })
}

function infiltrationComplete () {
  const ret = queryFilter('h4', 'Infiltration successful!') !== undefined
  return ret
}
