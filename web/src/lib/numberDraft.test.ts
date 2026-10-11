import { expect, it } from 'vitest';
import { finalValue, liveValue } from './numberDraft';

it('waits while a number is being typed and commits only valid in-range values', () => {
  expect(liveValue('', 60, 250)).toBeNull();
  expect(liveValue('1', 60, 250)).toBeNull(); // on the way to 130: don't snap to 60
  expect(liveValue('13', 60, 250)).toBeNull();
  expect(liveValue('130', 60, 250)).toBe(130);
  expect(liveValue('999', 60, 250)).toBeNull();
  expect(liveValue('abc', 60, 250)).toBeNull();
  expect(liveValue('0.75', 0, 3)).toBe(0.75);
  expect(liveValue('.', 0, 3)).toBeNull();
});

it('clamps on blur and keeps the last good value for an empty or invalid entry', () => {
  expect(finalValue('999', 60, 250, 125)).toBe(250);
  expect(finalValue('1', 60, 250, 125)).toBe(60);
  expect(finalValue('', 60, 250, 125)).toBe(125);
  expect(finalValue('abc', 60, 250, 125)).toBe(125);
  expect(finalValue(' 140 ', 60, 250, 125)).toBe(140);
});
