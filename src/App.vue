<template>
  <router-view />
  <UpdateNotifier />
</template>

<script setup lang="ts">
import UpdateNotifier from 'components/UpdateNotifier.vue';
import { useOrganStore } from 'src/stores/organ';
import { useExportStore } from 'src/stores/export';
import { provide } from 'vue';

const organStore = useOrganStore();
const exportStore = useExportStore();
provide('organStore', organStore);
provide('exportStore', exportStore);
</script>
