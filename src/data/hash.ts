// Stable data hash for saves (plan.md §6.4: a save loads only when its
// dataHash matches). FNV-1a 32-bit over the UTF-8 bytes of a canonical JSON
// (object keys sorted, arrays in order), so key order and whitespace in the
// files never change the hash.

/** JSON with object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .toSorted()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** FNV-1a 32-bit of the UTF-8 bytes of `text`, as 8 lowercase hex digits. */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Pure, order-independent hash of the raw (config-merged) data tables. */
export function dataHash(raw: unknown): string {
  return fnv1a32(canonicalJson(raw))
}
