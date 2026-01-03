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
          <q-btn flat round icon="help_outline" color="amber-8" size="sm" class="q-ml-md">
            <q-tooltip>Help & Walkthrough</q-tooltip>
            <q-menu dark class="bg-grey-10 text-amber">
              <q-list style="min-width: 150px">
                <q-item clickable v-close-popup @click="walkthroughStore.start(organStore)">
                  <q-item-section avatar><q-icon name="explore" /></q-item-section>
                  <q-item-section>Start Guided Tour</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="showHelp = true">
                  <q-item-section avatar><q-icon name="info" /></q-item-section>
                  <q-item-section>Quick Info Dialog</q-item-section>
                </q-item>
                <q-separator dark />
                <q-item clickable v-close-popup @click="debugStore.open()">
                  <q-item-section avatar><q-icon name="bug_report" color="red-5" /></q-item-section>
                  <q-item-section class="text-red-5">Debug Inspector</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </div>
    </q-header>

    <q-page-container style="display: flex; flex-direction: column;">
      <router-view />
    </q-page-container>

    <HelpDialog v-model="showHelp" />
    <WalkthroughDrawer />
    <DebugDrawer />
    <WalkthroughPointer />
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import HelpDialog from 'src/components/HelpDialog.vue';
import WalkthroughDrawer from 'src/components/WalkthroughDrawer.vue';
import DebugDrawer from 'src/components/DebugDrawer.vue';
import WalkthroughPointer from 'src/components/WalkthroughPointer.vue';
import { useWalkthroughStore } from 'src/stores/walkthrough';
import { useOrganStore } from 'src/stores/organ';
import { useDebugStore } from 'src/stores/debug';

import { Dark } from 'quasar';

Dark.set(true);

const appVersion = ref('');
const showHelp = ref(false);
const walkthroughStore = useWalkthroughStore();
const debugStore = useDebugStore();
const organStore = useOrganStore();

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
