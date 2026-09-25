import { describe, expect, test } from 'bun:test';
import { createPlaceholder, isPlaceholder } from '../../src/placeholder';

const ph = (expr: string) => createPlaceholder(expr, { iterations: 3 });

describe('placeholder', () => {
  test('stringifies to its reference expression', () => {
    expect(String(ph('foo'))).toBe('{{ foo }}');
    expect(`${ph('foo').bar.baz}`).toBe('{{ foo.bar.baz }}');
    expect(String(ph('foo')['a-b'])).toBe('{{ foo["a-b"] }}');
  });

  test('is callable and returns a placeholder', () => {
    const r = ph('fmt')(1, 2);
    expect(isPlaceholder(r)).toBe(true);
    expect(String(r)).toBe('{{ fmt(…) }}');
    expect(String(ph('now')())).toBe('{{ now() }}');
  });

  test('iterates N placeholder elements', () => {
    const items = [...ph('rows')];
    expect(items.length).toBe(3);
    expect(String(items[2].name)).toBe('{{ rows[2].name }}');
    expect(ph('rows').length).toBe(3);
  });

  test('number hint is 1', () => {
    expect(+ph('n')).toBe(1);
    expect(ph('n') * 2).toBe(2);
  });

  test('does not look like a promise / Vue internal', () => {
    const p = ph('x');
    expect(p.then).toBeUndefined();
    expect(p.__v_isRef).toBeUndefined();
    expect(p.__v_isVNode).toBeUndefined();
  });

  test('isPlaceholder', () => {
    expect(isPlaceholder(ph('x'))).toBe(true);
    expect(isPlaceholder({})).toBe(false);
    expect(isPlaceholder(() => {})).toBe(false);
    expect(isPlaceholder(null)).toBe(false);
  });
});
