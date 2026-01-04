<template>
  <q-layout view="hHh lpR fFf" class="main-layout">
    <q-header class="bg-black text-white custom-title-bar">
      <!-- Windows/Linux Window Controls -->
      <q-bar v-if="platform !== 'darwin'" class="q-electron-drag bg-black text-grey-5" style="height: 32px">
        <q-icon name="piano" class="q-ml-xs" />
        <div class="text-caption font-cinzel tracking-widest q-ml-sm">The Choir Organ</div>
        <q-space />
        <q-btn dense flat icon="mdi-window-minimize" @click="minimize" class="control-btn" />
        <q-btn dense flat icon="mdi-checkbox-blank-outline" @click="toggleMaximize" class="control-btn" />
        <q-btn dense flat icon="mdi-close" @click="close" class="control-btn hover-red" />
      </q-bar>

      <div class="row no-wrap items-center q-pl-lg q-py-sm q-electron-drag"
        :class="{ 'mac-header-padding': platform === 'darwin' && !isFullscreen }">
        <div class="row items-center cursor-pointer" @click="$router.push('/')">
          <q-icon name="mdi-piano" size="24px" class="text-amber-8 q-mr-sm" />
          <div class="text-h6 font-cinzel text-amber-8 tracking-widest no-wrap">
            The Choir Organ
          </div>
        </div>

        <!-- Target for individual routes to inject their tools -->
        <div id="main-toolbar-portal" class="row items-center col no-wrap q-electron-drag" />

        <q-space />
        <div v-if="$route.path === '/'" class="row items-center no-wrap">
          <div class="text-caption text-grey-6 font-cinzel row items-center q-mr-md no-wrap gt-xs">
            <span class="opacity-50">Sacred Music Library</span>
            <span v-if="appVersion" class="text-grey-9 q-ml-sm">v{{ appVersion }}</span>
          </div>

          <q-btn flat round icon="mdi-help-circle-outline" color="amber-8" size="sm" class="q-mr-md">
            <q-tooltip>Help & Walkthrough</q-tooltip>
            <q-menu dark class="bg-grey-10 text-amber">
              <q-list style="min-width: 150px">
                <q-item clickable v-close-popup @click="walkthroughStore.start(organStore)">
                  <q-item-section avatar><q-icon name="mdi-compass" /></q-item-section>
                  <q-item-section>Start Guided Tour</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="showHelp = true">
                  <q-item-section avatar><q-icon name="mdi-information" /></q-item-section>
                  <q-item-section>Quick Info Dialog</q-item-section>
                </q-item>
                <q-separator dark />
                <q-item clickable v-close-popup @click="debugStore.open()">
                  <q-item-section avatar><q-icon name="mdi-bug" color="red-5" /></q-item-section>
                  <q-item-section class="text-red-5">Debug Inspector</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </div>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- Global Right Drawer -->
    <q-drawer v-model="uiStore.rightDrawerOpen" side="right" bordered :width="drawerWidth" behavior="desktop">
      <CombinationManager v-if="uiStore.activeDrawer === 'combinations'" v-model="uiStore.selectedBank" />
      <RecordingManager v-else-if="uiStore.activeDrawer === 'recordings'" @toggle-recording="toggleRecording"
        :render-progress="exportStore.renderProgress" :is-rendering-export="exportStore.isRendering"
        :render-status="exportStore.renderStatus" />
      <TsunamiExportManager v-else-if="uiStore.activeDrawer === 'export'" />
      <SettingsManager v-else-if="uiStore.activeDrawer === 'settings'" @open-advanced="showAudioSettings = true" />
      <DebugDrawerContent v-else-if="uiStore.activeDrawer === 'debug'" />
    </q-drawer>

    <q-dialog :model-value="showAudioSettings" maximized @update:model-value="showAudioSettings = $event">
      <SharedAudioSettingsDialog :model-value="showAudioSettings" :organ-path="(route.query.file as string)"
        @apply="onAudioSettingsApplied" @update:model-value="showAudioSettings = $event" />
    </q-dialog>

    <HelpDialog v-model="showHelp" />
    <WalkthroughDrawer />
    <WalkthroughPointer />
  </q-layout>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import HelpDialog from 'src/components/HelpDialog.vue';
import WalkthroughDrawer from 'src/components/WalkthroughDrawer.vue';
import WalkthroughPointer from 'src/components/WalkthroughPointer.vue';
import { useWalkthroughStore } from 'src/stores/walkthrough';
import { useOrganStore } from 'src/stores/organ';
import { useDebugStore } from 'src/stores/debug';
import { useUIStore } from 'src/stores/ui';
import { useExportStore } from 'src/stores/export';
import { useRoute } from 'vue-router';

// Managers
import CombinationManager from 'src/components/CombinationManager.vue';
import RecordingManager from 'src/components/RecordingManager.vue';
import TsunamiExportManager from 'src/components/TsunamiExportManager.vue';
import SettingsManager from 'src/components/SettingsManager.vue';
import DebugDrawerContent from 'src/components/DebugDrawerContent.vue';
import SharedAudioSettingsDialog from 'src/components/SharedAudioSettingsDialog.vue';

import { Dark } from 'quasar';

Dark.set(true);

const appVersion = ref('');
const showHelp = ref(false);
const showAudioSettings = ref(false);
const walkthroughStore = useWalkthroughStore();
const debugStore = useDebugStore();
const organStore = useOrganStore();
const uiStore = useUIStore();
const exportStore = useExportStore();
const route = useRoute();

const platform = (window as any).myApi?.platform || 'darwin';

const minimize = () => (window as any).myApi?.minimize();
const toggleMaximize = () => (window as any).myApi?.toggleMaximize();
const close = () => (window as any).myApi?.close();
const drawerWidth = ref(300);
const isFullscreen = ref(false);

onMounted(async () => {
  if ((window as any).myApi?.getAppVersion) {
    appVersion.value = await (window as any).myApi.getAppVersion();
  }
  drawerWidth.value = 350;

  if ((window as any).myApi?.onWindowStateChanged) {
    (window as any).myApi.onWindowStateChanged((state: string) => {
      isFullscreen.value = state === 'fullscreen';
    });
  }
});

function toggleRecording() {
  if (organStore.isRecording) {
    organStore.stopRecording();
    uiStore.openDrawer('recordings');
  } else {
    organStore.startRecording();
  }
}

async function onAudioSettingsApplied(newState: any) {
  organStore.audioSettings = newState;
  try {
    await organStore.setReleaseMode(organStore.audioSettings.releaseMode);
    await organStore.setLoadingMode(organStore.audioSettings.loadingMode);
    await organStore.setReverbSettings(organStore.audioSettings.reverbLength, organStore.audioSettings.reverbMix);
    await organStore.saveInternalState();
    const file = route.query.file as string;
    if (file) await organStore.startOrgan(file);
  } catch (e) {
    console.error(e);
  } finally {
    showAudioSettings.value = false;
  }
}

watch(
  () => route.path,
  (newPath: string) => {
    if (newPath !== '/builder') {
      uiStore.rightDrawerOpen = false;
    }
  }
);
</script>

<style lang="scss">
:root {
  --right-drawer-width: 350px;
}

.main-layout {
  background: #050505;
  // height: 100%;
  // display: flex;
  // flex-direction: column;
  /* Ensure it fills the #q-app container */
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}

.tracking-widest {
  letter-spacing: 0.2em;
}

.mac-header-padding {
  padding-left: 90px;
  padding-top: 8px;
}

.control-btn {
  border-radius: 0;
}

.hover-red:hover {
  background: #e81123 !important;
  color: white !important;
}

.q-electron-drag {
  -webkit-app-region: drag;
}

.q-electron-drag .q-btn,
.q-electron-drag .q-field,
.q-electron-drag .q-checkbox,
.q-electron-drag .q-toggle,
.q-electron-drag .cursor-pointer:not(.q-electron-drag) {
  -webkit-app-region: no-drag;
}
</style>
