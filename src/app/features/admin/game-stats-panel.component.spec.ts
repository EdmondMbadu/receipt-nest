import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GameStatsPanelComponent } from './game-stats-panel.component';

const day = (d: string, view: number, players: number, shares: number, cta: number, signup = 0) => ({
  day: d,
  games: {
    charge: { view, players_day: players, start: players * 2, finish: players, share_done: shares, arrival: shares * 2, cta, signup },
    shoebox: { view: 10, players_day: 5, start: 5, finish: 4 },
    fade: {},
    hub: { view: 7 },
    decoder: { view: 200, waitlist_open: 40, waitlist_join: 10 }
  }
});

describe('GameStatsPanelComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [GameStatsPanelComponent],
      providers: [provideZonelessChangeDetection()]
    }).compileComponents();
    const fixture = TestBed.createComponent(GameStatsPanelComponent);
    const panel = fixture.componentInstance;
    (panel as unknown as { loadedOnce: boolean }).loadedOnce = true; // no network in tests
    panel.data.set({ timeZone: 'America/Los_Angeles', days: [day('2026-10-08', 100, 40, 4, 2), day('2026-10-09', 50, 10, 1, 3, 1)] });
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, panel };
  }

  it('sums counters per game and across games', async () => {
    const { panel } = await setup();
    expect(panel.sum('charge', 'view')).toBe(150);
    expect(panel.total('players_day')).toBe(60);
    expect(panel.hubViews()).toBe(14);
    expect(panel.total('signup')).toBe(1);
  });

  it('formats ratios and guards empty denominators', async () => {
    const { panel } = await setup();
    const byKey = (k: string) => panel.ratios.find((r) => r.key === k)!;
    expect(panel.ratio(byKey('r_play'), 'charge')).toBe('33%');
    expect(panel.ratio(byKey('r_replay'), 'charge')).toBe('2.00');
    expect(panel.ratio(byKey('r_finish'), 'fade')).toBe('–');
    expect(panel.ratio(byKey('r_signup'), 'shoebox')).toBe('–');
    expect(panel.ratio(byKey('r_share'), 'shoebox')).toBe('0%');
  });

  it('shows the statement decoder waitlist', async () => {
    const { fixture, panel } = await setup();
    panel.waitlist.set({ total: 2, entries: [
      { name: 'Ana', email: 'ana@example.com', source: 'charge_finish', emailStatus: 'sent', createdAt: Date.UTC(2026, 9, 9, 18) },
      { name: 'Bo', email: 'bo@example.com', source: 'charge_link', emailStatus: 'failed', createdAt: null }
    ] });
    fixture.detectChanges();
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('2 on the list');
    expect(text).toContain('ana@example.com');
    expect(panel.sourceLabel('charge_finish')).toBe('Game finish screen');
    expect(panel.sourceLabel('mystery')).toBe('mystery');
    expect(panel.sourceLabel('decoder_hero')).toBe('Decoder page (top)');
    expect(panel.pageConversion()).toBe('5.0%');
    expect(text).toContain('Decoder page views');
  });

  it('lists days newest first and filters by game', async () => {
    const { fixture, panel } = await setup();
    expect(panel.dayRows().map((r) => r.day)).toEqual(['2026-10-09', '2026-10-08']);
    expect(panel.dayRows()[0].v['view']).toBe(60);
    panel.dayGame.set('charge');
    fixture.detectChanges();
    expect(panel.dayRows()[0].v['view']).toBe(50);
  });
});
