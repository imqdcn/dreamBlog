/**
 * 生成摘录：不超过 maxLength 个字符原样返回，否则返回前 maxLength 个字符加“…”。
 * Requirements: 8.4
 */
export function excerpt(text: string, maxLength = 120): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '…'
}
