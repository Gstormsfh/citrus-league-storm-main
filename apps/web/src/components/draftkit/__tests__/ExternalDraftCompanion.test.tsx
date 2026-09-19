import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),native:false,user:{id:'buyer'} as {id:string}|null}));
vi.mock('@/api/client',()=>({apiClient:{get:mocks.get,post:mocks.post}}));
vi.mock('@/api/imports',()=>({importApi:{}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('@/lib/nativeAuth',()=>({isNativeShell:()=>mocks.native}));
vi.mock('../ConnectedDraftDesk',()=>({DraftDeskPanel:({live}:any)=><div data-testid="desk">{live.status}:{[...live.unavailableIds].join(',')}</div>}));
import ExternalDraftCompanion from '../ExternalDraftCompanion';
import {deskFixture} from './deskFixture';
const snapshot=(ids=['8478402'])=>({platform:'espn',leagueId:'777',season:2026,status:'in_progress',receivedAt:'2026-09-19T08:00:00Z',revision:'c'.repeat(64),complete:true,unavailableIds:ids,unresolved:[],weights:deskFixture().kit.weights});
async function open(){render(<ExternalDraftCompanion/>);await act(async()=>{});fireEvent.change(screen.getByLabelText('ESPN league link or ID'),{target:{value:'777'}});await act(async()=>{fireEvent.click(screen.getByText('Open draft companion'));});}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T08:00:00Z'));vi.clearAllMocks();mocks.native=false;mocks.user={id:'buyer'};vi.spyOn(document,'hidden','get').mockReturnValue(false);mocks.get.mockResolvedValue({data:{yahoo:false,espn:true}});mocks.post.mockImplementation(async(path:string)=>({data:path.endsWith('/open')?{file:deskFixture(),snapshot:snapshot(),warning:null}:snapshot()}));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
describe('external companion connection lifecycle',()=>{
  it('is absent from native and does not request capabilities',()=>{mocks.native=true;render(<ExternalDraftCompanion/>);expect(mocks.get).not.toHaveBeenCalled();});
  it('does not offer integrations when both server gates are disabled',async()=>{mocks.get.mockResolvedValue({data:{yahoo:false,espn:false}});render(<ExternalDraftCompanion/>);await act(async()=>{});expect(screen.queryByText('Open draft companion')).toBeNull();});
  it('automatically refreshes picks and reverses availability on a confirmed undo',async()=>{await open();expect(screen.getByTestId('desk').textContent).toBe('live:8478402');mocks.post.mockResolvedValueOnce({data:snapshot([])});await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(screen.getByTestId('desk').textContent).toBe('live:');});
  it('provides a safe host-league return path without credentials in the URL',async()=>{
    await open();const link=screen.getByRole('link',{name:'Open ESPN league ↗'});
    expect(link.getAttribute('href')).toBe('https://fantasy.espn.com/hockey/league?leagueId=777&seasonId=2027');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText(/not your host’s autopick queue/)).toBeTruthy();
  });
  it.each(['waiting','unknown'])('does not label a %s source as a live draft',async status=>{
    mocks.post.mockResolvedValueOnce({data:{file:deskFixture(),snapshot:{...snapshot(),status},warning:null}});
    await open();expect(screen.getByTestId('desk').textContent).toBe('waiting:8478402');
  });
  it('retains prior picks and marks the board stale on failure or an incomplete mapping',async()=>{await open();mocks.post.mockRejectedValueOnce(Error('Source unavailable'));await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(screen.getByTestId('desk').textContent).toBe('disconnected:8478402');mocks.post.mockResolvedValueOnce({data:{...snapshot([]),complete:false,unresolved:['unknown']}});await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(screen.getByTestId('desk').textContent).toBe('disconnected:8478402');});
  it('does not apply a reply belonging to a different league',async()=>{await open();mocks.post.mockResolvedValueOnce({data:{...snapshot([]),leagueId:'999'}});await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});expect(screen.getByTestId('desk').textContent).toBe('disconnected:8478402');});
  it('pauses hidden tabs and refreshes on return',async()=>{await open();vi.spyOn(document,'hidden','get').mockReturnValue(true);await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(60000);});expect(mocks.post).toHaveBeenCalledTimes(1);expect(screen.getByTestId('desk').textContent).toContain('disconnected');vi.spyOn(document,'hidden','get').mockReturnValue(false);await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});expect(mocks.post).toHaveBeenCalledTimes(2);});
  it('warns before disconnecting unsaved external-draft preparation',async()=>{await open();fireEvent.click(screen.getByText('Disconnect companion'));expect(screen.getByText(/Download a progress backup/)).toBeTruthy();expect(screen.getByTestId('desk')).toBeTruthy();fireEvent.click(screen.getByText('Disconnect and clear this tab'));expect(screen.queryByTestId('desk')).toBeNull();await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(mocks.post).toHaveBeenCalledTimes(1);});
  it('clears a previous buyer’s board on account change',async()=>{const view=render(<ExternalDraftCompanion/>);await act(async()=>{});fireEvent.change(screen.getByLabelText('ESPN league link or ID'),{target:{value:'777'}});await act(async()=>{fireEvent.click(screen.getByText('Open draft companion'));});mocks.user={id:'another-user'};view.rerender(<ExternalDraftCompanion/>);await act(async()=>{});expect(screen.queryByTestId('desk')).toBeNull();});
});
