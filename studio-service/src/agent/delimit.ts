/**
 * 数据分隔区与转义（需求 7.9、12.1、12.2）。
 * 不可信内容经转义后包裹在 <<<DATA ...>>> 与 <<<END_DATA ...>>> 之间。
 */

/** 把 `<<<` 替换为全角 `＜＜＜`，`>>>` 替换为 `＞＞＞`；其余文本保持不变。 */
export function escapeUntrusted(text: string): string {
  return text.replace(/<<</g, '＜＜＜').replace(/>>>/g, '＞＞＞');
}

/** 来源名只用于属性值：去掉引号、尖括号与控制字符，避免伪造标记。 */
function sanitizeSource(source: string): string {
  // eslint-disable-next-line no-control-regex
  return source.replace(/[<>"\u0000-\u001f\u007f]/g, '');
}

/** 用 DATA / END_DATA 标记包裹不可信文本；文本先转义，因此不可能含 ASCII 结束标记。 */
export function delimit(source: string, text: string, id: string): string {
  const safeId = sanitizeSource(id);
  return (
    `<<<DATA source="${sanitizeSource(source)}" id="${safeId}">>>\n` +
    `${escapeUntrusted(text)}\n` +
    `<<<END_DATA id="${safeId}">>>`
  );
}
