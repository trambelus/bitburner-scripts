import { editPlayerData } from './skip'

const reloadDelay = 1500

/** @param {import(".").NS} ns */
export async function main (ns) {
  const evalStr = ns.args.join(' ')
  ns.print(`Evaluating '${evalStr}'`)
  await editPlayerData(playerData => {
    /* eslint-disable-next-line no-eval */
    eval(evalStr)
  })
  // delay to avoid reloading/exiting before save edit is complete
  // setTimeout(() => { getWindow().location.reload() }, reloadDelay)
  await ns.sleep(10e3 + reloadDelay)
}
