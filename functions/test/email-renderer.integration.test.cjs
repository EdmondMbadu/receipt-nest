const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib');
const {buildEmailHtml}=require('../lib/email-content');
const {freezeEmailAssets,renderEmailPdf,closeEmailBrowser}=require('../lib/email-renderer');
const {source}=require('./fixtures/forwarded-transfer.cjs');

test('Chromium renders every page, the correct total, Unicode and the final footer with selectable text',{
  skip:process.env.RUN_EMAIL_PDF_TEST!=='1',timeout:60000,
},async()=>{
  try{
    const {getDocument}=await import('../../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const frozen=await freezeEmailAssets(buildEmailHtml(source));
    const started=performance.now();
    const bytes=await renderEmailPdf(frozen.html);
    const firstMs=Math.round(performance.now()-started);
    assert.equal(frozen.missingAssets,0);
    const doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>1);
    const textDoc=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
    const pages=[];
    for(let i=1;i<=textDoc.numPages;i++){
      const page=await textDoc.getPage(i);const text=await page.getTextContent();
      pages.push(text.items.map(item=>item.str).join(' '));
    }
    const text=pages.join(' ');
    assert.match(text,/670\.99 USD/);assert.match(text,/70\.99 USD/);assert.match(text,/11-07-2026/);
    assert.match(text,/café/);assert.match(text,/final footer retained/);assert.match(text,/Test terms section 70\./);
    await textDoc.destroy();
    const warmStart=performance.now();await renderEmailPdf(frozen.html);
    console.log(JSON.stringify({pages:pages.length,bytes:bytes.length,firstRenderMs:firstMs,warmRenderMs:Math.round(performance.now()-warmStart)}));
  }finally{await closeEmailBrowser();}
});
