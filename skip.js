// skip.js

const reloadDelay = 1500

export async function editPlayerData (callback) {
  // get save data
  const db = await getDB('bitburnerSave', 1)
  const rawData = await getIdbData(db, 'savestring', 'save')
  const saveData = JSON.parse(b64decode(rawData))
  const playerData = JSON.parse(saveData.data.PlayerSave)
  // muck about with it
  callback(playerData)
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
  const skipAmount = parseTime(ns.args.join(' '))
  ns.print(`Skipping ${skipAmount} ms...`)
  await editPlayerData(playerData => {
    playerData.data.lastSave -= skipAmount
    playerData.data.lastUpdate -= skipAmount
  })
  // delay to avoid reloading/exiting before save edit is complete
  setTimeout(() => { getWindow().location.reload() }, reloadDelay)
  await ns.sleep(10e3 + reloadDelay)
}
