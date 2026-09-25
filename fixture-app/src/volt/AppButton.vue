<script setup lang="ts">
// Volt-style wrapper: a project-local SFC around PrimeVue Button that
// layers its own pt on top of the global preset.
import Button, { type ButtonProps } from 'primevue/button';

interface Props extends /* @vue-ignore */ ButtonProps {
  severity?: 'primary' | 'secondary';
}
const props = withDefaults(defineProps<Props>(), { severity: 'primary' });

const theme = {
  root: 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer',
  label: 'leading-none',
};
</script>

<template>
  <Button
    unstyled
    :pt="theme"
    :pt-options="{ mergeSections: true, mergeProps: false }"
    :class="severity === 'secondary' ? 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100' : 'bg-brand-500 text-white hover:bg-brand-600'"
  >
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </Button>
</template>
