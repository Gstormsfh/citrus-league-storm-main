import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {TooltipProvider} from '@/components/ui/tooltip';
import {GoalieProjectionTooltip} from '../GoalieProjectionTooltip';
import type {MatchupPlayer} from '../types';
vi.mock('@/hooks/useIsMobile',()=>({useIsMobile:()=>true}));
describe('goalie projection missing evidence',()=>{
  it('keeps a partial forecast usable without inventing categories or a probable start',()=>{
    render(<TooltipProvider><GoalieProjectionTooltip projection={{total_projected_points:3.2,projected_gp:0.4,projected_shutouts:0,starter_confirmed:false} as MatchupPlayer['goalieProjection']}/></TooltipProvider>);
    fireEvent.click(screen.getByRole('button',{name:'3.2 pts'}));
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    expect(screen.getByText('0.00')).toBeTruthy();
    expect(screen.getByText('Starter not confirmed')).toBeTruthy();
    expect(screen.queryByText(/Probable Starter/)).toBeNull();
  });
});
