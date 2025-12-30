<template>
  <q-page class="organ-page text-white column no-wrap">
    <!-- Welcome Screen -->
    <div v-if="!organStore.organData" class="welcome-container full-height flex column flex-center">
      <div class="welcome-card q-pa-xl text-center shadow-24">
        <q-icon name="piano" size="64px" class="text-amber-8 q-mb-md" />
        <div class="text-h3 font-cinzel text-amber-9 q-mb-sm">The Choir Organ</div>
        <div class="text-subtitle1 font-cinzel text-grey-5 q-mb-xl tracking-wide">
          Advanced GrandOrgue & Tsunami Toolset
        </div>

        <q-btn color="amber-9" size="lg" label="Open ODF File" @click="() => organStore.loadOrgan()" icon="folder_open"
          class="font-cinzel q-px-xl q-py-sm" outline />

        <div v-if="organStore.recentFiles.length > 0" class="recent-list q-mt-xl text-left">
          <div class="text-overline text-grey-6 q-mb-sm text-center">Recently Opened</div>
          <q-list dark separator bordered class="rounded-borders bg-grey-10">
            <q-item v-for="file in organStore.recentFiles" :key="file" clickable v-ripple
              @click="organStore.loadOrgan(file)">
              <q-item-section avatar>
                <q-icon name="history" color="amber-7" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-amber-1 ellipsis">{{ getBasename(file) }}</q-item-label>
                <q-item-label caption class="text-grey-6 ellipsis query-path">{{ file }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <div class="q-mt-lg">
          <q-btn flat color="grey-6" label="Go to Tsunami Preview" @click="$router.push('/preview')"
            class="font-cinzel text-caption" />
        </div>
      </div>
    </div>

    <!-- Organ Console -->
    <div v-else class="organ-console column" style="flex: 1 1 auto">
      <!-- Info Header (Fixed Height) -->
      <div class="console-header row items-center justify-between q-py-md q-px-md col-auto">
        <q-btn flat round icon="arrow_back" color="grey-6" @click="organStore.organData = null" class="q-mr-md" />
        <div class="text-h4 font-cinzel text-amber-8 text-shadow">{{ organStore.organData.name }}</div>

        <div class="row items-center q-gutter-x-lg">
          <div class="status-indicator row items-center q-gutter-x-sm">
            <q-icon name="circle" :color="midiColor" size="12px" />
            <span class="text-caption text-uppercase tracking-wide">MIDI {{ organStore.midiStatus }}</span>
          </div>

          <q-separator vertical color="grey-9" />

          <q-toggle v-model="organStore.isTsunamiMode" @update:model-value="organStore.setTsunamiMode" color="amber"
            label="Simulate Tsunami" dense left-label class="text-caption font-cinzel q-mr-md" />

          <q-toggle v-model="organStore.useReleaseSamples" @update:model-value="organStore.setUseReleaseSamples"
            color="blue-4" label="Release Samples" dense left-label class="text-caption font-cinzel" />

          <div class="row q-gutter-sm">
            <q-btn flat icon="file_open" @click="organStore.importFromJSON"><q-tooltip>Open Combination
                File</q-tooltip></q-btn>
            <q-btn rounded label="Save" color="green-4" icon="save" @click="organStore.exportToJSON" />
          </div>
        </div>
      </div>

      <!-- Main Body (Flex Row taking remaining height) -->
      <div class="console-body col row no-wrap overflow-hidden">

        <!-- Left: Stops Area (Scrollable) -->

        <q-scroll-area style="height: 100%" class="col q-pa-lg">
          <div v-for="manual in organStore.organData.manuals" :key="manual.id" class="col-12 q-mb-md">
            <div class="manual-section q-pa-md">
              <div class="manual-name font-cinzel text-h6 text-amber-7 q-mb-lg text-center border-bottom-amber">
                {{ manual.name }}
              </div>
              <div class="stops-grid row justify-center q-gutter-md">
                <template v-for="stopId in manual.stopIds" :key="`${manual.id}-${stopId}`">
                  <Drawknob v-if="organStore.organData.stops[stopId]" :name="organStore.organData.stops[stopId].name"
                    :pitch="getStopPitch(organStore.organData.stops[stopId])"
                    :active="organStore.currentCombination.includes(stopId)"
                    :volume="organStore.stopVolumes[stopId] || 100" @toggle="organStore.toggleStop(stopId)"
                    @update:volume="organStore.setStopVolume(stopId, $event)" />
                </template>
              </div>
            </div>
          </div>
        </q-scroll-area>

        <!-- Right: Sidebar (Fixed Width, Flex Column) -->
        <div class="col-auto bg-dark-sidebar column no-wrap border-left" style="width: 350px;">
          <div class="q-pa-md bg-header-gradient border-bottom-amber"
            style="display: flex; flex-direction: row; align-items: center;">
            <q-btn round label="GC" unelevated color="white" text-color="black" @click="organStore.clearCombination">
              <q-tooltip>General Cancel</q-tooltip>
            </q-btn>
            <div class="col">
              <div class="text-h6 font-cinzel text-amber-9 text-center">Combinations</div>
              <div class="text-caption text-grey-6 text-center">
                {{ organStore.banks.length }} / 32 Banks Used
              </div>
            </div>
          </div>

          <!-- Scrollable Bank List -->
          <q-scroll-area class="col"
            :thumb-style="{ width: '5px', borderRadius: '5px', background: '#d4af37', opacity: 0.5 }">
            <q-list dark separator class="bank-list">
              <q-item v-for="(bank, index) in organStore.banks" :key="bank.id" clickable v-ripple
                :active="selectedBank === index" active-class="bank-active" class="bank-item q-py-sm"
                @click="selectBank(index)">
                <q-item-section side>
                  <div class="column q-gutter-xs">
                    <q-btn flat dense role="img" icon="keyboard_arrow_up" size="xs" color="grey-6"
                      @click.stop="organStore.moveBank(index, index - 1)" :disable="index === 0" />
                    <q-btn flat dense role="img" icon="keyboard_arrow_down" size="xs" color="grey-6"
                      @click.stop="organStore.moveBank(index, index + 1)"
                      :disable="index === organStore.banks.length - 1" />
                  </div>
                </q-item-section>

                <q-item-section>
                  <q-item-label class="text-amber-1 font-cinzel row items-center">
                    {{ bank.name }}
                    <q-popup-edit v-model="bank.name" auto-save v-slot="scope" class="bg-grey-10 text-amber">
                      <q-input v-model="scope.value" dense autofocus counter @keyup.enter="scope.set" dark color="amber"
                        label="Rename Bank" />
                    </q-popup-edit>
                    <q-icon name="edit" size="xs" color="grey-8"
                      class="q-ml-sm cursor-pointer opacity-50 hover-opacity-100" />
                  </q-item-label>
                  <q-item-label caption class="text-grey-5">{{ bank.combination.length }} Stops</q-item-label>
                </q-item-section>

                <q-item-section side>
                  <q-btn flat round dense icon="delete" color="red-9" size="sm"
                    @click.stop="organStore.deleteBank(index)" />
                </q-item-section>
              </q-item>

              <div v-if="organStore.banks.length === 0" class="text-center text-grey-8 q-pa-lg italic text-caption">
                No banks saved. Set stops and click "Add Bank".
              </div>
            </q-list>
          </q-scroll-area>

          <!-- Bottom Action Area (Fixed) -->
          <div class="q-pa-md bg-dark-sidebar border-top-amber column q-gutter-y-sm shadow-up-10" style="z-index: 5;">
            <div class="row q-gutter-x-sm">
              <q-btn color="amber" text-color="black" icon-right="add" label="Save to New"
                class="col font-cinzel text-caption" :disable="organStore.banks.length >= 32" @click="addNewBank">
                <q-tooltip v-if="organStore.banks.length >= 32">Bank limit reached (32)</q-tooltip>
              </q-btn>

              <q-btn color="grey-9" text-color="grey-5" icon-right="backspace" label="Overwrite"
                class="col font-cinzel text-caption" outline :disable="!organStore.banks[selectedBank]"
                @click="organStore.saveToBank(selectedBank)" />
            </div>

            <q-separator color="grey-9" class="q-my-sm" />

            <div class="row q-gutter-x-sm">
              <!-- <q-btn color="red-10" label="Render" class="col font-cinzel q-py-sm shadow-10"
                :loading="organStore.isRendering" :disable="!organStore.banks[selectedBank]"
                @click="organStore.renderBank(selectedBank)">
                <template v-slot:loading>Mixing...</template>
              </q-btn> -->

              <q-btn color="red-10" label="Burn to Card" class="col font-cinzel q-py-sm shadow-10"
                :loading="organStore.isRendering" :disable="organStore.banks.length === 0"
                @click="organStore.renderAll()" icon-right="sd_card">
                <!-- <template v-slot:loading>Rendering...</template> -->
              </q-btn>
            </div>

            <div v-if="organStore.isRendering" class="q-mt-sm">
              <div class="text-caption text-amber text-center q-mb-xs">
                {{ organStore.renderStatus || 'Rendering...' }}
              </div>
              <q-linear-progress :value="organStore.renderProgress" color="amber" size="8px" rounded class="q-mb-sm" />
              <div class="row items-center justify-between">
                <div class="text-xs text-grey-6">{{ Math.round(organStore.renderProgress * 100) }}%</div>
                <q-btn flat dense color="red-5" label="Cancel" size="sm" icon="close"
                  @click="organStore.cancelRendering" />
              </div>
            </div>

            <div v-if="!organStore.isRendering"
              class="output-dir-area q-mt-sm q-pa-sm rounded-borders bg-black-50 border-amber-muted">
              <div class="row items-center justify-between q-mb-xs">
                <div class="text-overline text-amber-9" style="line-height:1">SD Card Location</div>
                <q-btn flat dense color="amber-7" icon="folder_open" size="xs" @click="organStore.setOutputDir">
                  <q-tooltip>Change Directory</q-tooltip>
                </q-btn>
              </div>
              <div class="text-caption text-grey-5 ellipsis dir-path">
                {{ organStore.outputDir || 'Not selected' }}
                <q-tooltip>{{ organStore.outputDir || 'Click icon to select folder' }}</q-tooltip>
              </div>
            </div>

            <div v-if="organStore.outputDir && !organStore.isRendering"
              class="row items-center justify-between q-px-sm bg-green-10 rounded-borders animate-fade q-py-xs q-mt-sm">
              <div class="text-caption text-white">Ready</div>
              <q-btn flat dense color="white" label="Preview Folder" size="sm"
                @click="$router.push({ path: '/preview', query: { folder: organStore.outputDir } })" />
            </div>
          </div>
        </div>

      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import Drawknob from 'src/components/Drawknob.vue';

const organStore = useOrganStore();
const selectedBank = ref(-1);

function selectBank(index: number) {
  selectedBank.value = index;
  organStore.loadBank(index);
}

function addNewBank() {
  if (organStore.addBank()) {
    // Auto-select new bank
    selectedBank.value = organStore.banks.length - 1;
  }
}

const midiColor = computed(() => {
  if (organStore.midiStatus === 'Connected') return 'green-5';
  if (organStore.midiStatus === 'Error') return 'red-5';
  return 'grey-7';
});

function getStopPitch(stop: any) {
  if (!stop) return '8\'';
  const match = stop.name.match(/\d+'/);
  return match ? match[0] : '8\'';
}

function getBasename(path: string) {
  if (!path || typeof path !== 'string') return '';
  // Basic basename logic for display
  return path.split(/[\\/]/).pop() || path;
}

onMounted(() => {
  organStore.fetchRecents();
  if (organStore.organData) {
    organStore.initMIDI();
  }
});

onUnmounted(() => {
  organStore.stopMIDI();
});

// Auto-save logic
import { watch } from 'vue';
watch(
  () => [organStore.banks, organStore.stopVolumes, organStore.useReleaseSamples, organStore.outputDir],
  () => {
    if (organStore.organData && !organStore.isRestoring) {
      organStore.saveInternalState();
    }
  },
  { deep: true }
);

function goToPreview() {
  if (organStore.outputDir) {
    // We can pass it via query prop if we want, or store it in a global/store that Tsunami page reads.
    // But the previous request asked to "pass the folder path".
    // Let's use query param for explicitness, or rely on store persistence if Tsunami page reads it?
    // Tsunami page currently reads `folderPath` ref. Let's update Tsunami page to read store or query.
    // Actually, Tsunami Page is separate. Let's pass it in query.
    // Wait, Tsunami page doesn't read query yet. Let's add that next.
    // For now, let's just push to /preview?path=...
    // But path might be long.
    // Let's rely on the store having `outputDir`.
    // organStore.outputDir is already persistent!
    // So just navigating is enough, IF Tsunami page checks the store.

    // Let's update Tsunami page to check organStore.outputDir on mount if local folderPath is empty.
  }
  // But user asked to "update the preview button... to pass the folder path".
  // I'll update the router push to include query for robustness.
  /* $router.push({ path: '/preview', query: { folder: organStore.outputDir } }) */
}
</script>

<style lang="scss" scoped>
.organ-page {
  background: radial-gradient(circle at center, #111 0%, #050505 100%);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1 1 100%;
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}

.text-shadow {
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}

.tracking-wide {
  letter-spacing: 0.1em;
}

.welcome-card {
  background: rgba(20, 20, 20, 0.6);
  backdrop-filter: blur(10px);
  border: 1px solid #333;
  border-radius: 24px;
  width: 600px;
  max-width: 90vw;
}

.recent-list {
  width: 100%;
}

.organ-console {
  background: #080808;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7));
  /* Optional texture placeholder */
  background-size: cover;
}

.console-header {
  background: linear-gradient(to bottom, #111, #080808);
  border-bottom: 4px solid #332211;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
  z-index: 10;
}

.manual-section {
  background: rgba(30, 25, 20, 0.9);
  border-radius: 8px;
  border: 1px solid #443322;
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.8);
}

.border-bottom-amber {
  border-bottom: 2px solid #664422;
  display: inline-block;
}

.control-panel {
  background: #151515;
  border: 1px solid #333;
  border-radius: 12px;
}

.bank-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.bank-btn {
  border: 1px solid #333;
  border-radius: 4px;
  background: #222;
  color: #888;

  &:hover {
    background: #333;
    border-color: #555;
  }

  &.is-active {
    border-color: #d4af37;
    color: #d4af37;
    background: rgba(212, 175, 55, 0.1);
  }

  &.has-data {
    border-left: 3px solid #2e7d32;
  }
}

.bank-active {
  background: rgba(212, 175, 55, 0.15);
  border: 1px solid #d4af37;
  border-radius: 4px;
}

.opacity-50 {
  opacity: 0.5;
}

.hover-opacity-100:hover {
  opacity: 1;
}

.bg-dark-sidebar {
  background: #0f0f0f;
}

.border-left {
  border-left: 2px solid #332211;
}

.border-top-amber {
  border-top: 1px solid #443322;
}

.bg-header-gradient {
  background: linear-gradient(to bottom, #1a1a1a, #0f0f0f);
}

.opacity-50 {
  opacity: 0.5;
}

.hover-opacity-100:hover {
  opacity: 1;
}

.bg-black-50 {
  background: rgba(0, 0, 0, 0.5);
}

.border-amber-muted {
  border: 1px solid rgba(212, 175, 55, 0.2);
}

.dir-path {
  font-family: monospace;
  font-size: 10px;
  opacity: 0.7;
}

.output-dir-area {
  transition: all 0.3s ease;

  &:hover {
    border-color: rgba(212, 175, 55, 0.5);
    background: rgba(0, 0, 0, 0.7);
  }
}
</style>
