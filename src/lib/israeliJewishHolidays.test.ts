import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYearHolidaysFromItems, type HebcalItem } from './israeliJewishHolidays';

/**
 * Trimmed from the live Hebcal response for 2026
 * (hebcal.com/hebcal/?v=1&cfg=json&year=2026&i=on&maj=on&min=on&mod=on&nx=on&mf=on&ss=on),
 * keeping one item per subcat plus every statutory day off.
 */
const ITEMS_2026: HebcalItem[] = [
  // The eight days Hebcal flags as yomtov — work prohibited.
  { date: '2026-04-02', title: 'Pesach I', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-04-08', title: 'Pesach VII', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-05-22', title: 'Shavuot', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-09-12', title: 'Rosh Hashana 5787', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-09-13', title: 'Rosh Hashana II', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-09-21', title: 'Yom Kippur', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-09-26', title: 'Sukkot I', category: 'holiday', subcat: 'major', yomtov: true },
  { date: '2026-10-03', title: 'Shmini Atzeret', category: 'holiday', subcat: 'major', yomtov: true },

  // A national day off rather than a yomtov, so it carries no yomtov flag.
  { date: '2026-04-22', title: 'Yom HaAtzma’ut', category: 'holiday', subcat: 'modern' },

  // Working days that must never reach the premium map.
  { date: '2026-08-13', title: 'Rosh Chodesh Elul', category: 'roshchodesh' },
  { date: '2026-08-14', title: 'Rosh Hashana LaBehemot', category: 'holiday', subcat: 'minor' },
  { date: '2026-08-14', title: 'Rosh Chodesh Elul', category: 'roshchodesh' },
  { date: '2026-04-21', title: 'Yom HaZikaron', category: 'holiday', subcat: 'modern' },
  { date: '2026-04-01', title: 'Erev Pesach', category: 'holiday', subcat: 'major' },
  { date: '2026-04-03', title: 'Pesach II (CH’’M)', category: 'holiday', subcat: 'major' },
  { date: '2026-09-27', title: 'Sukkot II (CH’’M)', category: 'holiday', subcat: 'major' },
  { date: '2026-07-23', title: 'Tish’a B’Av', category: 'holiday', subcat: 'fast' },
  { date: '2026-03-03', title: 'Purim', category: 'holiday', subcat: 'minor' },
  { date: '2026-05-05', title: 'Lag BaOmer', category: 'holiday', subcat: 'minor' },
  { date: '2026-12-05', title: 'Shabbat Chanukah', category: 'holiday', subcat: 'shabbat' },

  // Filtered out before classification.
  { date: '2026-08-15', title: 'Parashat Shoftim', category: 'parashat' },
  { date: '2026-08-14', title: 'Candle lighting: 19:01', category: 'candles' },
];

test('statutory days off are exactly the nine Israeli holidays', () => {
  const { premium } = buildYearHolidaysFromItems(ITEMS_2026);

  assert.deepEqual([...premium.keys()].sort(), [
    '2026-04-02', // Pesach I
    '2026-04-08', // Pesach VII
    '2026-04-22', // Yom HaAtzmaut
    '2026-05-22', // Shavuot
    '2026-09-12', // Rosh Hashana I
    '2026-09-13', // Rosh Hashana II
    '2026-09-21', // Yom Kippur
    '2026-09-26', // Sukkot I
    '2026-10-03', // Shmini Atzeret
  ]);
});

test('Rosh Hashana LaBehemot is a working day, not a 150% holiday', () => {
  const { all, premium } = buildYearHolidaysFromItems(ITEMS_2026);

  // It stays visible as a label, which is why a title substring match caught it.
  assert.ok(all.get('2026-08-14')?.includes('Rosh Hashana LaBehemot'));
  assert.equal(premium.has('2026-08-14'), false);

  // The day before a premium holiday is treated as off, so 13 Aug must stay clear too.
  assert.equal(premium.has('2026-08-13'), false);
});

test('Yom HaAtzmaut is recognised despite the curly apostrophe', () => {
  const variants: HebcalItem[] = [
    { date: '2026-04-22', title: 'Yom HaAtzma’ut', category: 'holiday', subcat: 'modern' },
    { date: '2027-05-12', title: "Yom HaAtzma'ut", category: 'holiday', subcat: 'modern' },
    { date: '2028-05-02', title: 'Yom HaAtzmaut', category: 'holiday', subcat: 'modern' },
    { date: '2029-04-19', title: 'Independence Day', category: 'holiday', subcat: 'modern' },
  ];

  for (const item of variants) {
    const { premium } = buildYearHolidaysFromItems([item]);
    assert.ok(premium.has(item.date!), `${item.title} should be a statutory day off`);
  }
});

test('Rosh Chodesh, minor holidays, fasts, eves and Chol HaMoed are working days', () => {
  const { all, premium } = buildYearHolidaysFromItems(ITEMS_2026);

  for (const date of [
    '2026-04-01', // Erev Pesach
    '2026-04-03', // Pesach II (Chol HaMoed)
    '2026-04-21', // Yom HaZikaron
    '2026-07-23', // Tish'a B'Av
    '2026-03-03', // Purim
    '2026-05-05', // Lag BaOmer
    '2026-12-05', // Shabbat Chanukah
  ]) {
    assert.ok(all.has(date), `${date} should still be listed as a holiday label`);
    assert.equal(premium.has(date), false, `${date} must not be a 150% holiday`);
  }
});

test('parashat and candle-lighting entries are dropped entirely', () => {
  const { all } = buildYearHolidaysFromItems(ITEMS_2026);

  assert.equal(all.has('2026-08-15'), false);
  assert.equal(all.get('2026-08-14')?.some((name) => name.startsWith('Candle')), false);
});
