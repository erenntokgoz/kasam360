import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcArgs = Record<string, unknown>;
type TargetRow = { month: string; category: string; target_cents: number; actual_cents: number; achieved_percent: number };
const invokeIPC = vi.fn<(command: string, args: IpcArgs) => Promise<unknown>>();
vi.mock('../services/tauriClient', () => ({ invokeIPC }));

const { useAuthStore } = await import('./authStore');
const { usePanoramaStore } = await import('./panoramaStore');

const board = {
  current: { collectedCents: 0, orders: 0, averageTicketCents: 0, refundCents: 0, discountCents: 0,
    voidCents: 0, vatCents: 0, cogsCents: null, grossProfitCents: null, costIncomplete: false, costMissingSales: 0 },
  previous: { collectedCents: 0, orders: 0, averageTicketCents: 0, refundCents: 0, discountCents: 0,
    voidCents: 0, vatCents: 0, cogsCents: null, grossProfitCents: null, costIncomplete: false, costMissingSales: 0 },
  bucketKind: 'DAY', buckets: [], channels: [], products: [],
  live: { openTables: 0, totalTables: 0, openOrders: 0, openOrderCents: 0, longestOpenMinutes: 0, kitchenWaiting: 0, shiftOpen: false },
  alerts: [],
};

describe('panoramaStore takvim aralığı', () => {
  beforeEach(() => {
    invokeIPC.mockReset();
    useAuthStore.setState({ user: { userId: 'usr_1', name: 'Sahip', role: 'OWNER', tenantId: 'tnt_1' } });
    usePanoramaStore.setState({
      range: 'TODAY', data: null, metrics: null, metricsError: null, error: null,
      target: undefined, targetMonth: '2026-11', targetError: null,
    });
  });

  it('Pano, Menü Analizi ve Aylık Hedefe aynı seçili yıl-ay aralığını gönderir', async () => {
    invokeIPC.mockImplementation(async (command: string) => {
      if (command === 'get_panorama') return board;
      if (command === 'get_analytics_metrics') return { bcg_counts: {}, bcg_matrix: [], combinations: [] };
      return [];
    });

    usePanoramaStore.getState().setRange({ month: '2024-02' });
    await vi.waitFor(() => expect(invokeIPC).toHaveBeenCalledWith('get_monthly_targets', expect.objectContaining({ month: '2024-02' })));

    const period = invokeIPC.mock.calls.find(([command]) => command === 'get_panorama')?.[1];
    expect(period).toMatchObject({
      from: expect.stringMatching(/^2024-02-01T00:00:00/),
      to: expect.stringMatching(/^2024-03-01T00:00:00/),
    });
    const metrics = invokeIPC.mock.calls.find(([command]) => command === 'get_analytics_metrics')?.[1];
    if (!metrics || !period) throw new Error('Pano ve analitik çağrıları bekleniyordu');
    expect(metrics.range).toEqual({ from: period.from, to: period.to });
    expect(usePanoramaStore.getState().targetMonth).toBe('2024-02');
    expect(usePanoramaStore.getState().target).toBeNull();
  });

  it('eski ay hedefi geç gelen yanıtla yeni seçimi ezemez', async () => {
    const resolvers: Record<string, (rows: TargetRow[]) => void> = {};
    invokeIPC.mockImplementation((command: string, args: IpcArgs) => {
      if (command !== 'get_monthly_targets') throw new Error('Beklenmeyen komut');
      return new Promise<TargetRow[]>((resolve) => { resolvers[String(args.month)] = resolve; });
    });

    const oldRequest = usePanoramaStore.getState().loadTarget('2025-10');
    const newRequest = usePanoramaStore.getState().loadTarget('2025-11');
    resolvers['2025-11']?.([{ month: '2025-11', category: 'ALL', target_cents: 20_000, actual_cents: 8_000, achieved_percent: 40 }]);
    await newRequest;
    resolvers['2025-10']?.([{ month: '2025-10', category: 'ALL', target_cents: 10_000, actual_cents: 9_000, achieved_percent: 90 }]);
    await oldRequest;

    expect(usePanoramaStore.getState().targetMonth).toBe('2025-11');
    expect(usePanoramaStore.getState().target?.actual_cents).toBe(8_000);
  });

  it('eski panonun geç gelen yanıtı yeni ay seçimini ezemez', async () => {
    const resolvers: Record<string, (value: unknown) => void> = {};
    invokeIPC.mockImplementation((command: string, args: IpcArgs) => {
      if (command === 'get_monthly_targets') return Promise.resolve([]);
      if (command === 'get_analytics_metrics') return Promise.resolve({ bcg_counts: {}, bcg_matrix: [], combinations: [] });
      return new Promise((resolve) => { resolvers[String(args.from).slice(0, 7)] = resolve; });
    });
    usePanoramaStore.getState().setRange({ month: '2026-09' });
    usePanoramaStore.getState().setRange({ month: '2026-10' });
    await vi.waitFor(() => expect(Object.keys(resolvers)).toHaveLength(2));
    resolvers['2026-10']?.({ ...board, current: { ...board.current, collectedCents: 1_000 } });
    await vi.waitFor(() => expect(usePanoramaStore.getState().data?.current.collectedCents).toBe(1_000));
    resolvers['2026-09']?.({ ...board, current: { ...board.current, collectedCents: 9_999 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(usePanoramaStore.getState().data?.current.collectedCents).toBe(1_000);
    expect(usePanoramaStore.getState().targetMonth).toBe('2026-10');
  });

  it('kayan 30 gün aylık hedefi cari aydan okur, seçili ay değil', async () => {
    invokeIPC.mockImplementation(async (command: string) => {
      if (command === 'get_panorama') return board;
      if (command === 'get_analytics_metrics') return { bcg_counts: {}, bcg_matrix: [], combinations: [] };
      return [];
    });
    usePanoramaStore.getState().setRange({ month: '2024-02' });
    await vi.waitFor(() => expect(usePanoramaStore.getState().targetMonth).toBe('2024-02'));
    usePanoramaStore.getState().setRange('MONTH');
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await vi.waitFor(() => expect(usePanoramaStore.getState().targetMonth).toBe(expected));
  });
});
