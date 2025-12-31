<template>
  <q-layout view="hHh lpR fFf" class="main-layout">
    <q-header class="bg-black text-white">
      <div class="row no-wrap items-center q-px-lg q-py-md">
        <q-icon name="piano" size="28px" class="text-amber-8 q-mr-sm" />
        <div class="text-h6 font-cinzel text-amber-8 tracking-widest">
          The Choir Organ
        </div>
        <q-space />
        <div class="text-caption text-grey-6 font-cinzel row items-center q-gutter-x-sm">
          <span>Sacred Music Library</span>
          <span v-if="appVersion" class="text-grey-9 q-ml-sm">v{{ appVersion }}</span>
        </div>
      </div>
    </q-header>

    <q-page-container style="display: flex; flex-direction: column;">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const appVersion = ref('');

onMounted(async () => {
  if ((window as any).myApi?.getAppVersion) {
    appVersion.value = await (window as any).myApi.getAppVersion();
  }
});
</script>

<style lang="scss">
.main-layout {
  background: #050505;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* Ensure it fills the #q-app container */
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}

.tracking-widest {
  letter-spacing: 0.2em;
}
</style>
