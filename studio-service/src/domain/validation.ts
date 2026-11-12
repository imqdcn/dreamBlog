export const DREAM_CONTENT_MAX = 10000;
export const QUESTION_MAX = 500;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function validateText(input: unknown, field: string, max: number): ValidationResult<string> {
  if (typeof input !== 'string') return { ok: false, error: `${field} must be a string` };
  const value = input.trim();
  if (value.length < 1 || value.length > max) {
    return { ok: false, error: `${field} length must be between 1 and ${max} after trimming` };
  }
  return { ok: true, value };
}

/** 梦境内容：trim 后长度 1–10000，返回 trim 后的值 */
export function validateDreamContent(input: unknown): ValidationResult<string> {
  return validateText(input, 'content', DREAM_CONTENT_MAX);
}

/** Agent 问题：trim 后长度 1–500，返回 trim 后的值 */
export function validateQuestion(input: unknown): ValidationResult<string> {
  return validateText(input, 'question', QUESTION_MAX);
}

/** 珍藏请求体：isFavorite 必须为布尔值 */
export function validateFavoriteBody(body: unknown): ValidationResult<boolean> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }
  const v = (body as Record<string, unknown>).isFavorite;
  if (typeof v !== 'boolean') return { ok: false, error: 'isFavorite must be a boolean' };
  return { ok: true, value: v };
}
