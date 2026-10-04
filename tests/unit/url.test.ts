import { describe, expect, it } from 'vitest';
import { parseUrlView, urlNumber } from '../../src/ui/url';

const q = (s: string) => new URLSearchParams(s);

describe('the camera in the URL', () => {
  it('treats a missing, empty or non-numeric value as absent', () => {
    expect(parseUrlView(q(''))).toEqual({});
    expect(parseUrlView(q('incl='))).toEqual({});
    expect(parseUrlView(q('incl=%20&az=&pa=&zoom='))).toEqual({});
    expect(parseUrlView(q('incl=abc&zoom=NaN&az=Infinity'))).toEqual({});
    expect(urlNumber(q('incl='), 'incl')).toBeUndefined();
    expect(urlNumber(q('incl=0'), 'incl')).toBe(0);
  });

  it('clamps the zoom to 0.15–12, 0 included', () => {
    expect(parseUrlView(q('zoom=0')).zoom).toBe(0.15);
    expect(parseUrlView(q('zoom=0.1')).zoom).toBe(0.15);
    expect(parseUrlView(q('zoom=-3')).zoom).toBe(0.15);
    expect(parseUrlView(q('zoom=2')).zoom).toBe(2);
    expect(parseUrlView(q('zoom=40')).zoom).toBe(12);
  });

  it('wraps az and pa, clamps incl, as the orbit control does', () => {
    expect(parseUrlView(q('az=-10&pa=370&incl=200'))).toEqual({ az: 350, pa: 10, incl: 180 });
    expect(parseUrlView(q('incl=0')).incl).toBe(0);
    expect(parseUrlView(q('incl=-5')).incl).toBe(0);
    expect(parseUrlView(q('az=35.5')).az).toBe(35.5);
  });
});
