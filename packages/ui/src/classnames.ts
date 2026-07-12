/** Minimal className joiner (no dependency), shared by UI surfaces. */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
