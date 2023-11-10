// skip.js
// Simulate a time skip by editing the player's save data.

// not a necessary import, but it's a way to make this script crash if services.js is missing
import { _win } from "./services"

const thisScript = 'skip.js' // hardcoded to save ram

export async function editPlayerData (callback) {
  // get save data
  const db = await getDB('bitburnerSave', 1)
  const rawData = await getIdbData(db, 'savestring', 'save')
  const saveData = JSON.parse(b64decode(rawData))
  const playerData = JSON.parse(saveData.data.PlayerSave)
  // muck about with it
  callback(playerData.data)
  // bundle it up and save
  saveData.data.PlayerSave = JSON.stringify(playerData)
  const newRawSave = b64encode(JSON.stringify(saveData))
  await putIdbData(db, 'savestring', 'save', newRawSave)
}

function getDB (name, version) {
  return new Promise((resolve, reject) => {
    const idb = getWindow().indexedDB
    const request = idb.open(name, version)
    request.onsuccess = event => resolve(event.target.result)
    request.onerror = event => reject(event.target.errorCode)
  })
}

function getIdbData (db, objectStore, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(objectStore).objectStore(objectStore).get(key)
    request.onsuccess = event => resolve(event.target.result)
    request.onerror = event => reject(event.target.errorCode)
  })
}

function putIdbData (db, objectStore, key, data) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(objectStore, 'readwrite').objectStore(objectStore).put(data, key)
    request.onsuccess = event => resolve(event.target.result)
    request.onerror = event => reject(event.target.errorCode)
  })
}

function b64decode (data) {
  return decodeURIComponent(escape(atob(data)))
}

function b64encode (data) {
  return btoa(unescape(encodeURIComponent(data)))
}

export function getWindow () {
  return [].map.constructor('return this')()
}

export function parseTime (timeStr) {
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

/** @param {import(".").NS} ns */
export async function main (ns) {
  if (ns.args.length === 0) {
    ns.tprint(`Usage: ${thisScript} <time>`)
    ns.tprint(`Example: ${thisScript} 1h 30m 15s`)
    return
  }
  const skipAmount = parseTime(ns.args.join(' '))
  ns.tprint(`Skipping ${skipAmount} ms...`)
  await editPlayerData(playerData => {
    playerData.lastSave -= skipAmount
    playerData.lastUpdate -= skipAmount
  })
  // Spawn a new process to reload the window.
  // This is necessary because it needs to be executed with the 'temporary' flag,
  // which can't be done from the terminal (afaik).
  // If it's not set, the reloading script may resume execution immediately after the reload,
  // trapping us in a hellish infinite loop of ever-increasing time skips.
  ns.exec('services.js', 'home', { temporary: true }, 'reload')
}
