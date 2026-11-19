import { describe, expect, test } from 'bun:test';
import { artPathFor, componentName, componentSpec, defineArtTarget, splitArt, variantSource } from '../../src/art';

describe('componentSpec (how Musea reads the defineArt() path)', () => {
  const alias = (s: string) => s.startsWith('@/');
  test('relative, absolute and alias paths stay', () => {
    for (const s of ['./X.vue', '../ui/X.vue', '/abs/X.vue', '@/components/X.vue']) expect(componentSpec(s, alias)).toBe(s);
  });
  test('a bare path is relative to the art file', () => expect(componentSpec('X.vue', alias)).toBe('./X.vue'));
});

describe('componentName (the tag Musea gives the component)', () => {
  test('PascalCase file stem', () => {
    expect(componentName('./StatusBadge.vue')).toBe('StatusBadge');
    expect(componentName('../ui/status-badge.vue')).toBe('StatusBadge');
    expect(componentName('./user_table.vue?raw')).toBe('UserTable');
  });
});

describe('defineArtTarget', () => {
  test('a path', () => expect(defineArtTarget(`defineArt('./Button.vue', { title: 'Button' })`)).toEqual({ source: './Button.vue' }));
  test('an identifier (the art imports it)', () => {
    expect(defineArtTarget(`import Button from './Button.vue'\ndefineArt(Button, { title: 'B' })`)).toEqual({ name: 'Button' });
  });
  test('none', () => expect(defineArtTarget('const a = 1')).toEqual({}));
});

describe('splitArt / variantSource', () => {
  const imp = "import X from './X.vue';";
  const variant = { name: 'A', default: true, template: '<X a="1" />' };
  /** The variant SFC of `source`, with `<script setup>`'s content start found by text. */
  const render = (source: string, importLine: string | null) => {
    const artRange: [number, number] = [source.indexOf('<art'), source.indexOf('</art>') + '</art>'.length];
    const setup = source.indexOf('<script setup>');
    const parts = splitArt(source, artRange, setup < 0 ? null : setup + '<script setup>'.length, importLine);
    return variantSource({ component: './X.vue', variants: [variant], ...parts }, variant);
  };

  test('<art> becomes <template>; the import goes into <script setup>', () => {
    expect(render(`<script setup>\ndefineArt('./X.vue')\n</script>\n<art><variant name="A"><X a="1" /></variant></art>\n<style>.a{}</style>`, imp)).toBe(
      `<script setup>\n${imp}\n\ndefineArt('./X.vue')\n</script>\n<template><X a="1" /></template>\n<style>.a{}</style>`,
    );
  });
  test('<script setup> after <art>: the import still lands in it', () => {
    expect(render(`<art><variant name="A"><X a="1" /><X /></variant></art>\n<script setup>\nconst n = 1\n</script>`, imp)).toBe(
      `<template><X a="1" /></template>\n<script setup>\n${imp}\n\nconst n = 1\n</script>`,
    );
  });
  test('no <script setup>: one is added', () => {
    expect(render(`<art component="./X.vue"><variant name="A"><X a="1" /></variant></art>`, imp)).toBe(`<script setup>\n${imp}\n</script>\n<template><X a="1" /></template>`);
  });
  test('a new <script setup> takes the lang of a plain <script>', () => {
    const source = `<script lang="ts">export default {}</script>\n<art component="./X.vue"><variant name="A"><X a="1" /></variant></art>`;
    const artRange: [number, number] = [source.indexOf('<art'), source.length];
    expect(splitArt(source, artRange, null, imp, 'ts').before).toBe(`<script setup lang="ts">\n${imp}\n</script>\n<script lang="ts">export default {}</script>\n`);
  });
  test('no import (the art imports the component itself)', () => {
    expect(render(`<script setup>\nimport X from './X.vue'\n</script>\n<art><variant name="A"><X a="1" /></variant></art>`, null)).toBe(
      `<script setup>\nimport X from './X.vue'\n</script>\n<template><X a="1" /></template>`,
    );
  });
});

test('artPathFor: <Name>.art.vue next to the SFC', () => expect(artPathFor('/p/src/A.vue')).toBe('/p/src/A.art.vue'));
