import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BrowserKitHandoff} from '../BrowserKitHandoff';
import {deskFixture} from './deskFixture';
const api=vi.hoisted(()=>({post:vi.fn()}));
const native=vi.hoisted(()=>({value:false}));
vi.mock('@/api/client',()=>({apiClient:api}));
vi.mock('@/lib/nativeAuth',()=>({isNativeShell:()=>native.value}));
const id='a'.repeat(32),nonce='12345678-1234-1234-1234-123456789abc';
const bundle=()=>({version:1,platform:'espn',file:deskFixture(),scoringVerified:false,mappings:[{externalPlayerId:'42',key:'canonical:8478402'},{externalPlayerId:'43',key:'canonical:8482116'}]});
beforeEach(()=>{vi.clearAllMocks();native.value=false;window.history.replaceState({},'','/draft-kit#citrus-bridge='+id+'.'+nonce);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'','/');});
describe('purchased browser kit handoff',()=>{
 it('requires an explicit click and sends no auth or provider credentials to the extension',async()=>{
  const sendMessage=vi.fn((_id,msg,done)=>done(msg.type==='SNAPSHOT'?{ok:true,snapshot:{platform:'espn'}}:{ok:true}));
  vi.stubGlobal('chrome',{runtime:{sendMessage}});api.post.mockResolvedValue({data:{bundle:bundle(),warning:null}});
  render(<BrowserKitHandoff league=" My league " weights={{skater:{goals:'6'},goalie:{wins:'5'}}} disabled={false}/>);
  expect(sendMessage).not.toHaveBeenCalled();expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Send my kit to the draft sidebar'}));
  await screen.findByText(/Your tools are ready in the draft sidebar/);
  expect(api.post.mock.calls[0][1]).toEqual({platform:'espn',league:'My league',weights:{skater:{goals:6},goalie:{wins:5}}});
  expect(sendMessage.mock.calls.map(c=>c[1])).toEqual([{type:'SNAPSHOT',nonce},{type:'INSTALL_KIT',nonce,bundle:bundle()}]);
 });
 it('never attaches a board if server purchase or identity verification fails',async()=>{
  const sendMessage=vi.fn((_id,msg,done)=>done({ok:true,snapshot:{platform:'espn'}}));vi.stubGlobal('chrome',{runtime:{sendMessage}});
  api.post.mockRejectedValue(Error('Purchase access required.'));
  render(<BrowserKitHandoff league="Board" weights={{skater:{goals:'6'}}} disabled={false}/>);fireEvent.click(screen.getByRole('button',{name:'Send my kit to the draft sidebar'}));
  await screen.findByText('Purchase access required.');expect(sendMessage).toHaveBeenCalledTimes(1);
 });
 it('rejects incomplete mappings even if a server response is malformed',async()=>{
  const sendMessage=vi.fn((_id,msg,done)=>done({ok:true,snapshot:{platform:'espn'}}));vi.stubGlobal('chrome',{runtime:{sendMessage}});api.post.mockResolvedValue({data:{bundle:{...bundle(),mappings:[]}}});
  render(<BrowserKitHandoff league="Board" weights={{skater:{goals:'6'}}} disabled={false}/>);fireEvent.click(screen.getByRole('button',{name:'Send my kit to the draft sidebar'}));
  await screen.findByText(/Some board players/);expect(sendMessage).toHaveBeenCalledTimes(1);
 });
 it('keeps setup out of native and unpaired pages',()=>{
  native.value=true;const v=render(<BrowserKitHandoff league="Board" weights={{}} disabled={false}/>);expect(v.container).toBeEmptyDOMElement();v.unmount();native.value=false;
  window.history.replaceState({},'','/draft-kit');const unpaired=render(<BrowserKitHandoff league="Board" weights={{}} disabled={false}/>);expect(unpaired.container).toBeEmptyDOMElement();
 });
 it('respects disabled custom scoring and reports a missing extension',async()=>{
  const v=render(<BrowserKitHandoff league="Board" weights={{}} disabled/>);expect(screen.getByRole('button',{name:'Send my kit to the draft sidebar'})).toBeDisabled();v.rerender(<BrowserKitHandoff league="Board" weights={{}} disabled={false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Send my kit to the draft sidebar'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Open kit setup from the Citrus extension.'));expect(api.post).not.toHaveBeenCalled();
 });
});
