<script setup lang="ts">
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import StatusBadge from './StatusBadge.vue';
import AppButton from '@/volt/AppButton.vue';

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'invited' | 'suspended';
}

const props = defineProps<{ rows: User[]; loading?: boolean }>();
const emit = defineEmits<{ edit: [user: User] }>();

if (typeof window === 'undefined') {
  throw new Error('UserTable <script setup> was executed outside the browser');
}

function onEdit(user: User) {
  emit('edit', user);
}
</script>

<template>
  <div class="space-y-2">
    <p v-if="rows.length === 0" class="text-sm text-slate-500">ユーザーがいません</p>
    <DataTable v-else :value="rows" data-key="id">
      <Column field="id" header="ID" />
      <Column field="name" header="氏名" />
      <Column field="email" header="メール" />
      <Column field="role" header="ロール" />
      <Column header="状態">
        <template #body="{ data }">
          <StatusBadge :status="data.status" />
        </template>
      </Column>
      <Column header="">
        <template #body="{ data }">
          <AppButton label="編集" icon="pi pi-pencil" size="small" @click="onEdit(data)" />
        </template>
      </Column>
    </DataTable>
    <p class="text-xs text-slate-400">全 {{ rows.length }} 件</p>
  </div>
</template>
