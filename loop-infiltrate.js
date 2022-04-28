import { log } from './helpers'

const doc = eval('document')

/** @param {import(".").NS} ns */
export async function main (ns) {
  ns.disableLog('ALL')
  ns.tail()
  if (ns.getPlayer().city != 'Aevum') {
    if (!ns.travelToCity('Aevum')) { return ns.tprint('ERROR: Sorry, you need at least 200k to travel.') }
  }
  getCity().click()
  let canceled = false
  const cancelHook = function () {
  	const btn = [...doc.getElementsByTagName('button')].find(e => e.innerText === 'Cancel')
    if (!btn) return
    const fn = btn.onclick
	if (fn._hooked) return
    btn.onclick = () => { canceled = true; fn() }
    btn.onclick._hooked = true
  }
  while (!canceled) {
    let fail = false
    getEcorp().click()
    clickUntrusted('Infil')
    log(ns, 'Started loop')
    while (!infiltrationComplete()) {
      await ns.asleep(1000)
      cancelHook()
      if (getEcorp()) {
        // booted to city!
        fail = true
        break
      }
      log(ns, 'Waiting')
    }
    if (fail) {
      continue
    }

    log(ns, 'Sell')
    getButton('Sell').click()
    await ns.asleep(1000)
  }
}

function getCity () {
  for (const elem of doc.querySelectorAll('p')) {
    if (elem.textContent == 'City') {
      return elem
    }
  }
}

function getEcorp () {
  return doc.querySelector('[aria-label="ECorp"]')
}

function getButton (text) {
  for (const elem of doc.querySelectorAll('button')) {
    if (elem.textContent.toLowerCase().includes(text.toLowerCase())) {
      return elem
    }
  }
}

function clickUntrusted (text) {
  const button = getButton(text)
  const handler = Object.keys(button)[1]
  button[handler].onClick({ isTrusted: true })
}

function infiltrationComplete () {
  return [...doc.querySelectorAll('h4')].some(e => e.innerText === 'Infiltration successful!')
}
