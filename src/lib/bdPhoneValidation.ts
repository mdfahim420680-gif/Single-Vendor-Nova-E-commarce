export const BANGLADESH_MOBILE_PREFIXES = [
  '013',
  '014',
  '015',
  '016',
  '017',
  '018',
  '019',
] as const;

export function normalizeBangladeshMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (!value || !/^[+\d\s()-]+$/.test(value)) return null;

  const hasUnsupportedParentheses =
    (value.match(/\(/g)?.length || 0) !== (value.match(/\)/g)?.length || 0);
  if (hasUnsupportedParentheses) return null;

  const compact = value.replace(/[\s()-]/g, '');
  let national: string;

  if (/^01[3-9]\d{8}$/.test(compact)) {
    national = compact;
  } else if (/^\+8801[3-9]\d{8}$/.test(compact)) {
    national = `0${compact.slice(4)}`;
  } else if (/^8801[3-9]\d{8}$/.test(compact)) {
    national = `0${compact.slice(3)}`;
  } else {
    return null;
  }

  if (!BANGLADESH_MOBILE_PREFIXES.includes(national.slice(0, 3) as (typeof BANGLADESH_MOBILE_PREFIXES)[number])) {
    return null;
  }
  if (/^0+$/.test(national) || /^01[3-9]0{8}$/.test(national)) return null;

  return `+880${national.slice(1)}`;
}

export function isValidBangladeshMobile(input: unknown): boolean {
  return normalizeBangladeshMobile(input) !== null;
}
