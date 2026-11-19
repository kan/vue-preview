<script lang="ts">
// REPORT V17: the props interface in a plain <script> beside <script setup>, a method, and a
// local alias of an imported union
import type { Tone } from './typed-props';

type Level = Tone;

export interface Props {
  level: Level;
  mode: 'a' | 'b';
  onSave(id: string): void;
}
</script>

<script setup lang="ts">
defineProps<Props>();

if (typeof window === 'undefined') {
  throw new Error('TypedPropsPlain <script setup> was executed outside the browser');
}
</script>

<template>
  <p class="typed-plain">{{ level }} {{ mode }}</p>
</template>
