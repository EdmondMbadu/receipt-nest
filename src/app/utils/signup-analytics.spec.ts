import { readGameRef } from './signup-analytics';

describe('readGameRef', () => {
  afterEach(() => localStorage.removeItem('rn_game_ref'));

  it('returns the game for a recent click', () => {
    localStorage.setItem('rn_game_ref', JSON.stringify({ g: 'charge', t: 1_000 }));
    expect(readGameRef(1_000 + 60_000)).toBe('charge');
  });

  it('ignores stale, unknown or malformed refs', () => {
    localStorage.setItem('rn_game_ref', JSON.stringify({ g: 'charge', t: 0 }));
    expect(readGameRef(31 * 24 * 60 * 60 * 1000)).toBeNull();
    localStorage.setItem('rn_game_ref', JSON.stringify({ g: 'evil', t: 0 }));
    expect(readGameRef(10)).toBeNull();
    localStorage.setItem('rn_game_ref', 'not json');
    expect(readGameRef(10)).toBeNull();
  });
});
