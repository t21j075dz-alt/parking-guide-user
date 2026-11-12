// 外部通信は遮断。端末内のテストデータだけを操作する。
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{try{let file=path.join(root,new URL(req.url,'http://localhost').pathname);if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  const errors=[];
  for(const width of [390,1440]) {
   const page=await browser.newPage({viewport:{width,height:844}});
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://**/*',r=>r.abort());
   await page.goto('http://127.0.0.1:'+server.address().port);

   await page.locator('#launch-screen').waitFor({state:'detached'});
   assert.equal(await page.locator('.progress').count(),0);
   for(const screenName of ['facility','condition']) {
    await page.evaluate(name=>showScreen(name),screenName);
    assert.equal(await page.locator('#location-settings').isVisible(),false,
      'screen '+screenName+': location settings must not show without opening the menu');
    assert.equal(await page.locator('.location-panel').isVisible(),false,
      'screen '+screenName+': current location card must be hidden');
   }
   await page.locator('.display-menu > summary').click();
   assert.equal(await page.locator('#location-settings').isVisible(),true);
   assert.equal(await page.locator('.location-panel').isVisible(),false);
   await page.locator('#location-settings > summary').click();
   assert.equal(await page.locator('.location-panel').isVisible(),true,
     'location controls must remain available by explicit choice');
   await page.locator('.display-menu > summary').click();
   await page.evaluate(()=>{
    showScreen('result');
    document.querySelector('#result-content').hidden=false;
    document.querySelector('#space-number').textContent='B-12';
    publishGuidanceTranscript('B-12番へ進んでください。','音声OFF・文章で確認');
   });
   const number=await page.locator('#space-number').boundingBox();
   assert.ok(number.y>=0 && number.y+number.height<500,
      'number visible without scrolling: '+JSON.stringify({
        width, number,
        result: await page.locator('#result-screen').boundingBox(),
        status: await page.locator('#search-status').boundingBox(),
        hero: await page.locator('#result-screen .result-summary').boundingBox(),
        errors,
      }));
   assert.equal(await page.locator('#result-content .guidance-audio-message').textContent(),'B-12番へ進んでください。');
   await page.screenshot({path:'/tmp/user-guidance-'+width+'.png'});
   await page.evaluate(()=>{
    document.querySelector('#result-content').hidden=true;
    document.querySelector('#no-space-content').hidden=false;
    publishGuidanceTranscript('空き区画がありません。','音声OFF');
   });
   assert.equal(await page.locator('#no-space-content .guidance-audio-message').isVisible(),true);
   await page.evaluate(()=>showScreen('condition'));
   assert.equal(await page.locator('#result-content .guidance-audio-message').textContent(),'');
   await page.locator('.display-menu > summary').click();
   await page.locator('#theme-button').click();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');

   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'horizontal overflow');
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: UI refinement desktop and mobile');
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
