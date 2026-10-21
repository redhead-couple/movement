const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const [url, output, fixture] = process.argv.slice(2);
const profile = path.join(fixture, 'chrome-profile');
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--user-data-dir='+profile, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve=>setTimeout(resolve, ms));
let ws, next=0; const pending=new Map();
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;}
(async()=>{
  let port;
  for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await sleep(100);}
  assert.ok(port,'Chrome started');
  const tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
  ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(!message.id)return;const p=pending.get(message.id);pending.delete(message.id);if(p)message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);};
  await send('Page.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*://fonts.googleapis.com/*','*://fonts.gstatic.com/*']});
  await send('Page.navigate',{url});
  for(let i=0;i<200;i++){if(await evaluate("!!document.querySelector('.release-meta')"))break;await sleep(50);}
  for(const [name,width,height] of [['desktop',1400,1100],['mobile',390,1000]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(250);
    const state=await evaluate("({version:document.querySelector('.release-meta').textContent,buttons:[...document.querySelectorAll('.download-button')].map(a=>({href:a.getAttribute('href'),width:a.getBoundingClientRect().width})),overflow:document.documentElement.scrollWidth>innerWidth+1})");
    assert.match(state.version,/alpha\.8/);assert.equal(state.buttons.length,2);assert.equal(state.overflow,false);
    assert.ok(state.buttons.every(button=>button.width>100&&button.href.startsWith('/downloads/0.1.0-alpha.8/')));
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'download-'+name+'.png'),Buffer.from(shot.data,'base64'));
  }
  console.log('DOWNLOAD_PAGE_BROWSER_OK Chrome desktop/mobile version, links, layout');
  await send('Browser.close');ws.close();
})().catch(async error=>{console.error(error);try{if(ws){await send('Browser.close');ws.close();}else child.kill();}catch{}process.exitCode=1;});
