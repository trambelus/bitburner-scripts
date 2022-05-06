import { editPlayerData } from './skip'

const reloadDelay = 1500

const argsSchema = [
  ['refresh', false] // true to automatically refresh the game after editing the save
]

/** @param {import(".").NS} ns */
export async function main (ns) {
  const options = ns.flags(argsSchema)
  const evalStr = options._.join(' ')
  ns.print(`Evaluating '${evalStr}'`)
  await editPlayerData(playerData => {
    /* eslint-disable-next-line no-eval */
    eval(evalStr)
  })
  // delay to avoid reloading/exiting before save edit is complete
  if (options.refresh) {
    setTimeout(() => { globalThis.location.reload() }, reloadDelay)
    await ns.sleep(10e3 + reloadDelay)
  }
}
