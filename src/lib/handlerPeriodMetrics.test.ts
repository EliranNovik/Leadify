import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarMonthsSpanned,
  contributionTone,
  costSharePctTone,
  handlerContributionTargetNis,
  handlerPeriodCostNis,
  receivedCountTone,
} from './handlerPeriodMetrics';

test('received cases read green from six, orange from four, red below', () => {
  assert.equal(receivedCountTone(9), 'good');
  assert.equal(receivedCountTone(6), 'good');
  assert.equal(receivedCountTone(5), 'watch');
  assert.equal(receivedCountTone(4), 'watch');
  assert.equal(receivedCountTone(3), 'bad');
  assert.equal(receivedCountTone(0), 'bad');
});

test('contribution reads against the salary with 40% on top of it', () => {
  // 18,000 of salary asks for 25,200 of contribution.
  assert.equal(contributionTone(30000, 18000), 'good');
  assert.equal(contributionTone(25200, 18000), 'good');
  assert.equal(contributionTone(23000, 18000), 'watch');
  assert.equal(contributionTone(18000, 18000), 'bad');
  assert.equal(contributionTone(12000, 18000), 'bad');
});

test('the salary share reads green to 40%, orange to 50%, red above it', () => {
  assert.equal(costSharePctTone(18), 'good');
  assert.equal(costSharePctTone(40), 'good');
  assert.equal(costSharePctTone(41), 'watch');
  assert.equal(costSharePctTone(50), 'watch');
  assert.equal(costSharePctTone(51), 'bad');
  assert.equal(costSharePctTone(240), 'bad');
});

test('the target is the cost topped up by 40%', () => {
  assert.equal(handlerContributionTargetNis(10000), 14000);
  assert.equal(handlerContributionTargetNis(0), 0);
});

test('contribution has no reading without a salary on file', () => {
  assert.equal(contributionTone(20000, 0), 'unknown');
});

test('a period covers the salary months it touches', () => {
  assert.equal(calendarMonthsSpanned({ from: '2026-11-01', to: '2026-11-30' }), 1);
  assert.equal(calendarMonthsSpanned({ from: '2026-10-04', to: '2026-11-02' }), 2);
  assert.equal(calendarMonthsSpanned({ from: '2026-09-15', to: '2026-12-01' }), 4);
});

test('a monthly cost is prorated to the period it is compared over', () => {
  const monthly = 30_440;
  assert.equal(Math.round(handlerPeriodCostNis(monthly, { from: '2026-11-01', to: '2026-11-30' })), 30_000);
  assert.equal(Math.round(handlerPeriodCostNis(monthly, { from: '2026-11-01', to: '2026-11-15' })), 15_000);
  assert.equal(handlerPeriodCostNis(0, { from: '2026-11-01', to: '2026-11-30' }), 0);
});
