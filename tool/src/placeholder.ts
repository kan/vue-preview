// Placeholder values: stand-ins for anything the tool cannot know statically.
export const PLACEHOLDER = Symbol.for('vue-preview.placeholder');

export interface PlaceholderOptions {
  iterations: number;
}

const passthroughKeys = new Set(['then', 'catch', 'finally', 'constructor', 'prototype', 'nodeType', 'render', 'setup', 'template']);

export function isPlaceholder(v: unknown): boolean {
  return (typeof v === 'function' || (typeof v === 'object' && v !== null)) && (v as any)[PLACEHOLDER] === true;
}

export function createPlaceholder(expr: string, opts: PlaceholderOptions): any {
  const label = `{{ ${expr} }}`;
  const target = function placeholder() {};
  return new Proxy(target, {
    get(_t, key) {
      if (key === PLACEHOLDER) return true;
      if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'number' ? 1 : label);
      if (key === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < opts.iterations; i++) yield createPlaceholder(`${expr}[${i}]`, opts);
        };
      }
      if (typeof key === 'symbol') return undefined;
      if (key === 'toString' || key === 'toJSON') return () => label;
      if (key === 'valueOf') return () => label;
      if (key === 'length') return opts.iterations;
      // Vue / JS internals must not see a "truthy anything" here.
      if (key.startsWith('__v') || key.startsWith('__') || passthroughKeys.has(key)) return undefined;
      return createPlaceholder(/^[A-Za-z_$][\w$]*$/.test(key) ? `${expr}.${key}` : `${expr}[${JSON.stringify(key)}]`, opts);
    },
    apply(_t, _this, args) {
      return createPlaceholder(`${expr}(${args.length ? '…' : ''})`, opts);
    },
    construct() {
      return createPlaceholder(`new ${expr}()`, opts);
    },
    has() {
      return true;
    },
    set() {
      return true;
    },
  });
}
