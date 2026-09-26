<script setup lang="ts">
// `useI18n` is auto-imported here; vue-i18n and a project's own composable look the same (REPORT V13)
const { t, locale } = useI18n();
</script>

<template>
  <div>
    <p class="greeting">{{ $t('greeting', { name: 'Pike' }) }}</p>
    <p class="nested">{{ t('menu.open') }}</p>
    <p class="flat">{{ t('flat.key') }}</p>
    <p class="missing">{{ t('no.such.key') }}</p>
    <p class="locale">{{ locale }}</p>
  </div>
</template>
