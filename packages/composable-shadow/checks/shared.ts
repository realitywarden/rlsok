import { atPointer } from '../contracts';

export const finiteVector = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(n => typeof n === 'number' && Number.isFinite(n));

export function poseVector(goal: Record<string, unknown>, mapping: string | string[], keys: string[]): unknown {
  if (Array.isArray(mapping)) return mapping.map(pointer => atPointer(goal, pointer));
  const value = atPointer(goal, mapping);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Object.keys(value).length === keys.length &&
      keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) {
    return keys.map(key => (value as Record<string, unknown>)[key]);
  }
  return undefined;
}
