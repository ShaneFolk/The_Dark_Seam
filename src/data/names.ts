// Names for the people of Carrow Deep and callsigns for the squads (all made up for this game).
// Names are worked out from the seed and the person's id with a hash, so they never
// use the sim's random numbers: adding names doesn't change how a run plays out.

const FIRST = [
  'Ada', 'Bram', 'Cal', 'Dara', 'Edda', 'Fenn', 'Gil', 'Hana', 'Ivo', 'Jessa', 'Kip', 'Lorn',
  'Mara', 'Nell', 'Oren', 'Pia', 'Quill', 'Rhea', 'Sol', 'Tamsin', 'Ulla', 'Vash', 'Wren', 'Yara',
  'Zed', 'Abel', 'Brin', 'Cora', 'Dov', 'Esme', 'Faro', 'Greta', 'Hollis', 'Iska', 'Joss', 'Kell',
  'Lio', 'Mott', 'Nadia', 'Odo', 'Petra', 'Rook', 'Sabe', 'Teo', 'Vera', 'Wim', 'Yusuf', 'Zora',
] as const

const LAST = [
  'Ashby', 'Barrow', 'Cindle', 'Dunmore', 'Erskine', 'Flint', 'Garrick', 'Holm', 'Ingle', 'Jarrow',
  'Kettle', 'Lusk', 'Marsh', 'Noll', 'Orrel', 'Pike', 'Quarry', 'Rusk', 'Slate', 'Thorne', 'Umber',
  'Varn', 'Wick', 'Yarrow', 'Coalby', 'Delve', 'Eckart', 'Fallow', 'Graft', 'Hewer', 'Iron',
  'Kiln', 'Lode', 'Mott', 'Nab', 'Ore', 'Pitt', 'Reeve', 'Shale', 'Tallow', 'Vance', 'Weir',
] as const

const CALLSIGNS = [
  'Anvil', 'Lantern', 'Pickaxe', 'Cinder', 'Bastion', 'Ember', 'Granite', 'Slate',
  'Hammer', 'Ironside', 'Beacon', 'Quarry', 'Flint', 'Bulwark', 'Tinder', 'Basalt',
] as const

/** A small integer hash (deterministic, independent of the sim's RNG). */
function hash(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  return h >>> 0
}

/** "Edda Rusk": the same seed and id always give the same name. */
export function personName(seed: number, id: number): string {
  const h = hash(seed, id)
  return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]}`
}

/** A squad's callsign, e.g. "Anvil". Shuffled per seed so runs differ. */
export function squadCallsign(seed: number, squadId: number): string {
  const offset = hash(seed, 7) % CALLSIGNS.length
  return CALLSIGNS[(offset + squadId) % CALLSIGNS.length]
}
