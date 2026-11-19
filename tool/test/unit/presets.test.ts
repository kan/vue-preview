import { describe, expect, test } from 'bun:test';
import { presetsFor } from '../../src/presets';

describe('presetsFor', () => {
  test('one set per element of a union, the default element included', () => {
    expect(presetsFor([{ name: 'status', types: ['String'], options: ['active', 'invited'], default: 'active' }])).toEqual([
      { name: 'status=active', props: { status: 'active' } },
      { name: 'status=invited', props: { status: 'invited' } },
    ]);
    expect(presetsFor([{ name: 'size', types: ['Number'], options: [1, 2] }]).map((p) => p.name)).toEqual(['size=1', 'size=2']);
  });
  test('a boolean takes the value other than its default (false when there is none)', () => {
    expect(presetsFor([{ name: 'compact', types: ['Boolean'], default: false }])).toEqual([{ name: 'compact=true', props: { compact: true } }]);
    expect(presetsFor([{ name: 'open', types: ['Boolean'], default: true }])).toEqual([{ name: 'open=false', props: { open: false } }]);
    expect(presetsFor([{ name: 'loading', types: ['Boolean'] }])).toEqual([{ name: 'loading=true', props: { loading: true } }]);
  });
  test('no set for other props (arrays, objects, a boolean or string prop)', () => {
    const props = [
      { name: 'rows', types: ['Array'] },
      { name: 'user', types: ['Object'] },
      { name: 'flag', types: ['Boolean', 'String'] },
      { name: 'title', types: ['String'], default: 'x' },
    ];
    expect(presetsFor(props)).toEqual([]);
  });
});
