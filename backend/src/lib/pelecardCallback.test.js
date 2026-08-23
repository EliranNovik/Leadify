const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeCallbackData,
  isSuccessfulOpenFinanceStatus,
  isPendingOpenFinanceCallback,
} = require('./pelecardCallback');
const pelecardService = require('../services/pelecardService');

const openFinancePayload = {
  StatusCode: '665',
  ErrorMessage: 'RCVD - Payment initiation has been received by the receiving agent.',
  ResultData: {
    TransactionId: 'e83c5ad5-d6bf-4dbe-aa9e-c70499358925',
    ShvaResult: '665',
    AdditionalDetailsParamX: 'pms4wo4vs0lv64k',
    TransactionPelecardId: '3024568861',
  },
  OpenFinanceData: {
    BankTransferStatus: 'RCVD',
    BankTransferDescription: 'unknown',
    BankTransferID: '01KYMWGJADHWF7CVZP8GS9X5EH',
  },
};

test('recovers identity from truncated Pelecard JSON field name', () => {
  const truncated =
    '{"StatusCode":"133","ErrorMessage":"card not valid according to Isracard list.","ResultData":{"TransactionId":"c7532747-e40b-4394-a79a-be4298fa1717","ShvaResult":"141","AdditionalDetailsParamX":"L214731-211469","TransactionPelecardId":"3065414758","Cavv":"AKPLFJHSy5BVAp2EVuwaAoABFA';
  const data = mergeCallbackData({
    query: {},
    body: { [truncated]: '' },
  });

  assert.equal(data.StatusCode, '133');
  assert.equal(data.AdditionalDetailsParamX, 'L214731-211469');
  assert.equal(data.TransactionId, 'c7532747-e40b-4394-a79a-be4298fa1717');
  assert.equal(data.TransactionPelecardId, '3065414758');
  assert.equal(data.ShvaResult, '141');
});

test('parses JSON sent as the sole URL-encoded field name', () => {
  const raw = JSON.stringify(openFinancePayload);
  const data = mergeCallbackData({
    query: {},
    body: { [raw]: '' },
  });

  assert.equal(data.StatusCode, '665');
  assert.equal(data.AdditionalDetailsParamX, 'pms4wo4vs0lv64k');
  assert.equal(data.TransactionId, 'e83c5ad5-d6bf-4dbe-aa9e-c70499358925');
  assert.equal(data.TransactionPelecardId, '3024568861');
  assert.equal(data.BankTransferStatus, 'RCVD');
  assert.equal(data.BankTransferID, '01KYMWGJADHWF7CVZP8GS9X5EH');
  assert.equal(Object.prototype.hasOwnProperty.call(data, raw), false);
});

test('recognizes Pelecard 665 / RCVD as pending, not declined', () => {
  const data = mergeCallbackData({ body: openFinancePayload, query: {} });
  assert.equal(isPendingOpenFinanceCallback(data), true);
});

test('does not treat a normal card decline as pending Open Finance', () => {
  assert.equal(
    isPendingOpenFinanceCallback({
      StatusCode: '039',
      ErrorMessage: 'Declined',
    }),
    false,
  );
});

test('keeps RCVD intermediate even when Pelecard displays the transaction', () => {
  assert.equal(isSuccessfulOpenFinanceStatus({ BankTransferStatus: 'RCVD' }), false);
  assert.equal(
    pelecardService.isSuccessfulStatus('665', {
      OpenFinanceData: { BankTransferStatus: 'RCVD' },
    }),
    false,
  );
});

test('recognizes documented final Open Finance statuses as successful', () => {
  for (const status of ['ACCC', 'ACSC', 'ACSP', 'ACTC', 'ACWC', 'ACFC']) {
    assert.equal(isSuccessfulOpenFinanceStatus({ BankTransferStatus: status }), true);
    assert.equal(
      pelecardService.isSuccessfulStatus('665', {
        OpenFinanceData: { BankTransferStatus: status },
      }),
      true,
    );
  }
});
