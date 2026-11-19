<script setup lang="ts">
// REPORT V17: the TS types of props in `inputs` — an imported interface, an alias of a union of
// literals, and defineModel with a local alias and with an alias this file imports
import type { Tone, TypedProps } from './typed-props';

type Align = 'start' | 'end';

withDefaults(defineProps<TypedProps>(), { size: 2 });
const align = defineModel<Align>('align', { default: 'start' });
const level = defineModel<Tone>('level');

if (typeof window === 'undefined') {
  throw new Error('TypedProps <script setup> was executed outside the browser');
}
</script>

<template>
  <p class="typed" :class="[`typed--${tone}`, `typed--${size}`, `typed--${align}`]" :data-level="level">{{ label }}</p>
</template>
