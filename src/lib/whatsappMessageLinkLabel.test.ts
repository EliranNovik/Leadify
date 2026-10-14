import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WHATSAPP_CONTRACT_LINK_LABEL,
  WHATSAPP_GENERIC_LINK_LABEL,
  WHATSAPP_MEETING_LINK_LABEL,
  WHATSAPP_PAYMENT_LINK_LABEL,
  WHATSAPP_PROFORMA_LINK_LABEL,
  whatsAppMessageLinkLabel,
} from './whatsappMessageLinkLabel';

const ORIGIN = 'https://crm.lawoffice.org.il';
const TOKEN = '8f1c3d7a-4b2e-4c19-9a76-2d5e0b8c1f34';

test('a payment page is called a payment link, not a meeting', () => {
  // The exact complaint: these are 60+ characters, so the old length rule called them meetings.
  const href = `${ORIGIN}/payment/${TOKEN}`;
  assert.ok(href.length > 50, 'fixture should be long enough to hit the old rule');
  assert.equal(whatsAppMessageLinkLabel(href, href), WHATSAPP_PAYMENT_LINK_LABEL);
});

test('each public contract route is called a contract link', () => {
  for (const route of [
    'public-contract',
    'public-legacy-contract',
    'public-firm-contract',
    'public-hr-contract',
    'public-recruitment-contract',
  ]) {
    const href = `${ORIGIN}/${route}/4821/${TOKEN}`;
    assert.equal(whatsAppMessageLinkLabel(href, href), WHATSAPP_CONTRACT_LINK_LABEL, route);
  }
});

test('both proforma routes are called a proforma link', () => {
  for (const route of ['public-proforma', 'public-proforma-legacy']) {
    const href = `${ORIGIN}/${route}/3540/${TOKEN}`;
    assert.equal(whatsAppMessageLinkLabel(href, href), WHATSAPP_PROFORMA_LINK_LABEL, route);
  }
});

test('a proforma is not mistaken for a payment page', () => {
  // Both are money documents on neighbouring routes, but only one of them takes a card.
  const proforma = `${ORIGIN}/public-proforma/3540/${TOKEN}`;
  assert.equal(whatsAppMessageLinkLabel(proforma, proforma), WHATSAPP_PROFORMA_LINK_LABEL);
});

test('online meetings and our own booking page are called meeting links', () => {
  const hrefs = [
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d',
    'https://us02web.zoom.us/j/81234567890?pwd=aBcDeFgHiJkLmNoPqRsTuVwXyZ',
    'https://meet.google.com/abc-defg-hij',
    `${ORIGIN}/book/${TOKEN}`,
  ];
  for (const href of hrefs) {
    assert.equal(whatsAppMessageLinkLabel(href, href), WHATSAPP_MEETING_LINK_LABEL, href);
  }
});

test('a long link of no known kind is called a link rather than a meeting', () => {
  const href = `https://files.example.com/download/${TOKEN}/annual-statement-2026.pdf`;
  assert.ok(href.length > 50);
  assert.equal(whatsAppMessageLinkLabel(href, href), WHATSAPP_GENERIC_LINK_LABEL);
});

test('a short ordinary link is left readable', () => {
  assert.equal(whatsAppMessageLinkLabel('https://lawoffice.org.il', 'https://lawoffice.org.il'), null);
});

test('email addresses are never relabelled', () => {
  // A client may want to copy these, and they are short enough to read in place.
  assert.equal(whatsAppMessageLinkLabel('mailto:nurit@lawoffice.org.il', 'nurit@lawoffice.org.il'), null);
});

test('length is judged on what the message showed, not the href a scheme was added to', () => {
  const shown = 'crm.lawoffice.org.il/some/rather/long/path/that/goes/on/and/on';
  assert.ok(shown.length > 50);
  assert.equal(whatsAppMessageLinkLabel(`https://${shown}`, shown), WHATSAPP_GENERIC_LINK_LABEL);
});

test('a missing display text falls back to measuring the href', () => {
  const href = `https://files.example.com/download/${TOKEN}/statement.pdf`;
  assert.equal(whatsAppMessageLinkLabel(href), WHATSAPP_GENERIC_LINK_LABEL);
});

test('the four labels are distinct, so none collapses into another', () => {
  const labels = [
    WHATSAPP_MEETING_LINK_LABEL,
    WHATSAPP_CONTRACT_LINK_LABEL,
    WHATSAPP_PAYMENT_LINK_LABEL,
    WHATSAPP_PROFORMA_LINK_LABEL,
  ];
  assert.equal(new Set(labels).size, labels.length);
});
