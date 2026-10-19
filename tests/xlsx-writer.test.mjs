import test from 'node:test';
import assert from 'node:assert/strict';
import { xlsx, zip } from '../src/xlsx-writer.js';
import { unzip } from '../src/people-import.js';

test('writes a valid single-sheet workbook with escaped text and a frozen, filtered header', async () => {
  const bytes = xlsx('Lunches & breaks', [['Day', 'Person'], ['Tuesday, Mar 2', 'Dana <Lee> & "Co"'], ['Wednesday, Mar 3', 'Sam']], [18, 20]);
  const files = await unzip(bytes.buffer, () => true);
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Day<\/t>/);
  assert.match(sheet, /Dana &lt;Lee&gt; &amp; &quot;Co&quot;/);
  assert.match(sheet, /<autoFilter ref="A1:B3"\/>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(files['xl/workbook.xml'], /<sheet name="Lunches &amp; breaks"/);
});

test('zip entries carry correct CRC-32 checksums', () => {
  const out = zip([['a.txt', 'hello']]);
  const view = new DataView(out.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0x3610a686, 'CRC-32 of "hello"');
});
