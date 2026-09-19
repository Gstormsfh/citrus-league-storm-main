import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {BrowserLeagueSettingsHandoff} from '../BrowserLeagueSettingsHandoff';

const native=vi.hoisted(()=>({value:false}));
vi.mock('@/lib/nativeAuth',()=>({isNativeShell:()=>native.value}));
const extensionId='a'.repeat(32),nonce='12345678-1234-1234-1234-123456789abc';
const capture=()=>({ok:true,version:1,kind:'league-settings',platform:'espn',leagueId:'609963081',season:2026,name:'Practice league',scoringType:'Head to Head Points',teamCount:4,capturedAt:'2026-09-19T12:00:00Z',roster:[{label:'F',count:9},{label:'D',count:5},{label:'G',count:2},{label:'BE',count:5}],scoring:[{group:'skater',label:'Goals (G)',value:2},{group:'goalie',label:'Goals Against (GA)',value:-2}],settings:[{label:'Draft Type',value:'Snake'}],coverage:{settings:true,rosters:false,history:false,keepers:false}});

beforeEach(()=>{native.value=false;window.history.replaceState({},'','/create-league#citrus-bridge='+extensionId+'.'+nonce);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'','/');});

describe('browser settings handoff',()=>{
  it('reads only on request and applies only after explicit review',async()=>{
    const onApply=vi.fn(),sendMessage=vi.fn((_id,_message,done)=>done({ok:true,settings:capture()}));
    vi.stubGlobal('chrome',{runtime:{sendMessage}});
    render(<BrowserLeagueSettingsHandoff onApply={onApply}/>);
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Review captured settings'}));
    const apply=await screen.findByRole('button',{name:'Apply reviewed settings to form'});
    expect(sendMessage.mock.calls[0].slice(0,2)).toEqual([extensionId,{type:'LEAGUE_SETTINGS',nonce}]);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].rosterSlots.F).toBe(9);
    expect(screen.getByRole('status')).toHaveTextContent('Review the remaining form');
  });

  it('removes a previous review when a refreshed capture fails',async()=>{
    let valid=true;
    vi.stubGlobal('chrome',{runtime:{sendMessage:(_id:string,_message:unknown,done:(r:unknown)=>void)=>done(valid?{ok:true,settings:capture()}:{ok:false,message:'Draft source is closed.'})}});
    const onApply=vi.fn();render(<BrowserLeagueSettingsHandoff onApply={onApply}/>);
    fireEvent.click(screen.getByRole('button',{name:'Review captured settings'}));
    await screen.findByRole('button',{name:'Apply reviewed settings to form'});
    valid=false;fireEvent.click(screen.getByRole('button',{name:'Review captured settings'}));
    await screen.findByText('Draft source is closed.');
    expect(screen.queryByRole('button',{name:'Apply reviewed settings to form'})).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not offer to apply unsupported scoring',async()=>{
    const settings=capture();settings.scoring.push({group:'goalie',label:'Overtime Losses (OTL)',value:1});
    vi.stubGlobal('chrome',{runtime:{sendMessage:(_id:string,_message:unknown,done:(r:unknown)=>void)=>done({ok:true,settings})}});
    render(<BrowserLeagueSettingsHandoff onApply={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Review captured settings'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('OTL');
    expect(screen.queryByRole('button',{name:'Apply reviewed settings to form'})).not.toBeInTheDocument();
  });

  it('stays out of native and rejects malformed pairing fragments',()=>{
    native.value=true;const view=render(<BrowserLeagueSettingsHandoff onApply={vi.fn()}/>);
    expect(view.container).toBeEmptyDOMElement();view.unmount();native.value=false;
    window.history.replaceState({},'','/create-league#citrus-bridge='+extensionId+'.'+'-'.repeat(36));
    expect(render(<BrowserLeagueSettingsHandoff onApply={vi.fn()}/>).container).toBeEmptyDOMElement();
  });
});
