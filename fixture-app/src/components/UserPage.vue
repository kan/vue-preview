<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PageLayout from '@/components/PageLayout.vue';
import UserTable, { type User } from '@/components/UserTable.vue';
import EditDialog from './EditDialog.vue';
import AppButton from '@/volt/AppButton.vue';

const users = ref<User[]>([]);
const selected = ref<User | null>(null);
const dialogVisible = ref(false);
const activeCount = computed(() => users.value.filter((u) => u.status === 'active').length);

onMounted(async () => {
  users.value = await fetch('/api/users').then((r) => r.json());
});

if (typeof window === 'undefined') {
  throw new Error('UserPage <script setup> was executed outside the browser');
}

function openEditor(user: User) {
  selected.value = user;
  dialogVisible.value = true;
}
</script>

<template>
  <PageLayout title="ユーザー管理" :subtitle="`有効ユーザー ${activeCount} 名`">
    <template #actions>
      <AppButton label="招待" icon="pi pi-user-plus" />
      <AppButton label="エクスポート" icon="pi pi-download" severity="secondary" />
    </template>

    <section class="space-y-4">
      <h2 class="text-base font-semibold">一覧</h2>
      <UserTable :rows="users" @edit="openEditor" />
    </section>

    <ul class="mt-6 grid grid-cols-3 gap-3">
      <li v-for="u in users.slice(0, 3)" :key="u.id" class="rounded-lg border border-slate-200 bg-white p-3">
        <div class="font-medium">{{ u.name }}</div>
        <div class="text-xs text-slate-500">{{ u.email }}</div>
      </li>
    </ul>

    <EditDialog v-model:visible="dialogVisible" :user="selected" />

    <template #footer>最終更新: {{ new Date().toLocaleDateString() }}</template>
  </PageLayout>
</template>
