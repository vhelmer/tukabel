export const replaceAt = <T>(values: readonly T[], index: number, value: T) =>
  values.map((entry, position) => (position === index ? value : entry));
export function nextId(prefix: string, ids: readonly string[]) {
  let index = 1;
  while (ids.includes(`${prefix}${index}`)) index++;
  return `${prefix}${index}`;
}
