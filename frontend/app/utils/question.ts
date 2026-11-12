export const QUESTION_MAX = 500;

export type QuestionValidation = { ok: true; value: string } | { ok: false; error: string };

/** 与 Studio validateQuestion 一致：trim 后长度 1–500，空白拒绝，返回 trim 后的值 */
export function validateQuestion(s: unknown): QuestionValidation {
  if (typeof s !== 'string') return { ok: false, error: '问题必须是文本' };
  const value = s.trim();
  if (value.length < 1) return { ok: false, error: '请输入问题' };
  if (value.length > QUESTION_MAX) return { ok: false, error: `问题不能超过 ${QUESTION_MAX} 个字符` };
  return { ok: true, value };
}
