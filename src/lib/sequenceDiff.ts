// Hirschberg LCS: linear auxiliary memory, with unchanged edges and disjoint
// ranges handled directly. Every match and conflict remains a single line.
export const matchingLines = (base: string[], next: string[]): [number, number][] => {
  const anchors: [number, number][] = []
  const scores = (a0: number, a1: number, b0: number, b1: number, reverse: boolean) => {
    const row = new Uint32Array(b1 - b0 + 1)
    for (let i = 0; i < a1 - a0; i++) {
      let previous = 0
      const line = base[reverse ? a1 - i - 1 : a0 + i]
      for (let j = 1; j < row.length; j++) {
        const saved = row[j]
        row[j] = line === next[reverse ? b1 - j : b0 + j - 1]
          ? previous + 1 : Math.max(row[j], row[j - 1])
        previous = saved
      }
    }
    return row
  }
  const splitPoint = (a0: number, middle: number, a1: number, b0: number, b1: number) => {
    const left = scores(a0, middle, b0, b1, false)
    const right = scores(middle, a1, b0, b1, true)
    let best = -1
    let split = 0
    for (let j = 0; j <= b1 - b0; j++) {
      const score = left[j] + right[b1 - b0 - j]
      if (score > best) { best = score; split = j }
    }
    return b0 + split
  }
  const visit = (a0: number, a1: number, b0: number, b1: number) => {
    while (a0 < a1 && b0 < b1 && base[a0] === next[b0]) anchors.push([a0++, b0++])
    let suffix = 0
    while (a0 < a1 && b0 < b1 && base[a1 - 1] === next[b1 - 1]) { a1--; b1--; suffix++ }
    if (a0 < a1 && b0 < b1) {
      if (a1 - a0 === 1) {
        for (let j = b0; j < b1; j++) {
          if (base[a0] === next[j]) { anchors.push([a0, j]); break }
        }
      } else {
        // A wholesale rewrite often has no shared lines at all: avoid LCS work.
        const candidates = new Set(next.slice(b0, b1))
        let shared = false
        for (let i = a0; i < a1 && !shared; i++) shared = candidates.has(base[i])
        candidates.clear()
        if (shared) {
          const middle = a0 + Math.floor((a1 - a0) / 2)
          const split = splitPoint(a0, middle, a1, b0, b1)
          visit(a0, middle, b0, split)
          visit(middle, a1, split, b1)
        }
      }
    }
    for (let i = 0; i < suffix; i++) anchors.push([a1 + i, b1 + i])
  }
  visit(0, base.length, 0, next.length)
  return anchors
}

export const textLines = (text: string) => text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n')
