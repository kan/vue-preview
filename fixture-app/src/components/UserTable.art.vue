<script setup lang="ts">
// Musea (vize) art file: the variants of UserTable (REPORT V16)
defineArt('./UserTable.vue', { title: 'UserTable', category: 'users' });

// Side effect guard: vue-preview must never execute this script.
if (typeof window === 'undefined') {
  throw new Error('UserTable.art.vue <script setup> was executed outside the browser');
}

const caption = 'ユーザー一覧（空）';
</script>

<art>
  <!-- rows come from UserTable.preview.json -->
  <variant name="With rows" default>
    <UserTable />
  </variant>
  <!-- the rows passed here win over the fixture -->
  <variant name="Empty">
    <section class="art-frame">
      <h2>{{ caption }}</h2>
      <UserTable :rows="[]" />
    </section>
  </variant>
</art>

<style scoped>
.art-frame {
  padding: 8px;
  border: 1px solid #cbd5e1;
}
</style>
