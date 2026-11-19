import { describe, expect, test } from 'bun:test';
import { literalOptions } from '../../src/prop-types';

// Babel TS type nodes, built by hand (the parser comes from the project's compiler-sfc)
const lit = (literal: any) => ({ type: 'TSLiteralType', literal });
const str = (value: string) => lit({ type: 'StringLiteral', value });
const num = (value: number) => lit({ type: 'NumericLiteral', value });
const union = (...types: any[]) => ({ type: 'TSUnionType', types });
const ref = (name: string, typeParameters?: any) => ({ type: 'TSTypeReference', typeName: { type: 'Identifier', name }, typeParameters });
const none = () => undefined;

describe('literalOptions', () => {
  test('a union of string, number, boolean and negative literals', () => {
    const t = union(str('a'), num(1), lit({ type: 'BooleanLiteral', value: true }), lit({ type: 'UnaryExpression', operator: '-', argument: { type: 'NumericLiteral', value: 2 } }));
    expect(literalOptions(t, none)).toEqual(['a', 1, true, -2]);
  });
  test('a union with a non-literal member, or no union, gives nothing', () => {
    expect(literalOptions(union(str('a'), { type: 'TSStringKeyword' }), none)).toBeUndefined();
    expect(literalOptions(str('a'), none)).toBeUndefined();
    expect(literalOptions({ type: 'TSBooleanKeyword' }, none)).toBeUndefined();
  });
  test('aliases are followed through the scope (as the right-hand side or the declaration)', () => {
    const types: Record<string, any> = {
      Tone: union(str('info'), str('warn')),
      Alias: ref('Tone'),
      Decl: { type: 'TSTypeAliasDeclaration', typeAnnotation: union(num(1), num(2)) },
    };
    const lookup = (name: string) => types[name];
    expect(literalOptions(ref('Alias'), lookup)).toEqual(['info', 'warn']);
    expect(literalOptions(ref('Decl'), lookup)).toEqual([1, 2]);
    expect(literalOptions(ref('Missing'), lookup)).toBeUndefined();
  });
  test('a generic reference and a cycle of aliases give nothing', () => {
    expect(literalOptions(ref('Tone', { params: [] }), () => union(str('a')))).toBeUndefined();
    expect(literalOptions(ref('A'), (n) => ref(n === 'A' ? 'B' : 'A'))).toBeUndefined();
  });
  test('parentheses around the union', () => {
    expect(literalOptions({ type: 'TSParenthesizedType', typeAnnotation: union(str('x')) }, none)).toEqual(['x']);
  });
});
