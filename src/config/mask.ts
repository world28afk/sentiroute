/**
 * API key masking utility.
 *
 * Deep-clones an object, recursively walks for any key named `api_key`,
 * and replaces the value with a masked form:
 *   - length > 8: first 2 chars + '...' + last 6 chars  (e.g. "sk...klmnop")
 *   - length <= 8: '***'
 *
 * Pure function — no I/O, no side effects.
 */

export function maskApiKeys<T>(obj: T): T {
  const clone = structuredClone(obj);
  return walk(clone);
}

function walk<T>(val: T): T {
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      val[i] = walk(val[i]);
    }
    return val;
  }

  if (val !== null && typeof val === 'object') {
    const record = val as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === 'api_key' && typeof record[key] === 'string') {
        record[key] = maskString(record[key] as string);
      } else {
        record[key] = walk(record[key]);
      }
    }
    return record as T;
  }

  return val;
}

function maskString(s: string): string {
  if (s.length > 8) {
    return s.slice(0, 2) + '...' + s.slice(-6);
  }
  return '***';
}
