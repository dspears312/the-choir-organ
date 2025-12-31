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
                  <!-- <div class="relative-position inline-block"> -->
                  <Drawknob v-if="organStore.organData.stops[stopId]"
                    :name="parseStopLabel(organStore.organData.stops[stopId].name).name"
                    :pitch="parseStopLabel(organStore.organData.stops[stopId].name).pitch"
                    :active="organStore.currentCombination.includes(stopId)"
                    :volume="organStore.stopVolumes[stopId] || 100" @toggle="organStore.toggleStop(stopId)"
                    @update:volume="organStore.setStopVolume(stopId, $event)">
                    <q-menu touch-position context-menu class="bg-grey-10 text-amber">
                      <q-list dense style="min-width: 150px">
                        <q-item clickable v-close-popup @click="openCreateVirtualStop(stopId)">
                          <q-item-section avatar><q-icon name="add_circle" color="green" /></q-item-section>
                          <q-item-section>Create Virtual stop</q-item-section>
                        </q-item>
                      </q-list>
                    </q-menu>
                  </Drawknob>
                  <!-- </div> -->

                  <Drawknob v-for="vs in getVirtualStopsFor(stopId)" :key="vs.id" :name="vs.name" :pitch="vs.pitch"
                    :active="organStore.currentCombination.includes(vs.id)"
                    :volume="organStore.stopVolumes[vs.id] || 100" :is-virtual="true"
                    @toggle="organStore.toggleStop(vs.id)" @update:volume="organStore.setStopVolume(vs.id, $event)"
                    @delete="organStore.deleteVirtualStop(vs.id)">
                    <q-menu touch-position context-menu class="bg-grey-10 text-amber">
                      <q-list dense style="min-width: 150px">
                        <q-item clickable v-close-popup @click="openEditVirtualStop(vs)">
                          <q-item-section avatar><q-icon name="edit" color="blue" /></q-item-section>
                          <q-item-section>Edit Virtual stop</q-item-section>
                        </q-item>
                        <q-item clickable v-close-popup @click="organStore.deleteVirtualStop(vs.id)">
                          <q-item-section avatar><q-icon name="delete" color="red" /></q-item-section>
                          <q-item-section>Delete Virtual stop</q-item-section>
                        </q-item>
                      </q-list>
                    </q-menu>
                  </Drawknob>
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
              <q-btn color="red-10" label="Burn to Card" class="col font-cinzel q-py-sm shadow-10"
                :loading="organStore.isRendering" :disable="organStore.banks.length === 0"
                @click="organStore.renderAll()" icon-right="sd_card">
              </q-btn>
            </div>

            <div v-if="organStore.isRendering" class="q-mt-sm">
              <div class="text-caption text-amber text-center q-mb-xs">
                {{ organStore.renderStatus || 'Rendering...' }}
              </div>
              <q-linear-progress :value="organStore.renderProgress" color="amber" size="8px" rounded
                class="q-linear-progress--animate" />
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

    <!-- Create/Edit Virtual Stop Dialog -->
    <q-dialog v-model="showVsDialog" persistent>
      <q-card dark style="min-width: 400px; background: #1a1a1a; border: 1px solid #444;" class="q-pa-sm">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6 font-cinzel text-amber">{{ vsForm.id ? 'Edit' : 'Create' }} Virtual Stop</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section class="q-pt-md column q-gutter-y-md">
          <q-input v-model="vsForm.name" label="Name" dark color="green" filled />
          <q-input v-model="vsForm.pitch" label="Pitch Label (e.g. 16')" dark color="green" filled />

          <div class="row q-col-gutter-sm">
            <div class="col-12 text-caption text-grey-5">Pitch Shift (Cents)</div>
            <div class="col-12">
              <q-input v-model.number="vsForm.pitchShift" type="number" dark filled color="green" dense />
            </div>

            <div class="col-12 text-caption text-grey-5">Harmonic Multiplier</div>
            <div class="col-12">
              <q-input v-model.number="vsForm.harmonicMultiplier" type="number" step="0.01" dark filled color="green"
                dense />
            </div>

            <div class="col-12 text-caption text-grey-5">Note Offset (Semitones)</div>
            <div class="col-12">
              <q-input v-model.number="vsForm.noteOffset" type="number" dark filled color="green" dense />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn :label="vsForm.id ? 'Save' : 'Create'" color="green" @click="saveVirtualStop" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import Drawknob from 'src/components/Drawknob.vue';
import { parseStopLabel } from 'src/utils/label-parser';

const organStore = useOrganStore();
const selectedBank = ref(-1);

// Virtual Stop logic
const showVsDialog = ref(false);
const vsForm = ref({
  id: undefined as string | undefined, // undefined for new, set for edit
  originalStopId: '',
  name: '',
  pitch: '',
  pitchShift: 0,
  harmonicMultiplier: 1.0,
  noteOffset: 0
});

function openCreateVirtualStop(stopId: string) {
  const stop = organStore.organData.stops[stopId];
  if (!stop) return;

  const { name, pitch } = parseStopLabel(stop.name);
  vsForm.value = {
    id: undefined,
    originalStopId: stopId,
    name: name + ' (V)',
    pitch: pitch,
    pitchShift: 0,
    harmonicMultiplier: 1.0,
    noteOffset: 0
  };
  showVsDialog.value = true;
}

function openEditVirtualStop(vs: any) {
  vsForm.value = {
    id: vs.id,
    originalStopId: vs.originalStopId,
    name: vs.name,
    pitch: vs.pitch,
    pitchShift: vs.pitchShift,
    harmonicMultiplier: vs.harmonicMultiplier,
    noteOffset: vs.noteOffset
  };
  showVsDialog.value = true;
}

function saveVirtualStop() {
  const vs = {
    id: vsForm.value.id || 'VIRT_' + crypto.randomUUID(),
    originalStopId: vsForm.value.originalStopId,
    name: vsForm.value.name,
    pitch: vsForm.value.pitch,
    pitchShift: vsForm.value.pitchShift,
    harmonicMultiplier: vsForm.value.harmonicMultiplier,
    noteOffset: vsForm.value.noteOffset
  };

  if (vsForm.value.id) {
    organStore.updateVirtualStop(vs);
  } else {
    organStore.addVirtualStop(vs);
  }
}

function getVirtualStopsFor(stopId: string) {
  return organStore.virtualStops.filter(v => v.originalStopId === stopId);
}

function selectBank(index: number) {
  selectedBank.value = index;
  organStore.loadBank(index);
}

function addNewBank() {
  if (organStore.addBank()) {
    selectedBank.value = organStore.banks.length - 1;
  }
}

const midiColor = computed(() => {
  if (organStore.midiStatus === 'Connected') return 'green-5';
  if (organStore.midiStatus === 'Error') return 'red-5';
  return 'grey-7';
});

function getStopPitch(stop: any) {
  return parseStopLabel(stop?.name || '').pitch;
}

function getBasename(path: string) {
  if (!path || typeof path !== 'string') return '';
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

watch(
  () => [organStore.banks, organStore.stopVolumes, organStore.useReleaseSamples, organStore.outputDir, organStore.virtualStops],
  () => {
    if (organStore.organData && !organStore.isRestoring) {
      organStore.saveInternalState();
    }
  },
  { deep: true }
);
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

.bank-active {
  background: rgba(212, 175, 55, 0.15);
  border: 1px solid #d4af37;
  border-radius: 4px;
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
