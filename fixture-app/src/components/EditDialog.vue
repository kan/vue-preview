<script setup lang="ts">
import { ref } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import AppButton from '@/volt/AppButton.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import type { User } from './UserTable.vue';

const props = withDefaults(defineProps<{ user: User | null; title?: string }>(), {
  title: 'ユーザー編集',
});
const visible = defineModel<boolean>('visible', { default: false });
const draftName = ref(props.user?.name ?? '');

if (typeof window === 'undefined') {
  throw new Error('EditDialog <script setup> was executed outside the browser');
}
</script>

<template>
  <Dialog v-model:visible="visible" :header="title" modal>
    <form v-if="user" class="space-y-3">
      <label class="block text-sm">
        <span class="mb-1 block text-slate-600">氏名</span>
        <InputText v-model="draftName" />
      </label>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-slate-600">メール:</span>
        <span>{{ user.email }}</span>
        <StatusBadge :status="user.status" compact />
      </div>
    </form>
    <p v-else class="text-sm text-slate-500">ユーザーが選択されていません</p>
    <template #footer>
      <AppButton label="キャンセル" severity="secondary" @click="visible = false" />
      <AppButton label="保存" icon="pi pi-save" />
    </template>
  </Dialog>
</template>
