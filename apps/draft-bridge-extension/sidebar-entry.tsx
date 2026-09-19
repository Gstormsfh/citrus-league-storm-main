import {createRoot} from 'react-dom/client';
import {BrowserDraftSidebar} from '../web/src/components/draftkit/BrowserDraftSidebar';
declare const chrome:any;
const send=(message:Record<string,unknown>)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Connection timed out. Last confirmed picks are retained.')),5000);
  chrome.runtime.sendMessage(message,(reply:any)=>{
    clearTimeout(timer);
    if(chrome.runtime.lastError)reject(Error('Reconnect using the Citrus toolbar button.'));
    else resolve(reply);
  });
});
createRoot(document.getElementById('root')!).render(<BrowserDraftSidebar send={send}/>);
