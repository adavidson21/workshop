// Pasted ADO work item links (js/ado-link.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoFromPaste, adoFromUrl, parseItemText } from '../js/ado-link.js';

test('work item URLs: cloud, on-prem, edit and board forms', () => {
  assert.deepEqual(adoFromUrl('https://dev.azure.com/acme/Platform/_workitems/edit/12345'),
    {id: 12345, url: 'https://dev.azure.com/acme/Platform/_workitems/edit/12345', project: 'Platform'});
  assert.equal(adoFromUrl('https://tfs.acme.local/tfs/DefaultCollection/My%20Project/_workitems/edit/77/').project, 'My Project');
  assert.equal(adoFromUrl('https://dev.azure.com/acme/P/_workitems?id=9').id, 9);
  assert.equal(adoFromUrl('https://dev.azure.com/acme/P/_boards/board/t/Team/Stories?workitem=42').id, 42);
  assert.equal(adoFromUrl('https://dev.azure.com/acme/P/_git/repo/pullrequest/5'), null);
  assert.equal(adoFromUrl('not a url'), null);
  assert.equal(adoFromUrl('javascript:alert(1)//_workitems/edit/1'), null);
});

test('ADO copy text: type, id and title', () => {
  assert.deepEqual(parseItemText('Issue 12345: ABC'), {type: 'Issue', id: 12345, title: 'ABC'});
  assert.deepEqual(parseItemText('User Story 7: Fix the thing: now'), {type: 'User Story', id: 7, title: 'Fix the thing: now'});
  assert.equal(parseItemText('just a task'), null);
});

test('paste from ADO Copy to clipboard keeps the text and the link', () => {
  const html = '<html><body><!--StartFragment--><a href="https://dev.azure.com/acme/Platform/_workitems/edit/12345">Issue 12345</a>: ABC<!--EndFragment--></body></html>';
  const got = adoFromPaste('Issue 12345: ABC', html);
  assert.equal(got.text, 'Issue 12345: ABC');
  assert.deepEqual(got.ado, {id: 12345, url: 'https://dev.azure.com/acme/Platform/_workitems/edit/12345', project: 'Platform', type: 'Issue', pasted: true});
});

test('paste of a bare URL gives a starter title; plain text gives nothing', () => {
  const got = adoFromPaste('https://dev.azure.com/acme/P/_workitems/edit/5', '');
  assert.equal(got.text, 'ADO 5: ');
  assert.equal(got.ado.id, 5);
  assert.equal(adoFromPaste('Buy milk', ''), null);
  assert.equal(adoFromPaste('See this', '<a href="https://example.com">x</a>'), null);
});
