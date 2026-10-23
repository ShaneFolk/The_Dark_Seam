// Every connection between levels. Each letter appears exactly once on each
// of its two levels' maps. A–G join Levels 1 and 2; H–N join Levels 2 and 3.

import type { LinkDef } from '../../world/links.ts'

export const LINKS: LinkDef[] = [
  // Surface Colony ↔ Upper Mine
  { id: 'A', kind: 'elevator', name: 'Main elevator (upper shaft)', levels: [1, 2] },
  { id: 'B', kind: 'ladder', name: 'West stairwell ladder', levels: [1, 2] },
  { id: 'C', kind: 'ladder', name: 'East stairwell ladder', levels: [1, 2] },
  { id: 'D', kind: 'chute', name: 'Ore chute to Ore Processing', levels: [1, 2] },
  { id: 'E', kind: 'vent', name: 'Vent shaft to Generator North', levels: [1, 2] },
  { id: 'F', kind: 'vent', name: 'Vent shaft to Med Bay', levels: [1, 2] },
  { id: 'G', kind: 'vent', name: 'Vent shaft to Quarters D', levels: [1, 2] },

  // Upper Mine ↔ Deep Mine
  { id: 'H', kind: 'elevator', name: 'Main elevator (lower shaft)', levels: [2, 3] },
  { id: 'I', kind: 'ladder', name: 'Deep ladder', levels: [2, 3] },
  { id: 'J', kind: 'chute', name: 'Ore chute to Old Pump Station', levels: [2, 3] },
  { id: 'K', kind: 'chute', name: 'East ore chute', levels: [2, 3] },
  { id: 'L', kind: 'vent', name: 'West deep vent', levels: [2, 3] },
  { id: 'M', kind: 'vent', name: 'Central deep vent', levels: [2, 3] },
  { id: 'N', kind: 'vent', name: 'East deep vent', levels: [2, 3] },
]
