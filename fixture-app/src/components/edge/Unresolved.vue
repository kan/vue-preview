<script setup lang="ts">
import Missing from './DoesNotExist.vue';
import Card from 'primevue/card';
</script>
<template>
  <div>
    <Missing title="x">missing の中身</Missing>
    <FancyWidget>グローバル登録想定の中身</FancyWidget>
    <Tag value="auto-resolved" />
    <Card><template #title>Card</template><template #content>content</template></Card>
  </div>
</template>
