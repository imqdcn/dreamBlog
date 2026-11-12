import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOutput, redactSecrets, REDACTED, SAFE_NOTICE } from './agent/redact.js';
import { logger, registerSecrets } from './logger.js';

const SECRETS = ['pass-word-123', 'session-key-456', 'llm-key-789', 'backend-token-000'];

describe('redact', () => {
  it('replaces every secret occurrence', () => {
    const out = redactSecrets('a pass-word-123 b llm-key-789 c pass-word-123', SECRETS);
    expect(out).toBe(`a ${REDACTED} b ${REDACTED} c ${REDACTED}`);
  });

  it('ignores empty secrets', () => {
    expect(redactSecrets('hello', [''])).toBe('hello');
  });

  it('checkOutput replaces whole answer when it contains a secret', () => {
    expect(checkOutput('x backend-token-000 y', SECRETS)).toEqual({ answer: SAFE_NOTICE, redacted: true });
  });

  it('checkOutput passes clean answers through', () => {
    expect(checkOutput('clean', SECRETS)).toEqual({ answer: 'clean', redacted: false });
  });
});

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits single-line JSON with redaction', () => {
    registerSecrets(SECRETS);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('token is session-key-456', 'run-1', { detail: { k: 'pass-word-123' } });
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: 'info', runId: 'run-1', msg: `token is ${REDACTED}` });
    expect(typeof parsed.ts).toBe('string');
    for (const s of SECRETS) expect(line).not.toContain(s);
  });
});
