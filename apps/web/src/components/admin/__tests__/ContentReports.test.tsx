import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentReports } from '../ContentReports';
const api = vi.hoisted(() => ({ getContentReports: vi.fn(), moderateReport: vi.fn() }));
vi.mock('@/api/admin', () => ({ adminApi: api }));
const report = { id: 'report', reason: 'Abuse', created_at: '2026-09-06T12:00:00Z', notifications: { message: 'Reported text' } };
beforeEach(() => { vi.clearAllMocks(); api.getContentReports.mockResolvedValue({ data: [report] }); });
describe('moderation queue', () => {
  it('shows loading failures instead of declaring the queue empty', async () => {
    api.getContentReports.mockRejectedValue(new Error('Offline'));
    render(<ContentReports />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No open reports.')).not.toBeInTheDocument();
  });
  it('keeps the report visible when removing it fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.moderateReport.mockRejectedValue(new Error('Offline'));
    render(<ContentReports />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove message' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Reported text', { exact: false })).toBeInTheDocument();
  });
  it('refreshes the queue only after confirmed successful moderation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    api.moderateReport.mockResolvedValue({ data: { success: true } });
    render(<ContentReports />);
    const button = await screen.findByRole('button', { name: 'Remove message' });
    fireEvent.click(button);
    expect(api.moderateReport).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    api.getContentReports.mockResolvedValue({ data: [] });
    fireEvent.click(button);
    await waitFor(() => expect(api.moderateReport).toHaveBeenCalledWith('report', 'remove'));
    expect(await screen.findByText('No open reports.')).toBeInTheDocument();
  });
});
