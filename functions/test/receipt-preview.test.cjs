const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadReceiptPreview, loadReceiptSourceBundlePreview } = require('../lib/receipt-preview');

function bucket(files) {
  const reads = [];
  return { name:'receipt-nest.firebasestorage.app', reads, file(path) {
    reads.push(path);
    return {
      async getMetadata() {
        if (!files[path]) throw Object.assign(new Error('not found'), {code:404});
        return [{size:100, ...files[path].metadata}];
      },
      async download() { return [files[path].bytes || Buffer.from('receipt bytes')]; },
    };
  }};
}
const path = 'users/owner/receipts/photo.png';

test('source bundle previews use the stored original while keeping the individual receipt separate', async () => {
  const original='users/owner/receipts/original.pdf';
  const storage=bucket({[original]:{metadata:{contentType:'application/pdf',metadata:{firebaseStorageDownloadTokens:'original-token'}}}});
  const result=await loadReceiptSourceBundlePreview({file:{storagePath:path},sourceBundle:{storagePath:original}},'owner',storage);
  assert.match(result.originalUrl,/original\.pdf\?alt=media&token=original-token$/);
  assert.equal(result.pdfUrl,result.originalUrl);assert.deepEqual(storage.reads,[original]);
});
test('a source bundle cannot expose another owner’s file or an arbitrary external URL', async () => {
  for(const unsafe of ['users/other/receipts/original.pdf','https://example.com/original.pdf','users/owner/receipts/../secret']) {
    const storage=bucket({});
    const result=await loadReceiptSourceBundlePreview({sourceBundle:{storagePath:unsafe}},'owner',storage);
    assert.deepEqual(storage.reads,[]);assert.equal(result.originalUrl,'');
  }
});

test('authorized admin previews use an existing token without client storage metadata access', async () => {
  const storage=bucket({[path]:{metadata:{contentType:'image/png',metadata:{firebaseStorageDownloadTokens:'existing-token,old-token'}}}});
  const result=await loadReceiptPreview({file:{storagePath:path}},'owner',storage);
  assert.match(result.imageUrl,/alt=media&token=existing-token$/);
  assert.equal(result.originalUrl,result.imageUrl); assert.equal(result.error,'');
});
test('files ingested without a download token can be viewed without making the object public', async () => {
  const bytes=Buffer.from('private receipt');
  const storage=bucket({[path]:{metadata:{contentType:'image/png'},bytes}});
  const result=await loadReceiptPreview({file:{storagePath:path}},'owner',storage);
  assert.equal(result.imageUrl,`data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(result.originalUrl,result.imageUrl);
});
test('a missing original never hides a usable email preview', async () => {
  const preview='users/owner/receipts/email-preview.png';
  const storage=bucket({[preview]:{metadata:{contentType:'image/png'}}});
  const result=await loadReceiptPreview({file:{storagePath:path},email:{previewStoragePath:preview}},'owner',storage);
  assert.match(result.imageUrl,/^data:image\/png/);assert.equal(result.error,'');
});
test('PDFs and historical generic mime types get the correct preview', async () => {
  const pdf='users/owner/receipts/receipt.pdf';
  const storage=bucket({[pdf]:{metadata:{contentType:'application/octet-stream'}}});
  const result=await loadReceiptPreview({file:{storagePath:pdf}},'owner',storage);
  assert.match(result.pdfUrl,/^data:application\/pdf/);assert.equal(result.imageUrl,'');
});
test('foreign, nested and traversal paths are rejected before touching storage', async () => {
  for(const unsafe of ['users/other/receipts/photo.png','users/owner/receipts/../secret','users/owner/receipts/..','https://example.com/photo.png']) {
    const storage=bucket({});
    const result=await loadReceiptPreview({file:{storagePath:unsafe}},'owner',storage);
    assert.deepEqual(storage.reads,[]);assert.equal(result.imageUrl,'');assert.match(result.error,/No original file/);
  }
});
test('missing and oversized files remain recoverable by manual entry', async () => {
  const missing=await loadReceiptPreview({file:{storagePath:path}},'owner',bucket({}));
  assert.match(missing.error,/missing from storage.*enter and save/);
  const large=await loadReceiptPreview({file:{storagePath:path}},'owner',bucket({[path]:{metadata:{size:11*1024*1024,contentType:'image/png'}}}));
  assert.equal(large.imageUrl,'');assert.match(large.error,/enter and save/);
});
