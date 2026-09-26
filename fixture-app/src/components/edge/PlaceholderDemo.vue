<script setup lang="ts">
import { ref } from 'vue';
import { formatYen } from '@/utils/format';

const props = defineProps<{ order: { id: string; items: { name: string; price: number }[] }; showNote?: boolean }>();
const mode = ref<'view' | 'edit'>(fetchMode());
const note = ref('');
// a local function: not an input a fixture can give (REPORT V12)
const badge = (id: string) => `#${id}`;
throw new Error('PlaceholderDemo script executed');
</script>

<template>
  <div class="space-y-2 p-4" :data-order="order.id" :title="`注文 ${order.id}`">
    <h2 class="font-bold">注文 {{ order.id }} / {{ props.order.customer.name }}</h2>
    <p v-if="mode === 'edit'">編集モード</p>
    <p v-else-if="showNote">{{ note }}</p>
    <p v-else>閲覧モード（mode={{ mode }}）</p>
    <ul>
      <li v-for="(item, i) in order.items" :key="i">{{ i + 1 }}. {{ item.name }} — {{ formatYen(item.price) }} × {{ item.qty * 2 }}</li>
    </ul>
    <p>合計: {{ order.items.reduce((s, x) => s + x.price, 0) }} {{ badge(order.id) }}</p>
    <p :class="{ 'text-red-600': order.overdue }">期限: {{ order.dueDate.toLocaleDateString() }}</p>
  </div>
</template>
