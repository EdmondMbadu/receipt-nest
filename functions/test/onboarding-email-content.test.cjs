const assert=require('node:assert/strict');
const {test}=require('node:test');
const {buildWelcomeEmailContent}=require('../lib/welcome-email-content');
const {buildOnboardingEmailHtml,buildFirstReceiptReminder,getOnboardingEmailAttachments}=require('../lib/onboarding-email-content');
const {appendEmailSocialHtml}=require('../lib/email-social-links');
const {buildUnsubscribeUrls}=require('../lib/email-suppression');
const {buildOnboardingEmailMessage}=require('../lib/onboarding-email-message');
const base='https://receipt-nest.com';

test('calm welcome and reminder parse cleanly, retain all destinations, and resolve embedded brand images',async()=>{
  const {parse}=await import('parse5');
  const content=buildWelcomeEmailContent(base+'/');
  const welcome=buildOnboardingEmailHtml({...content,title:'Welcome to ReceiptNest.',baseUrl:base});
  const urls=buildUnsubscribeUrls('preview@example.com',base,'local-secret');
  const reminder=buildFirstReceiptReminder(base+'/', 'Edmond <script> & "Test"',urls.pageUrl);
  const walk=(node,result=[])=>{if(node.tagName)result.push(node);for(const child of node.childNodes||[])walk(child,result);return result;};
  const attr=(node,key)=>node.attrs?.find(a=>a.name===key)?.value;
  const shortcut=buildOnboardingEmailMessage('receipt-shortcut',base,'Edmond <script> & "Test"',urls.pageUrl);
  const help=buildOnboardingEmailMessage('receipt-help',base,'Edmond <script> & "Test"',urls.pageUrl);
  for(const [html,primary] of [[welcome,base+'/app?addReceipt=1'],[reminder.html,base+'/app?addReceipt=1'],[shortcut.html,base+'/app?addReceipt=1'],[help.html,base+'/support']]){
    const errors=[];const nodes=walk(parse(html,{onParseError:e=>errors.push(e.code)}));
    assert.deepEqual(errors,[]);assert.equal(nodes.filter(n=>n.tagName==='h1').length,1);
    assert.equal(nodes.filter(n=>n.tagName==='script').length,0);
    assert.equal((html.match(/id="receiptnest-social-footer"/g)||[]).length,1);
    assert.equal(appendEmailSocialHtml(html),html);
    assert.doesNotMatch(html,/gradient\(|box-shadow|display:flex|display:grid|<svg/);
    assert.ok(Buffer.byteLength(html)<30_000);
    const hrefs=nodes.filter(n=>n.tagName==='a').map(n=>attr(n,'href'));
    for(const url of [primary,base+'/getting-started#walkthrough',base+'/support',base+'/app?settings=notifications'])assert.ok(hrefs.includes(url),url);
    for(const href of hrefs)assert.equal(new URL(href).protocol,'https:');
    for(const image of nodes.filter(n=>n.tagName==='img'))if(attr(image,'src').startsWith('cid:'))assert.ok(getOnboardingEmailAttachments().some(a=>'cid:'+a.contentId===attr(image,'src')));
  }
  assert.match(reminder.html,/Edmond &lt;script&gt; &amp; &quot;Test&quot;/);
  assert.ok(reminder.html.includes(urls.pageUrl));
  assert.equal((welcome.match(/href="https:\/\/receipt-nest.com\/getting-started#walkthrough"/g)||[]).length,2);
  assert.match(content.text,/Snap a receipt or upload a photo or PDF/);
  assert.match(reminder.text,/Watch the 85-second walkthrough/);
  for(const message of [shortcut,help]){
    assert.match(message.html,/Edmond &lt;script&gt; &amp; &quot;Test&quot;/);
    assert.ok(message.html.includes(urls.pageUrl));
    assert.match(message.text,/getting-started#walkthrough/);
    assert.match(message.text,/Unsubscribe from non-essential ReceiptNest emails/);
  }
  assert.match(shortcut.text,/PDF/);assert.match(shortcut.text,/forward/);
  assert.match(help.text,/last reminder/);
});
