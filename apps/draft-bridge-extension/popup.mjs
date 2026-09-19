const button=document.querySelector('#connect'),status=document.querySelector('#status');
button.addEventListener('click',async()=>{
  button.disabled=true;status.textContent='Checking the displayed draft…';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const result=await chrome.runtime.sendMessage({type:'START',tabId:tab?.id});
    status.textContent=result?.ok?'Connected. Your Citrus review tab is open.':result?.message??'Could not connect this tab.';
  }catch{status.textContent='Connection failed. Open the ESPN draft room and try again.';}
  finally{button.disabled=false;}
});
