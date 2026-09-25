<script setup lang="ts">
const props = withDefaults(defineProps<{ status: 'active' | 'invited' | 'suspended'; compact?: boolean }>(), {
  status: 'active',
  compact: false,
});

// Side effect guard: vue-preview must never execute this script.
if (typeof window === 'undefined') {
  throw new Error('StatusBadge <script setup> was executed outside the browser');
}

const labels = { active: '有効', invited: '招待中', suspended: '停止' } as const;
const icons = { active: 'pi pi-check-circle', invited: 'pi pi-envelope', suspended: 'pi pi-ban' } as const;
</script>

<template>
  <span class="badge" :class="`badge--${status}`">
    <i :class="icons[status]" />
    <span v-if="!compact">{{ labels[status] }}</span>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge--active { background: #dcfce7; color: #166534; }
.badge--invited { background: #fef9c3; color: #854d0e; }
.badge--suspended { background: #fee2e2; color: #991b1b; }
</style>
