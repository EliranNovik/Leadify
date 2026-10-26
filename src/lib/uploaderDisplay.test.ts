import test from 'node:test';
import assert from 'node:assert/strict';
import { initialsFromUploaderName, uploaderAvatarGradient } from './uploaderDisplay';

test('one person keeps one avatar colour', () => {
  assert.equal(uploaderAvatarGradient('Eliran Novik'), uploaderAvatarGradient('Eliran Novik'));
  // Trailing space or a different case is the same person, so it is the same colour.
  assert.equal(uploaderAvatarGradient('Eliran Novik'), uploaderAvatarGradient('  eliran novik '));
});

test('a list of people is not all one colour', () => {
  const names = [
    'Eliran Novik',
    'Hava Levi',
    'Anna Cohen',
    'Anna Cohn',
    'David Mizrahi',
    'Sarah Friedman',
    'Noa Shapiro',
    'Yosef Katz',
  ];
  const used = new Set(names.map(uploaderAvatarGradient));
  assert.ok(used.size >= 5, `expected spread colours, got ${used.size}`);
});

test('every name lands on a real gradient', () => {
  for (const name of ['', ' ', '?', 'A', 'portal-client', 'Иван Петров']) {
    const gradient = uploaderAvatarGradient(name);
    assert.match(gradient, /^from-[a-z]+-\d00 to-[a-z]+-\d00$/);
  }
});

test('initials still come from the first and last word', () => {
  assert.equal(initialsFromUploaderName('Eliran Novik'), 'EN');
  assert.equal(initialsFromUploaderName('madonna'), 'MA');
});
