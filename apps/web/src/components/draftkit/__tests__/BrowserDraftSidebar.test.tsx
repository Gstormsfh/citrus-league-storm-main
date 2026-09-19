import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {BrowserDraftSidebar} from '../BrowserDraftSidebar';
import {deskFixture} from './deskFixture';
import type {BrowserBundle} from '../browserCompanion';
vi.mock('@/hooks/useIsMobile',()=>({useIsMobile:()=>false}));
const bundle=():BrowserBundle=>({version:1,platform:'espn',file:deskFixture(),scoringVerified:false,mappings:[{externalPlayerId:'42',key:'canonical:8478402'},{externalPlayerId:'43',key:'canonical:8482116'}]});
const snapshot=(picks:any[]=[])=>({ok:true,version:1,platform:'espn',leagueId:'123',season:2026,status:'in_progress',title:'Practice',currentPick:picks.length+1,totalRounds:20,picks});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('actual docked companion tools',()=>{
 it('follows picks and undos while keeping edited notes and targets',async()=>{
  vi.useFakeTimers();let source=snapshot();const b=bundle();
  const send=vi.fn(async m=>m.type==='PANEL_READ'?{ok:true,bundle:b,snapshot:source,receivedAt:Date.now()}:{ok:true});
  await act(async()=>{render(<BrowserDraftSidebar send={send}/>);});
  fireEvent.click(screen.getByRole('button',{name:'Connor McDavid'}));
  fireEvent.change(screen.getByLabelText('Your note for Connor McDavid'),{target:{value:'Keep for my next pick'}});
  await act(async()=>{await Promise.resolve();});
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'SAVE_NOTE',key:'canonical:8478402',patch:{note:'Keep for my next pick'}}));
  source=snapshot([{externalPlayerId:'42',overallPick:1}]);await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(screen.queryByRole('button',{name:'Connor McDavid'})).not.toBeInTheDocument();
  source=snapshot();await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(screen.getByRole('button',{name:'Target: Connor McDavid'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByLabelText('Your note for Connor McDavid')).toHaveValue('Keep for my next pick');
  expect(screen.queryByRole('button',{name:/Submit pick|Draft player/i})).not.toBeInTheDocument();
 });
 it('provides real search, authored research and a two-player comparison without setup navigation',async()=>{
  const b=bundle();b.file.kit.players[0].research=[{headline:'Reviewed player story',body:'Original Citrus assessment.',date:'2024-02-07',kind:'history',sources:[{label:'Source interview',url:'https://example.com/interview'}]}];
  const send=vi.fn(async(_message:Record<string,unknown>)=>({ok:true,bundle:b,snapshot:snapshot(),receivedAt:Date.now()}));
  await act(async()=>{render(<BrowserDraftSidebar send={send}/>);});
  fireEvent.click(screen.getByRole('button',{name:'Connor McDavid'}));
  expect(screen.getByText('Original Citrus assessment.')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Source interview'})).toHaveAttribute('rel','noopener noreferrer');
  fireEvent.change(screen.getByLabelText('Find a player'),{target:{value:'stutzle'}});
  expect(screen.getByRole('button',{name:'Tim Stützle'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Connor McDavid'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Compare players'}));
  fireEvent.click(screen.getByRole('button',{name:'Compare Connor McDavid'}));fireEvent.click(screen.getByRole('button',{name:'Compare Tim Stützle'}));
  expect(within(screen.getByRole('region',{name:'Side-by-side player statistics'})).getByText('Projected FPTS')).toBeInTheDocument();
  expect(send.mock.calls.every(([m])=>m.type==='PANEL_READ')).toBe(true);
 });
 it('retains the last good board on partial or stale reads and labels scoring honestly',async()=>{
  vi.useFakeTimers();let failed=false;const send=vi.fn(async()=>failed?{ok:false,message:'Incomplete history'}:{ok:true,bundle:bundle(),snapshot:snapshot(),receivedAt:Date.now()});
  await act(async()=>{render(<BrowserDraftSidebar send={send}/>);});
  expect(screen.getByText(/Rankings and FPTS below use this kit’s scoring/)).toBeInTheDocument();
  failed=true;await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(screen.getByText('Incomplete history')).toBeInTheDocument();expect(screen.getByText(/Connection interrupted/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Connor McDavid'})).toBeInTheDocument();
 });
 it('opens setup only on an explicit click and withholds unverified boards',async()=>{
  const send=vi.fn(async()=>({ok:true,snapshot:snapshot()}));await act(async()=>{render(<BrowserDraftSidebar send={send}/>);});
  expect(send).toHaveBeenCalledTimes(1);expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Connect my Citrus kit'}));});
  expect(send).toHaveBeenCalledWith({type:'PREPARE_KIT'});
 });
});
