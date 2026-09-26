<script setup lang="ts">
// Uses components registered globally in src/main.ts (app.component), never imported here.
</script>

<template>
  <div class="flex gap-2">
    <app-badge status="invited" />
    <pv-tag value="global-tag" />
  </div>
</template>
