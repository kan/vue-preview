<script setup lang="ts">
// REPORT V18: a destructured prop under another name; its fixture value is keyed by that name,
// and a --preset of the prop must still win
const { status: s } = defineProps<{ status: 'open' | 'closed' }>();
</script>

<template>
  <p class="aliased">{{ s }}</p>
</template>
