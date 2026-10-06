import { describe, expect, it } from 'vitest'
import { matchingLines } from './sequenceDiff'

describe('linear-memory line alignment', () => {
  it('finds an optimal ordered alignment with repeated, inserted and deleted lines', () => {
    const sequences: string[][] = [[]]
    for (let size = 1; size <= 4; size++) {
      for (let mask = 0; mask < 2 ** size; mask++) {
        sequences.push(Array.from({ length: size }, (_, i) => mask & (1 << i) ? 'A' : 'B'))
      }
    }
    for (const base of sequences) for (const next of sequences) {
      const reference = Array.from({ length: base.length + 1 }, () => new Array<number>(next.length + 1).fill(0))
      for (let i = 1; i <= base.length; i++) for (let j = 1; j <= next.length; j++) {
        reference[i][j] = base[i - 1] === next[j - 1]
          ? reference[i - 1][j - 1] + 1 : Math.max(reference[i - 1][j], reference[i][j - 1])
      }
      const matches = matchingLines(base, next)
      expect(matches.length).toBe(reference[base.length][next.length])
      matches.forEach(([i, j], index) => {
        expect(base[i]).toBe(next[j])
        if (index) {
          expect(i).toBeGreaterThan(matches[index - 1][0])
          expect(j).toBeGreaterThan(matches[index - 1][1])
        }
      })
    }
  })
})
