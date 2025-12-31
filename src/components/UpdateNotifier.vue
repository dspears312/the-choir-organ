<template>
  <q-dialog v-model="show" persistent position="bottom">
    <q-card class="update-card bg-primary text-white">
      <q-card-section class="row items-center no-wrap">
        <div>
          <div class="text-weight-bold">{{ title }}</div>
          <div class="text-caption">{{ message }}</div>
          <q-linear-progress v-if="downloading" :value="progress" class="q-mt-sm" color="white" />
        </div>

        <q-space />

        <div class="row q-gutter-sm">
          <!-- Manual Update Path (Default) -->
          <q-btn flat label="Download from GitHub" @click="downloadManual" />

          <!-- Auto-Update Path (Disabled for now due to signing issues) -->
          <!-- 
          <q-btn v-if="canInstall" flat label="Restart Now" @click="install" />
          <q-btn v-else-if="canDownload" flat label="Download" :loading="downloading" @click="download" />
          -->

          <q-btn flat icon="close" v-close-popup v-if="!downloading" />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const show = ref(false);
const title = ref('');
const message = ref('');
const progress = ref(0);
const downloading = ref(false);
const canDownload = ref(false);
const canInstall = ref(false);

let unsubs: Array<() => void> = [];

onMounted(() => {
  if (!(window as any).myApi) return;

  unsubs.push((window as any).myApi.onUpdateAvailable((info: any) => {
    title.value = 'Update Available';
    message.value = `Version ${info.version} is available. Download the new version from GitHub.`;
    canDownload.value = true;
    canInstall.value = false;
    show.value = true;
  }));

  unsubs.push((window as any).myApi.onUpdateDownloadProgress((progressObj: any) => {
    downloading.value = true;
    progress.value = progressObj.percent / 100;
    message.value = `Downloading... ${Math.round(progressObj.percent)}%`;
  }));

  unsubs.push((window as any).myApi.onUpdateDownloaded((info: any) => {
    downloading.value = false;
    canDownload.value = false;
    canInstall.value = true;
    title.value = 'Update Ready';
    message.value = `Version ${info.version} has been downloaded. Restart to apply.`;
    show.value = true;
  }));

  unsubs.push((window as any).myApi.onUpdateError((err: string) => {
    downloading.value = false;
    $q.notify({
      type: 'negative',
      message: `Update Check Error: ${err}`
    });
  }));
});

onUnmounted(() => {
  unsubs.forEach(unsub => unsub());
});

async function downloadManual() {
  await (window as any).myApi.openExternalUrl('https://github.com/dspears312/the-choir-organ/releases');
  show.value = false;
}

// Keep these for future use when code signing is implemented
async function download() {
  await (window as any).myApi.downloadUpdate();
}

function install() {
  (window as any).myApi.quitAndInstall();
}
</script>

<style scoped>
.update-card {
  min-width: 400px;
  max-width: 90vw;
  border-radius: 8px;
}
</style>
