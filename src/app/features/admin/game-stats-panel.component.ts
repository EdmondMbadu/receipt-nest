import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../../../environments/environments';

/** Daily counters written by the gameEvent Cloud Function (functions/src/game-stats.ts). */
interface GameStatsDay {
  day: string;
  games: Record<string, Record<string, number>>;
}
interface GameStatsResponse {
  timeZone: string;
  days: GameStatsDay[];
}

type Metric = { key: string; label: string; hint: string; kind?: 'ratio'; of?: [string, string] };

const GAMES = [
  { id: 'charge', label: 'Guess the Charge', short: 'Charge' },
  { id: 'shoebox', label: 'Shoebox Sort', short: 'Shoebox' },
  { id: 'fade', label: 'Before It Fades', short: 'Fade' }
];

const METRICS: Metric[] = [
  { key: 'view', label: 'Page views', hint: 'Game page loads' },
  { key: 'players_day', label: 'Players', hint: 'People who started at least one game that day, summed over days' },
  { key: 'players_new', label: 'New players', hint: 'First game ever on this device' },
  { key: 'players_return', label: 'Returning players', hint: 'Came back on a later day and played again' },
  { key: 'start', label: 'Games played', hint: 'Every run started, including replays' },
  { key: 'finish', label: 'Games finished', hint: 'Runs that reached game over / end of today’s 10' },
  { key: 'share_click', label: 'Share taps', hint: 'Tapped the Share button' },
  { key: 'share_done', label: 'Shares sent', hint: 'Share sheet completed or score copied' },
  { key: 'arrival', label: 'Arrivals from shares', hint: 'Visitors who opened a player’s share link' },
  { key: 'read', label: 'Article reads', hint: 'Scrolled into the guide under the game' },
  { key: 'cta', label: 'Signup clicks', hint: 'Clicked a ReceiptNest signup link on the game page' },
  { key: 'signup', label: 'Signups', hint: 'Registered after clicking that game’s signup link (30-day window)' }
];

const RATIOS: Metric[] = [
  { key: 'r_play', label: 'Play rate', hint: 'Players ÷ page views', kind: 'ratio', of: ['players_day', 'view'] },
  { key: 'r_replay', label: 'Games per player', hint: 'Games played ÷ players', kind: 'ratio', of: ['start', 'players_day'] },
  { key: 'r_finish', label: 'Finish rate', hint: 'Finished ÷ played', kind: 'ratio', of: ['finish', 'start'] },
  { key: 'r_share', label: 'Share rate', hint: 'Shares sent ÷ players', kind: 'ratio', of: ['share_done', 'players_day'] },
  { key: 'r_viral', label: 'Arrivals per share', hint: 'Arrivals from shares ÷ shares sent', kind: 'ratio', of: ['arrival', 'share_done'] },
  { key: 'r_cta', label: 'Signup click rate', hint: 'Signup clicks ÷ players', kind: 'ratio', of: ['cta', 'players_day'] },
  { key: 'r_signup', label: 'Click → signup', hint: 'Signups ÷ signup clicks', kind: 'ratio', of: ['signup', 'cta'] }
];

@Component({
  selector: 'app-game-stats-panel',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <details class="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" (toggle)="onToggle($event)">
    <summary class="flex cursor-pointer list-none items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Growth experiments</p>
        <h2 class="mt-1 text-lg font-semibold text-slate-950 dark:text-white">Browser games</h2>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs font-semibold text-amber-700 group-open:hidden dark:text-amber-300">Expand</span>
        <span class="hidden text-xs font-semibold text-slate-500 group-open:inline dark:text-slate-300">Collapse</span>
        <svg class="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" /></svg>
      </div>
    </summary>

    <div class="space-y-6 px-5 py-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          First-party counts from /games (not affected by ad blockers). Days are in {{ timeZone() }}.
          No personal data is stored, so “players” are counted per device per day.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          @for (d of rangeOptions; track d) {
            <button type="button" (click)="setRange(d)"
              class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
              [class]="range() === d ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'">
              {{ d }} days
            </button>
          }
          <button type="button" (click)="load()" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Refresh</button>
        </div>
      </div>

      @if (error()) {
        <p class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{{ error() }}</p>
      }
      @if (loading()) {
        <p class="text-sm text-slate-500 dark:text-slate-400">Loading game stats…</p>
      } @else if (data()) {
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Hub views</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950 dark:text-white">{{ hubViews() | number }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Players</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950 dark:text-white">{{ total('players_day') | number }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Shares sent</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950 dark:text-white">{{ total('share_done') | number }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Signups from games</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950 dark:text-white">{{ total('signup') | number }}</p>
          </div>
        </div>

        <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table class="min-w-full text-sm">
            <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th class="whitespace-nowrap px-4 py-2.5">Last {{ range() }} days</th>
                @for (g of games; track g.id) { <th class="whitespace-nowrap px-4 py-2.5 text-right">{{ g.label }}</th> }
                <th class="px-4 py-2.5 text-right">All games</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (m of metrics; track m.key) {
                <tr>
                  <td class="whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-200" [title]="m.hint">{{ m.label }}</td>
                  @for (g of games; track g.id) { <td class="px-4 py-2 text-right tabular-nums text-slate-950 dark:text-white">{{ sum(g.id, m.key) | number }}</td> }
                  <td class="px-4 py-2 text-right font-semibold tabular-nums text-slate-950 dark:text-white">{{ total(m.key) | number }}</td>
                </tr>
              }
              @for (m of ratios; track m.key) {
                <tr class="bg-amber-50/40 dark:bg-amber-950/10">
                  <td class="whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-200" [title]="m.hint">{{ m.label }} <span class="hidden text-xs text-slate-400 sm:inline">({{ m.hint }})</span></td>
                  @for (g of games; track g.id) { <td class="px-4 py-2 text-right tabular-nums text-slate-950 dark:text-white">{{ ratio(m, g.id) }}</td> }
                  <td class="px-4 py-2 text-right font-semibold tabular-nums text-slate-950 dark:text-white">{{ ratio(m, null) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div>
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-slate-900 dark:text-white">By day</h3>
            <div class="flex items-center gap-2">
              @for (g of dayGameOptions; track g.id) {
                <button type="button" (click)="dayGame.set(g.id)"
                  class="rounded-lg border px-2.5 py-1 text-xs font-semibold"
                  [class]="dayGame() === g.id ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'">{{ g.label }}</button>
              }
            </div>
          </div>
          <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table class="min-w-full text-sm">
              <thead class="bg-slate-50 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th class="whitespace-nowrap px-3 py-2 text-left">Day</th>
                  @for (c of dayCols; track c.key) { <th class="whitespace-nowrap px-3 py-2" [title]="c.hint">{{ c.label }}</th> }
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                @for (row of dayRows(); track row.day) {
                  <tr>
                    <td class="whitespace-nowrap px-3 py-1.5 text-left tabular-nums text-slate-700 dark:text-slate-200">{{ row.day }}</td>
                    @for (c of dayCols; track c.key) { <td class="px-3 py-1.5 text-right tabular-nums" [class]="row.v[c.key] ? 'text-slate-950 dark:text-white' : 'text-slate-300 dark:text-slate-600'">{{ row.v[c.key] || 0 }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  </details>
  `
})
export class GameStatsPanelComponent {
  private readonly functions = getFunctions(app);
  private loadedOnce = false;
  private requestId = 0;

  readonly games = GAMES;
  readonly metrics = METRICS;
  readonly ratios = RATIOS;
  readonly rangeOptions = [7, 14, 30, 90];
  readonly dayGameOptions = [{ id: 'all', label: 'All' }, ...GAMES.map((g) => ({ id: g.id, label: g.short }))];
  readonly dayCols = METRICS.filter((m) => ['view', 'players_day', 'start', 'finish', 'share_done', 'arrival', 'read', 'cta', 'signup'].includes(m.key))
    .map((m) => ({ ...m, label: m.label.replace('Arrivals from shares', 'Arrivals').replace('Games ', '').replace('Page views', 'Views') }));

  readonly range = signal(30);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly data = signal<GameStatsResponse | null>(null);
  readonly dayGame = signal('all');

  readonly timeZone = computed(() => this.data()?.timeZone ?? 'America/Los_Angeles');
  readonly hubViews = computed(() => this.sum('hub', 'view'));
  readonly dayRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const sel = this.dayGame();
    const ids = sel === 'all' ? GAMES.map((g) => g.id) : [sel];
    return [...d.days].reverse().map((row) => {
      const v: Record<string, number> = {};
      for (const c of this.dayCols) v[c.key] = ids.reduce((s, id) => s + (row.games[id]?.[c.key] ?? 0), 0);
      return { day: row.day, v };
    });
  });

  onToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.loadedOnce) {
      this.loadedOnce = true;
      void this.load();
    }
  }

  setRange(days: number): void {
    this.range.set(days);
    void this.load();
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const callable = httpsCallable<{ days: number }, GameStatsResponse>(this.functions, 'getGameStats');
      const res = await callable({ days: this.range() });
      if (id === this.requestId) this.data.set(res.data);
    } catch (err) {
      console.error('Failed to load game stats', err);
      if (id === this.requestId) this.error.set('Unable to load game stats. Is the getGameStats function deployed?');
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  sum(game: string, key: string): number {
    return (this.data()?.days ?? []).reduce((s, d) => s + (d.games[game]?.[key] ?? 0), 0);
  }

  total(key: string): number {
    return GAMES.reduce((s, g) => s + this.sum(g.id, key), 0);
  }

  ratio(m: Metric, game: string | null): string {
    const [a, b] = m.of!;
    const num = game ? this.sum(game, a) : this.total(a);
    const den = game ? this.sum(game, b) : this.total(b);
    if (!den) return '–';
    const r = num / den;
    if (m.key === 'r_replay' || m.key === 'r_viral') return r.toFixed(2);
    return r === 0 ? '0%' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;
  }
}
