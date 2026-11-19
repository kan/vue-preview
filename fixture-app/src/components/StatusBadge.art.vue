<script setup lang="ts">
// REPORT V16: a bare path (relative to this file, as Musea reads it), and an import of the
// component in a form other than `import StatusBadge from` (no second import may be added)
import { default as StatusBadge } from './StatusBadge.vue';

defineArt('StatusBadge.vue', { title: 'StatusBadge' });
</script>

<art>
  <variant name="Suspended">
    <StatusBadge status="suspended" />
  </variant>
</art>
