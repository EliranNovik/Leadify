import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_PAGES, appPageLabel, appPageTitle, searchAppPages } from './appPages';

const firstPath = (query: string) => searchAppPages(query)[0]?.path;

test('an empty query returns nothing rather than every page', () => {
  assert.deepEqual(searchAppPages(''), []);
  assert.deepEqual(searchAppPages('   '), []);
});

test('an exact label wins outright', () => {
  assert.equal(firstPath('dashboard'), '/');
  assert.equal(firstPath('settings'), '/settings');
});

test('a prefix beats a mid-word match', () => {
  // "Calendar" starts with the query; "Internal Meeting Documents" only matches on path.
  assert.equal(firstPath('calend'), '/calendar');
});

test('a later word in the label is matchable', () => {
  assert.equal(firstPath('kiosk'), undefined, 'excluded routes stay out of search');
  assert.equal(firstPath('contribution'), '/reports/sales-contribution');
});

test('initials find a page', () => {
  assert.equal(firstPath('hr'), '/reports/hr-management');
});

test('keywords find a page whose label does not contain the term', () => {
  assert.equal(firstPath('payroll'), '/reports/employee-salaries');
  assert.equal(firstPath('bank of israel'), '/tools/boi-exchange-rates');
  assert.equal(firstPath('vacation'), '/reports/employee-unavailabilities');
});

test('a path fragment finds a page', () => {
  assert.equal(firstPath('retainer-handler'), '/retainer-handler-cases');
});

test('results are capped and the cap is adjustable', () => {
  assert.ok(searchAppPages('e').length <= 8);
  assert.equal(searchAppPages('e', 3).length, 3);
});

test('case and padding are ignored', () => {
  assert.equal(firstPath('  HR MaNaGeMeNt '), '/reports/hr-management');
});

test('a query matching nothing returns nothing', () => {
  assert.deepEqual(searchAppPages('zzzzqqqq'), []);
});

test('labels resolve for history display, and unknown paths do not', () => {
  assert.equal(appPageLabel('/'), 'Dashboard');
  assert.equal(appPageLabel('/reports/hr-management'), 'HR Management');
  assert.equal(appPageLabel('/clients/L231236'), null);
});

test('a history title is readable even when the path is not a registered page', () => {
  assert.equal(appPageTitle('/'), 'Dashboard');
  assert.equal(appPageTitle('/reports/hr-management'), 'HR Management');
  // Deep pages borrow their section name so the title is never a bare id.
  assert.equal(appPageTitle('/clients/L231236'), 'Clients · L231236');
  assert.equal(appPageTitle('/reports/something-new'), 'Reports · something-new');
  // Nothing to borrow from: the segment itself is the best available title.
  assert.equal(appPageTitle('/unknown-section/deep'), 'deep');
});

test('a history title never repeats the section twice', () => {
  assert.equal(appPageTitle('/clients'), 'Clients');
});

test('a history title survives malformed percent-encoding', () => {
  assert.equal(appPageTitle('/clients/%E0%A4%A'), 'Clients · %E0%A4%A');
});

test('the registry has no duplicate paths', () => {
  const paths = APP_PAGES.map((page) => page.path);
  assert.equal(new Set(paths).size, paths.length);
});

test('every registry path is absolute', () => {
  for (const page of APP_PAGES) {
    assert.ok(page.path.startsWith('/'), `${page.path} should start with /`);
  }
});
