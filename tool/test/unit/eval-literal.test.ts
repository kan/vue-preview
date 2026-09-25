import { describe, expect, test } from 'bun:test';
import { evalLiteral, UNKNOWN } from '../../src/compile';

// Minimal Babel-shaped nodes (the real ones come from @vue/compiler-sfc's parser).
const str = (value: string) => ({ type: 'StringLiteral', value });
const num = (value: number) => ({ type: 'NumericLiteral', value });
const id = (name: string) => ({ type: 'Identifier', name });
const prop = (key: string, value: any) => ({ type: 'ObjectProperty', key: id(key), value, computed: false });

describe('evalLiteral', () => {
  test('primitives', () => {
    expect(evalLiteral(str('a'))).toBe('a');
    expect(evalLiteral(num(1))).toBe(1);
    expect(evalLiteral({ type: 'BooleanLiteral', value: false })).toBe(false);
    expect(evalLiteral({ type: 'NullLiteral' })).toBe(null);
    expect(evalLiteral(id('undefined'))).toBeUndefined();
    expect(evalLiteral({ type: 'UnaryExpression', operator: '-', argument: num(3) })).toBe(-3);
  });

  test('objects and arrays of literals', () => {
    const node = {
      type: 'ObjectExpression',
      properties: [prop('a', str('x')), prop('b', { type: 'ArrayExpression', elements: [num(1), num(2)] })],
    };
    expect(evalLiteral(node)).toEqual({ a: 'x', b: [1, 2] });
  });

  test('anything non-literal is UNKNOWN', () => {
    expect(evalLiteral(id('foo'))).toBe(UNKNOWN);
    expect(evalLiteral({ type: 'CallExpression', callee: id('f'), arguments: [] })).toBe(UNKNOWN);
    expect(evalLiteral({ type: 'ArrayExpression', elements: [num(1), id('x')] })).toBe(UNKNOWN);
    expect(evalLiteral({ type: 'TemplateLiteral', expressions: [id('x')], quasis: [] })).toBe(UNKNOWN);
  });
});
