<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="min-h-screen">
    <header class="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 class="text-xl font-bold text-slate-900">{{ title }}</h1>
        <p v-if="subtitle" class="text-sm text-slate-500">{{ subtitle }}</p>
      </div>
      <div class="flex gap-2">
        <slot name="actions" />
      </div>
    </header>
    <main class="mx-auto max-w-5xl p-6">
      <slot />
    </main>
    <footer class="px-6 py-4 text-center text-xs text-slate-400">
      <slot name="footer">© fixture-app</slot>
    </footer>
  </div>
</template>

<style scoped>
header {
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
}
</style>
