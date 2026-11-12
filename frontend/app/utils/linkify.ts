export interface LinkifyDream {
  documentId: string
  title?: string | null
}

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'dreamLink'; text: string; documentId: string; to: string }

/**
 * Split an answer into plain-text and dream-link segments.
 * A dream matches by its title or documentId. Text is preserved verbatim, so
 * concatenating all segment texts reproduces the input. No HTML is built.
 */
export function linkifyAnswer(text: string, dreams: LinkifyDream[]): Segment[] {
  if (!text) return []

  // Candidate needles: longer first so that longest match wins at a position.
  const needles: { needle: string; documentId: string }[] = []
  for (const d of dreams ?? []) {
    if (!d || !d.documentId) continue
    needles.push({ needle: d.documentId, documentId: d.documentId })
    const title = d.title?.trim()
    if (title) needles.push({ needle: title, documentId: d.documentId })
  }
  needles.sort((a, b) => b.needle.length - a.needle.length)

  const segments: Segment[] = []
  let buffer = ''
  let i = 0
  while (i < text.length) {
    const hit = needles.find((n) => text.startsWith(n.needle, i))
    if (hit) {
      if (buffer) {
        segments.push({ type: 'text', text: buffer })
        buffer = ''
      }
      segments.push({
        type: 'dreamLink',
        text: hit.needle,
        documentId: hit.documentId,
        to: `/dream/${encodeURIComponent(hit.documentId)}`,
      })
      i += hit.needle.length
    } else {
      buffer += text[i]
      i++
    }
  }
  if (buffer) segments.push({ type: 'text', text: buffer })
  return segments
}
