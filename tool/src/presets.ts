// Sets of prop values made from the props' declarations, for `inputs.presets` and `--preset`
// (REPORT V18). Each changes one prop: an element of a union of literals, or the other value of
// a boolean. Props with no such values (arrays, objects, `User | null`) keep their placeholder
// or fixture value: the placeholder shows the expression the template reads.
import type { PropInfo } from './compile';
import type { Literal } from './prop-types';

/** A prop as `inputs.props` shows it */
export type InputProp = { name: string; default?: unknown } & Pick<PropInfo, 'types' | 'options'>;

export interface Preset {
  /** `prop=value`: which prop it changes, and to what */
  name: string;
  props: Record<string, Literal>;
}

const preset = (prop: string, value: Literal): Preset => ({ name: `${prop}=${value}`, props: { [prop]: value } });

export function presetsFor(props: InputProp[]): Preset[] {
  const out: Preset[] = [];
  for (const p of props) {
    if (p.options) out.push(...p.options.map((v) => preset(p.name, v)));
    // a boolean prop: Vue's casting makes an absent one false
    else if (p.types.length === 1 && p.types[0] === 'Boolean') out.push(preset(p.name, !(p.default ?? false)));
  }
  return out;
}
