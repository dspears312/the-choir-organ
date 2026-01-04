<template>
    <q-drawer :model-value="debugStore.isOpen" side="right" bordered dark behavior="desktop" :width="400"
        class="bg-dark-sidebar" @update:model-value="(v) => !v && debugStore.close()">
        <DebugDrawerContent />
    </q-drawer>
</template>

<script setup lang="ts">
import { useDebugStore } from 'src/stores/debug';
import DebugDrawerContent from './DebugDrawerContent.vue';

const debugStore = useDebugStore();
</script>

<style lang="scss" scoped>
.bg-dark-sidebar {
    background: #0f0f0f;
}
</style>