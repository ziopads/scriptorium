// The matching blocks of Python's difflib.SequenceMatcher, for lib/matcher.ts.
//
// pipeline/dossier.py's close match calls
//
//     difflib.SequenceMatcher(None, quote_key, page_key, autojunk=False)
//         .get_matching_blocks()
//
// and this is that call, ported from CPython 3.13's Lib/difflib.py with
// nothing left out that can change a result. No junk function and autojunk
// off mean b2j holds every position of every element and isbjunk is always
// false, so of find_longest_match's four extension loops only the first two
// can run; they are kept anyway, as in the source. The work queue is a stack
// (list.pop()), the blocks are sorted, adjacent blocks are merged, and a
// sentinel of size 0 ends the list. dossier.py keeps blocks of 3 or more
// AFTER the merge, so the merge changes which blocks count.
//
// Elements are whole characters (code points), never UTF-16 code units: the
// caller passes Array.from(text). Python counts characters, and the 92 per
// cent ratio and the span bounds are counts.

export type Block = { a: number; b: number; size: number };

export function matchingBlocks(a: string[], b: string[]): Block[] {
  // __chain_b: every element of b, with its positions in ascending order.
  const b2j = new Map<string, number[]>();
  b.forEach((elt, j) => {
    const indices = b2j.get(elt);
    if (indices) indices.push(j);
    else b2j.set(elt, [j]);
  });
  const nothing: number[] = [];

  // find_longest_match(alo, ahi, blo, bhi)
  function longest(alo: number, ahi: number, blo: number, bhi: number): Block {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? nothing) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // The non-junk extension loops (isbjunk is always false here).
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    // The junk extension loops require isbjunk(...) to be true, so they never
    // run with no junk; omitted.
    return { a: besti, b: bestj, size: bestsize };
  }

  // get_matching_blocks()
  const la = a.length;
  const lb = b.length;
  const queue: [number, number, number, number][] = [[0, la, 0, lb]];
  const found: Block[] = [];
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const x = longest(alo, ahi, blo, bhi);
    const { a: i, b: j, size: k } = x;
    if (k) {
      found.push(x);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  found.sort((x, y) => x.a - y.a || x.b - y.b || x.size - y.size);

  const out: Block[] = [];
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  for (const { a: i2, b: j2, size: k2 } of found) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) out.push({ a: i1, b: j1, size: k1 });
      i1 = i2;
      j1 = j2;
      k1 = k2;
    }
  }
  if (k1) out.push({ a: i1, b: j1, size: k1 });
  out.push({ a: la, b: lb, size: 0 });
  return out;
}
