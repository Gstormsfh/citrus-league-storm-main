import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { DraftKitDownloads } from '../DraftKitDownloads';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
const platform=vi.hoisted(()=>({isNativePlatform:vi.fn(()=>false)}));
vi.mock('@capacitor/core',()=>({Capacitor:platform}));
vi.mock('@/api/client',()=>({apiClient:api}));
const available={available:true,deliveryReady:true,accessUntil:'2027-07-01',updatesUntil:'2027-06-30',termsUrl:'https://citrusfantasysports.com/terms'};
beforeEach(()=>{vi.clearAllMocks();platform.isNativePlatform.mockReturnValue(false);window.localStorage.clear();window.history.replaceState({},'','/');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('Customer purchase and download states',()=>{
  it('never loads offers or exposes purchase controls in the native app',()=>{
    platform.isNativePlatform.mockReturnValue(true);
    const {container}=render(<DraftKitDownloads />);
    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('does not show a buy button while launch is disabled',async()=>{
    api.get.mockResolvedValue({data:{...available,available:false,deliveryReady:false}});
    render(<DraftKitDownloads />);
    expect(await screen.findByText(/Purchases are not open yet/)).toBeInTheDocument();
    expect(screen.queryByText('Buy the kit for $7.99 CAD')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('does not trust a successful-payment URL to unlock downloads',async()=>{
    window.history.replaceState({},'','/?checkout=complete');
    api.get.mockImplementation((path:string)=>Promise.resolve({data:path.endsWith('/offer')?available:{active:false,accessUntil:null}}));
    render(<DraftKitDownloads />);
    expect(await screen.findByText(/Already paid/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Full draft kit'})).not.toBeInTheDocument();
  });
  it('requires sign-in when the purchase check returns 401',async()=>{
    api.get.mockImplementation((path:string)=>path.endsWith('/offer')?Promise.resolve({data:available}):Promise.reject({status:401}));
    render(<DraftKitDownloads />);
    expect(await screen.findByRole('link',{name:'Sign in or create an account'})).toHaveAttribute('href','/auth?redirect=%2Fdraft-kit%3Ftab%3Dpricing');
  });
  it('loads supported settings only for an entitled customer, rejecting blank weights',async()=>{
    api.get.mockImplementation((path:string)=>Promise.resolve({data:path.endsWith('/offer')?available:path.endsWith('/access')?{active:true,accessUntil:'2027-07-01'}:{weights:{skater:{goals:6},goalie:{wins:5}},projectionDate:'2026-09-12',revision:'test'}}));
    render(<DraftKitDownloads />);
    const input=await screen.findByLabelText('skater Goals');
    await waitFor(()=>expect(screen.getByRole('button',{name:'Full draft kit'})).toBeEnabled());
    fireEvent.change(input,{target:{value:''}});
    expect(screen.getByRole('button',{name:'Full draft kit'})).toBeDisabled();
    fireEvent.change(input,{target:{value:'0'}});
    expect(screen.getByRole('button',{name:'Full draft kit'})).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('needs skater scoring');
    fireEvent.change(input,{target:{value:'6'}});
    expect(screen.getByRole('button',{name:'Full draft kit'})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Offline draft desk'})).toBeEnabled();
  });
  it('preserves edited weights on access refresh and restores explicitly saved settings',async()=>{
    api.get.mockImplementation((path:string)=>Promise.resolve({data:path.endsWith('/offer')?available:path.endsWith('/access')?{active:true,accessUntil:'2027-07-01'}:{weights:{skater:{goals:6},goalie:{wins:5}},projectionDate:'2026-09-12',revision:'test'}}));
    const view=render(<DraftKitDownloads />);
    fireEvent.change(await screen.findByLabelText('skater Goals'),{target:{value:'9'}});
    fireEvent.click(screen.getByRole('button',{name:'Save settings on this browser'}));
    fireEvent.click(screen.getByRole('button',{name:'Refresh purchase access'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh purchase access'})).toBeEnabled());
    expect(screen.getByLabelText('skater Goals')).toHaveValue(9);
    view.unmount();render(<DraftKitDownloads />);
    expect(await screen.findByLabelText('skater Goals')).toHaveValue(9);
  });
  it('explains offline downloads without requiring an upload for the purchased live desk',async()=>{
    api.get.mockImplementation((path:string)=>Promise.resolve({data:path.endsWith('/offer')?available:path.endsWith('/access')?{active:true,accessUntil:'2027-07-01'}:{weights:{skater:{goals:6},goalie:{wins:5}},projectionDate:'2026-09-12',revision:'test'}}));
    api.post.mockResolvedValue({data:{base64:btoa('<html></html>'),mime:'text/html',filename:'Citrus-Desk.html'}});
    vi.stubGlobal('URL',class extends URL { static createObjectURL=vi.fn(()=> 'blob:desk'); static revokeObjectURL=vi.fn(); });
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    render(<DraftKitDownloads />);
    fireEvent.click(await screen.findByRole('button',{name:'Offline draft desk'}));
    expect(await screen.findByText(/Offline desk downloaded/)).toHaveTextContent('opens automatically in the draft room');
    expect(screen.getByRole('status')).toHaveTextContent('may differ from this dated download');
  });
  it('keeps failures visible and permits a purchase-status retry',async()=>{
    api.get.mockRejectedValue(new Error('Could not check access.'));
    render(<DraftKitDownloads />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check access.');
    fireEvent.click(screen.getByRole('button',{name:'Refresh purchase access'}));
    await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(2));
  });
});
