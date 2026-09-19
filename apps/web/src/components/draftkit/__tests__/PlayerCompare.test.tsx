import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
const native=vi.hoisted(()=>({enabled:false}));
vi.mock('@/lib/nativeAuth',()=>({isNativeShell:()=>native.enabled}));
import { PlayerCompare, type ComparePlayer } from '../PlayerCompare';
import { deskComparePlayers, weightedCompareStats, roomComparePlayers } from '../compareAdapters';
import { deskFixture } from './deskFixture';
const kit=deskFixture().kit;
const fixture=():ComparePlayer[]=>[
  ...deskComparePlayers(kit,new Set(),'live'),
  {id:'3',name:'Goalie One',team:'AAA',position:'G',goalie:true,games:50,points:510,stats:{saves:1400,goals_against:130,wins:30}},
  {id:'4',name:'Goalie Two',team:'BBB',position:'G',goalie:true,games:50,points:550,stats:{saves:1400,goals_against:110,wins:30}},
  ...Array.from({length:6},(_,i)=>({id:'extra'+i,name:'Extra Player '+i,team:'ABC',position:'C',goalie:false,games:80,points:100,stats:{goals:10+i,assists:20+i,shots_on_goal:180+i}})),
  {id:'5',name:'Missing Sample',team:'CCC',position:'D',goalie:false,games:0,points:null,stats:{goals:0}},
];
const stats=weightedCompareStats(kit.weights);
function mount(players=fixture()) {const view=render(<PlayerCompare players={players} stats={stats} context="Test league · season projections"/>);fireEvent.click(screen.getByRole('button',{name:'Compare players'}));return view;}
function add(name:string){fireEvent.change(screen.getByRole('searchbox'),{target:{value:name}});fireEvent.click(screen.getByRole('button',{name:`Compare ${name}`}));}
beforeEach(()=>{native.enabled=false;});afterEach(cleanup);
describe('Citrus player comparison',()=>{
  it('brings the comparison forward in a sidebar after two selections and still permits ten',()=>{
    const players=fixture();render(<PlayerCompare compact players={players} stats={stats} context="Sidebar"/>);fireEvent.click(screen.getByRole('button',{name:'Compare players'}));
    add(players[0].name);add(players[1].name);expect(screen.queryByRole('searchbox')).toBeNull();
    for(const p of players.slice(2,10)){fireEvent.click(screen.getByRole('button',{name:'Add another player'}));add(p.name);}
    expect(screen.queryByRole('button',{name:'Add another player'})).toBeNull();expect(screen.getAllByRole('columnheader')).toHaveLength(11);
    fireEvent.click(screen.getByRole('button',{name:'Clear comparison'}));expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
  it('selects by identity, caps at ten, removes and clears without changing the player inputs',()=>{
    const players=fixture(),before=JSON.stringify(players);mount(players);
    for(const p of players.slice(0,10))add(p.name);
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.queryByRole('button',{name:'Compare Missing Sample'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Remove Connor McDavid from comparison'}));
    expect(screen.getByRole('searchbox')).not.toBeDisabled();add('Missing Sample');
    fireEvent.click(screen.getByRole('button',{name:'Clear comparison'}));expect(screen.queryByRole('table')).toBeNull();
    expect(JSON.stringify(players)).toBe(before);
  });
  it('keeps existing player colours when removing a different player and adding another',()=>{
    mount();add('Connor McDavid');add('Tim Stützle');
    const header=()=>screen.getByRole('columnheader',{name:/Tim Stützle/});
    const before=header().style.borderTop;
    fireEvent.click(screen.getByRole('button',{name:'Remove Connor McDavid from comparison'}));add('Goalie One');
    expect(header().style.borderTop).toBe(before);
  });
  it('searches accented names and keeps selection while the search changes',()=>{
    mount();fireEvent.change(screen.getByRole('searchbox'),{target:{value:'stutzle'}});add('Tim Stützle');
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'EDM'}});add('Connor McDavid');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
  it('uses negative league weights correctly and highlights the less negative contribution',()=>{
    mount();add('Goalie One');add('Goalie Two');
    const row=screen.getByRole('rowheader',{name:/Goals against/}).closest('tr')!;
    expect(within(row).getByText('110').closest('td')).toHaveClass('cc-edge');
    fireEvent.click(screen.getByRole('button',{name:'Fantasy impact'}));
    expect(within(row).getByText('-330').closest('td')).toHaveClass('cc-edge');
    expect(within(row).getByText('-390').closest('td')).not.toHaveClass('cc-edge');
    const tied=screen.getByRole('rowheader',{name:/Saves/}).closest('tr')!;expect(tied.querySelector('.cc-edge')).toBeNull();
  });
  it('keeps missing values and unrelated goalie stats unavailable, and never divides by zero',()=>{
    mount();add('Missing Sample');add('Goalie One');
    const goals=screen.getByRole('rowheader',{name:/^GoalsNot scored|^Goals6/}).closest('tr')!;
    expect(within(goals).getByText('0')).toBeInTheDocument();expect(within(goals).getByText('N/A')).toBeInTheDocument();
    expect(screen.queryByText('Infinity')).toBeNull();expect(screen.queryByText('NaN')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Fantasy impact'}));
    const hits=screen.getByRole('rowheader',{name:/Hits/}).closest('tr')!;expect(within(hits).getAllByText('N/A')).toHaveLength(2);
  });
  it('updates drafted status without dropping the selected player, including undo',()=>{
    const players=fixture();const view=mount(players);add('Connor McDavid');add('Tim Stützle');
    const rerender=(status:string)=>view.rerender(<PlayerCompare players={players.map((p,i)=>i===0?{...p,status}:p)} stats={stats} context="Test"/>);
    rerender('Drafted or kept');expect(screen.getByText('Drafted or kept')).toBeInTheDocument();
    rerender('Available');expect(screen.queryByText('Drafted or kept')).toBeNull();expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
  it('does not render comparison inside native apps',()=>{
    native.enabled=true;const {container}=render(<PlayerCompare players={fixture()} stats={stats} context="Test"/>);expect(container).toBeEmptyDOMElement();
  });
  it('keeps offline edition values untouched, and uses room totals rather than default stored FPTS',()=>{
    const unavailable=new Set(['8478402']);expect(deskComparePlayers(kit,unavailable,'live')[0].status).toBe('Drafted or kept');
    expect(deskComparePlayers(kit,unavailable,'catching-up')[0].status).toBe('Availability unverified');
    const entry={id:42,name:'One',team:'ABC',position:'G',is_goalie:true,proj_gp:50,proj_fantasy_points:999,proj_goals_against:120,proj_saves:1300};
    const mapped=roomComparePlayers([entry as any],new Map([['42',{total:123,perGp:2.46,gamesRemaining:50}]]),new Set(['42']),true)[0];
    expect(mapped.points).toBe(123);expect(mapped.stats.goals_against).toBe(120);expect(mapped.status).toBe('Drafted or kept');
  });
});
