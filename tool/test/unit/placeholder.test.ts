import { describe, expect, test } from 'bun:test';
import { createPlaceholder, decoratePlaceholders, isPlaceholder, plainPlaceholders, shortExpr } from '../../src/placeholder';

const ph = (expr: string) => createPlaceholder(expr, { iterations: 3 });
// a placeholder's string form is marked for decorating the HTML; compare its plain form
const plain = (v: unknown) => plainPlaceholders(`${v}`);

describe('display (REPORT V11)', () => {
  test('the last segment of the expression', () => {
    expect(shortExpr('data[0].user.name')).toBe('name');
    expect(shortExpr('rows[2]')).toBe('rows[2]');
    expect(shortExpr('fmt(…)')).toBe('fmt(…)');
  });

  test('text gets a span with the full expression as title; attributes get the short form', () => {
    const html = `<p data-id="${ph('order').id}">${[...ph('data')][0].user.name} / ${ph('total')}</p>`;
    expect(decoratePlaceholders(html)).toBe(
      '<p data-id="{{ id }}"><span class="vp-ph" title="data[0].user.name">{{ name }}</span> / <span class="vp-ph" title="total">{{ total }}</span></p>',
    );
  });

  test('a placeholder indexed by another nests the expression, not the marks', () => {
    const v = ph('labels')[`${ph('status')}`];
    expect(plain(v)).toBe('{{ labels[status] }}');
    expect(decoratePlaceholders(`<b>${v}</b>`)).toBe('<b><span class="vp-ph" title="labels[status]">{{ labels[status] }}</span></b>');
  });

  test('no span inside <textarea> or <svg>', () => {
    const html = `<textarea>${ph('form').note}</textarea><svg><text>${ph('label')}</text></svg><p>${ph('x')}</p>`;
    expect(decoratePlaceholders(html)).toBe(
      '<textarea>{{ note }}</textarea><svg><text>{{ label }}</text></svg><p><span class="vp-ph" title="x">{{ x }}</span></p>',
    );
  });

  test('an unescaped expression (v-html) is escaped; a quoted key is shown whole', () => {
    const html = `<div>${ph('row')['user.name']}</div>`; // v-html: not escaped by SSR
    expect(decoratePlaceholders(html)).toBe('<div><span class="vp-ph" title="row[&quot;user.name&quot;]">{{ user.name }}</span></div>');
    // escaped by SSR (text interpolation): the same result
    expect(decoratePlaceholders(html.replace(/"/g, '&quot;'))).toBe(decoratePlaceholders(html));
  });

  test('HTML without placeholders is returned as is', () => {
    const html = '<p class="a">x</p>';
    expect(decoratePlaceholders(html)).toBe(html);
  });
});

describe('placeholder', () => {
  test('stringifies to its reference expression', () => {
    expect(plain(ph('foo'))).toBe('{{ foo }}');
    expect(plain(ph('foo').bar.baz)).toBe('{{ foo.bar.baz }}');
    expect(plain(ph('foo')['a-b'])).toBe('{{ foo["a-b"] }}');
  });

  test('is callable and returns a placeholder', () => {
    const r = ph('fmt')(1, 2);
    expect(isPlaceholder(r)).toBe(true);
    expect(plain(r)).toBe('{{ fmt(…) }}');
    expect(plain(ph('now')())).toBe('{{ now() }}');
  });

  test('iterates N placeholder elements', () => {
    const items = [...ph('rows')];
    expect(items.length).toBe(3);
    expect(plain(items[2].name)).toBe('{{ rows[2].name }}');
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
