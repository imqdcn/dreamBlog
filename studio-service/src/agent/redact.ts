/** 脱敏与输出检查（需求 2.6、12.6、12.7、12.8）。 */

export const REDACTED = '[REDACTED]';

/** 回答含密钥取值时整体替换成的固定安全提示。 */
export const SAFE_NOTICE = '回答包含敏感信息，已被系统拦截。请换一种方式提问。';

/** 空串不是有效密钥；较长的取值优先替换，避免被较短取值截断后残留。 */
function normalize(secrets: readonly string[]): string[] {
  return [...new Set(secrets.filter((s) => typeof s === 'string' && s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
}

/** 把文本中的任何密钥取值替换为 `[REDACTED]`。 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of normalize(secrets)) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/** 回答含任一密钥取值时整体替换为固定安全提示，并标记 `redacted=true`；否则原样返回。 */
export function checkOutput(
  answer: string,
  secrets: readonly string[],
): { answer: string; redacted: boolean } {
  for (const secret of normalize(secrets)) {
    if (answer.includes(secret)) return { answer: SAFE_NOTICE, redacted: true };
  }
  return { answer, redacted: false };
}
