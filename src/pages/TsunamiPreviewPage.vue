<template>
  <q-page class="tsunami-preview-page text-white column no-wrap">
    <!-- Toolbar Portal -->
    <Teleport to="#main-toolbar-portal">
      <div class="row no-wrap items-center col">
        <q-btn flat round icon="arrow_back" color="grey-6" @click="$router.push('/')" class="q-mr-md" />
        <div class="text-h6 font-cinzel text-amber-8 text-shadow q-mr-lg gt-sm">Tsunami Board Preview</div>

        <div class="row items-center q-gutter-x-lg">
          <div id="midi-status-preview"
            class="status-indicator row items-center q-gutter-x-xs cursor-pointer hover-opacity-100"
            @click="organStore.initMIDI" :class="{ 'opacity-50': organStore.midiStatus !== 'Connected' }">
            <q-icon name="circle" :color="midiStatusColor" size="12px" />
            <span class="text-caption text-uppercase tracking-wide">MIDI {{ organStore.midiStatus }}</span>
            <q-tooltip class="bg-grey-10 text-amber shadow-4">
              <div v-if="organStore.midiStatus === 'Connected'">MIDI Connected & Ready</div>
              <div v-else-if="organStore.midiStatus === 'Error'">
                <strong>MIDI Error:</strong> {{ organStore.midiError || 'Unknown Error' }}<br />
                Click to retry connection
              </div>
              <div v-else>MIDI Disconnected. Click to retry connection.</div>
            </q-tooltip>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Main Body (Flex Row) -->
    <div class="console-body col row no-wrap overflow-hidden">
      <!-- Left: Sidebar Controls (Fixed Width) -->
      <div class="col-auto bg-dark-sidebar column no-wrap border-right" style="width: 350px;">
        <div class="q-pa-md col column no-wrap">
          <div class="col-auto">
            <!-- <div class="text-h6 q-mb-md text-amber font-cinzel text-center border-bottom-amber">Folder Configuration
            </div> -->

            <!-- Drive Picker -->
            <div class="q-mb-md">
              <div class="text-caption text-grey-6 q-mb-xs">Source Device</div>
              <div v-if="organStore.availableDrives.length > 0" class="drive-picker q-gutter-y-xs">
                <div v-for="drive in organStore.availableDrives" :key="drive.mountPoint"
                  class="drive-item q-pa-sm rounded-borders cursor-pointer row items-center no-wrap"
                  :class="{ 'drive-selected': folderPath === drive.mountPoint }" @click="selectDrive(drive)">
                  <q-icon
                    :name="(drive.volumeName === 'TCO' || drive.volumeName === organStore.targetVolumeLabel) ? 'sd_card' : 'usb'"
                    :color="(drive.volumeName === 'TCO' || drive.volumeName === organStore.targetVolumeLabel) ? 'amber' : 'grey-5'"
                    size="sm" class="q-mr-sm" />
                  <div class="col overflow-hidden">
                    <div class="text-caption text-weight-bold ellipsis">{{ drive.volumeName || 'Untitled' }}</div>
                    <div class="text-xs text-grey-6 ellipsis">{{ drive.mountPoint }}</div>
                  </div>
                  <q-icon v-if="folderPath === drive.mountPoint" name="check_circle" color="amber" size="xs" />
                </div>
              </div>
              <div v-else class="q-pa-md bg-black-50 rounded-borders text-center border-amber-muted">
                <q-icon name="info" color="grey-7" size="sm" class="q-mb-xs" />
                <div class="text-xs text-grey-6 italic">No removable drives detected</div>
              </div>

              <q-btn color="grey" label="Select Local Folder" icon="folder_open"
                class="full-width q-mt-md text-amber-7 font-cinzel text-caption" outline @click="selectFolder" />
            </div>
          </div>

          <!-- Active Path (Hidden if matching a drive) -->
          <div v-if="folderPath && isLocalFolder" class="folder-shelf q-pa-sm rounded-borders q-mb-md col-auto">
            <div v-if="route.query.folder" class="row items-center justify-between q-mb-xs">
              <div class="text-caption text-grey-6">Active Path:</div>
              <q-btn flat dense icon="refresh" color="grey-6" size="sm" @click="scanForBanks">
                <q-tooltip>Refresh Folder</q-tooltip>
              </q-btn>
            </div>
            <div v-else class="text-caption text-grey-6">Active Path:</div>

            <div class="row items-center no-wrap">
              <div class="text-xs text-amber break-all dir-path col">{{ folderPath }}</div>
              <q-btn v-if="!route.query.folder" flat round dense icon="refresh" color="grey-6" size="sm"
                @click="scanForBanks" class="q-ml-xs">
                <q-tooltip>Refresh Folder</q-tooltip>
              </q-btn>
            </div>
          </div>

          <!-- Bank Selector - Expanded to Fill Height -->
          <div v-if="folderPath && availableBanks.length > 0" class="col column no-wrap q-mt-sm">
            <div class="text-caption text-grey-6 q-mb-xs">Select Bank:</div>
            <div
              class="bank-list-container bg-black rounded-borders overflow-hidden border-amber-muted col column no-wrap">
              <q-scroll-area class="col"
                :thumb-style="{ width: '4px', borderRadius: '4px', background: '#d4af37', opacity: '0.4' }">
                <q-list dark padding dense class="q-py-none">
                  <q-item v-for="b in availableBanks" :key="b" clickable v-ripple :active="selectedBank === b"
                    active-class="bank-item-active" class="bank-item-dense" @click="selectedBank = b">
                    <q-item-section avatar class="min-width-auto q-pr-sm">
                      <div class="bank-index-label">{{ b }}</div>
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-xs ellipsis">{{ bankNames[b] || `Bank ${b}` }}</q-item-label>
                    </q-item-section>
                    <q-item-section side v-if="selectedBank === b">
                      <q-icon name="play_arrow" color="amber" size="xs" />
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-scroll-area>
            </div>
          </div>
          <div v-else-if="folderPath && !processingMessage" class="text-caption text-red-5 q-mt-sm italic col-auto">
            No valid bank files found (NNNN.wav)
          </div>

          <!-- Voice counters at bottom -->
          <div class="q-mt-auto q-pt-md">
            <div class="row q-col-gutter-md">
              <div class="col-6">
                <div class="stat-box-mini text-center shadow-24">
                  <div class="text-h4 text-amber-7 font-cinzel">{{ activeNotes.size }}</div>
                  <div class="text-caption text-grey-6 text-uppercase tracking-widest" style="font-size: 0.6rem;">
                    Voices</div>
                </div>
              </div>
              <div class="col-6">
                <div class="stat-box-mini text-center shadow-24">
                  <div class="text-h4 font-cinzel" :class="activeNotes.size >= 16 ? 'text-red-8' : 'text-blue-8'">
                    16</div>
                  <div class="text-caption text-grey-6 text-uppercase tracking-widest" style="font-size: 0.6rem;">
                    Max Limit</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Main Playback Area (Scrollable Visualizer) -->
      <div class="col column no-wrap overflow-hidden bg-black">
        <q-scroll-area class="col q-pa-xl">
          <div class="preview-container max-width-center">
            <div class="row items-center q-mb-xl">
              <div class="column">
                <div class="text-h4 text-amber-8 font-cinzel q-mb-xs">Real-time Note Monitor</div>
                <div class="text-caption text-grey-7" v-if="folderPath">
                  Monitoring: <span class="text-amber">{{ bankNames[selectedBank] || `Bank ${selectedBank}`
                  }}</span>
                  <span class="q-ml-sm opacity-50">(On-Demand Loading)</span>
                </div>
              </div>
              <q-space />
              <div v-if="folderPath" class="text-green-5 row items-center">
                <span class="text-overline text-weight-bold">Ready</span>
              </div>
              <div v-else-if="processingMessage" class="text-amber-5 row items-center animate-pulse">
                <span class="text-overline">{{ processingMessage }}</span>
                <q-spinner-dots class="q-ml-sm" size="sm" />
              </div>
              <div v-else class="text-grey-7 italic">Waiting for folder selection...</div>
            </div>

            <div id="note-monitor" class="note-visualizer-container bg-dark-panel rounded-borders shadow-inset q-pa-xl">
              <div class="text-center" v-if="!folderPath && !processingMessage">
                <q-icon name="queue_music" size="100px" color="grey-9" />
                <div class="text-h6 text-grey-8 q-mt-md font-cinzel">Select a Tsunami Render folder to start monitoring
                </div>
              </div>
              <div class="text-center" v-else-if="processingMessage">
                <q-spinner-puff size="100px" color="amber-8" />
                <div class="text-h6 text-amber-8 q-mt-md font-cinzel">{{ processingMessage }}</div>
              </div>
              <div v-else class="playback-grid">
                <div class="row q-gutter-md justify-center">
                  <div v-for="n in 61" :key="n" :class="{ 'note-active': activeNotes.has(35 + n) }" class="note-box">
                    <div class="note-id">{{ 35 + n }}</div>
                    <div class="track-label">{{ (n).toString().padStart(4, '0') }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </q-scroll-area>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import { tsunamiPlayer } from 'src/services/tsunami-player';
import { useRoute } from 'vue-router';

const organStore = useOrganStore();
const route = useRoute();

const folderPath = ref('');
const processingMessage = ref('');
const activeNotes = ref(new Set<number>());
const keysDown = new Set<number>();
const availableBanks = ref<number[]>([]);
const selectedBank = ref<number>(-1);
const bankNames = ref<Record<number, string>>({});

const isLocalFolder = computed(() => {
  if (!folderPath.value) return false;
  return !organStore.availableDrives.some(d => d.mountPoint === folderPath.value);
});

const midiStatusColor = computed(() => {
  if (organStore.midiStatus === 'Connected') return 'green-5';
  if (organStore.midiStatus === 'Error') return 'red-5';
  return 'grey-7';
});

let drivePollInterval: any = null;

onMounted(async () => {
  // Disable synth while in Tsunami Preview mode
  organStore.isSynthEnabled = false;

  // Start drive polling if not already started
  organStore.fetchDrives();
  drivePollInterval = setInterval(() => {
    organStore.fetchDrives();
  }, 5000);

  // Initialize MIDI via global store
  await organStore.initMIDI();

  // Attach our own listener for Tsunami playback
  attachMidiListeners();

  // Watch for MIDI access changes (e.g. reconnect)
  watch(() => organStore.midiAccess, () => {
    attachMidiListeners();
  });

  // Auto-load from query or store outputDir
  const queryFolder = route.query.folder as string;
  if (queryFolder) {
    folderPath.value = queryFolder;
  } else if (organStore.outputDir) {
    folderPath.value = organStore.outputDir;
  }
});

function attachMidiListeners() {
  if (organStore.midiAccess) {
    organStore.midiAccess.inputs.forEach(input => {
      input.removeEventListener('midimessage', handleMIDI);
      input.addEventListener('midimessage', handleMIDI);
    });
  }
}

async function selectFolder() {
  const result = await (window as any).myApi.selectFolder();
  if (result) {
    folderPath.value = result;
  }
}

function selectDrive(drive: any) {
  folderPath.value = drive.mountPoint;
}

async function scanForBanks() {
  if (!folderPath.value) return;
  processingMessage.value = 'Indexing banks...';
  try {
    const files = await (window as any).myApi.listDir(folderPath.value);
    const bankSet = new Set<number>();
    files.forEach((f: string) => {
      const match = f.match(/^(\d{4})\.wav$/i);
      if (match) {
        const trackNum = parseInt(match[1] as string, 10);
        const bankNum = Math.floor(trackNum / 128);
        bankSet.add(bankNum);
      }
    });
    availableBanks.value = Array.from(bankSet).sort((a, b) => a - b);

    // Load bank names from tco.txt
    const tcoPath = `${folderPath.value}/tco.txt`;
    const tcoContent = await (window as any).myApi.readTextFile(tcoPath);
    if (tcoContent) {
      const names: Record<number, string> = {};
      tcoContent.split('\n').forEach((line: string) => {
        const match = line.match(/^(\d+):\s*(.*)$/);
        if (match) {
          names[parseInt(match[1] as string, 10)] = match[2] as string;
        }
      });
      bankNames.value = names;
    }

    if (availableBanks.value.length > 0 && selectedBank.value === -1) {
      selectedBank.value = availableBanks.value[0] as number;
    }
  } finally {
    processingMessage.value = '';
  }
}

watch(folderPath, () => {
  if (folderPath.value) {
    scanForBanks();
  }
});

watch(selectedBank, () => {
  // Clearing cache is no longer needed with streaming slots
});

async function handleMIDI(event: any) {
  if (!folderPath.value) return;
  const [status, note, velocity] = event.data;
  const type = status & 0xf0;

  const fileNum = note + (selectedBank.value * 128);
  const key = fileNum.toString();

  if (type === 144 && velocity > 0) {
    keysDown.add(note);
    activeNotes.value.add(note);

    const fileName = `${fileNum.toString().padStart(4, '0')}.wav`;
    const fullPath = `${folderPath.value}/${fileName}`;

    // On-demand stream (Simulates hardware streaming)
    tsunamiPlayer.playNote(note, fullPath);
  } else if (type === 128 || (type === 144 && velocity === 0)) {
    keysDown.delete(note);
    tsunamiPlayer.stopNote(note);
    setTimeout(() => {
      if (!keysDown.has(note)) {
        activeNotes.value.delete(note);
      }
    }, 50);
  }
}

onUnmounted(() => {
  // Re-enable synth
  organStore.isSynthEnabled = true;

  if (drivePollInterval) {
    clearInterval(drivePollInterval);
  }

  if (organStore.midiAccess) {
    organStore.midiAccess.inputs.forEach(input => {
      input.removeEventListener('midimessage', handleMIDI);
    });
  }
  tsunamiPlayer.clearAll();
});
</script>

<style lang="scss" scoped>
.tsunami-preview-page {
  background: radial-gradient(circle at center, #111 0%, #050505 100%);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1 1 100%;
}

.console-header {
  background: linear-gradient(to bottom, #111, #080808);
  border-bottom: 4px solid #332211;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
  z-index: 10;
}

.bg-dark-sidebar {
  background: #0f0f0f;
}

.bg-dark-panel {
  background: #080808;
}

.border-right {
  border-right: 2px solid #332211;
}

.border-bottom-amber {
  border-bottom: 2px solid #664422;
  display: inline-block;
  width: 100%;
}

.border-amber-muted {
  border: 1px solid rgba(212, 175, 55, 0.2);
}

.folder-shelf {
  background: #000;
  border-left: 4px solid #d4af37;
}

.note-visualizer-container {
  min-height: 450px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #222;
}

.shadow-inset {
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.9);
}

.note-box {
  width: 50px;
  height: 60px;
  background: #111;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid #222;
  transition: all 0.1s ease;

  .note-id {
    font-size: 0.8rem;
    color: #d4af37;
    font-weight: bold;
  }

  .track-label {
    font-size: 0.6rem;
    color: #555;
    margin-top: 4px;
    font-family: monospace;
  }

  &.note-active {
    background: #d4af37;
    border-color: #fff;
    box-shadow: 0 0 20px rgba(212, 175, 55, 0.6);

    .note-id {
      color: #000;
    }

    .track-label {
      color: #000;
      opacity: 0.7;
    }
  }
}

.stat-box-mini {
  padding: 12px;
  background: #0a0a0a;
  border-radius: 8px;
  border: 1px solid #332211;
}

.bank-list-container {
  background: #050505;
}

.bank-item-dense {
  border-bottom: 1px solid #111;
  transition: all 0.2s ease;

  &:last-child {
    border-bottom: none;
  }

  &.bank-item-active {
    background: rgba(212, 175, 55, 0.2) !important;
    border-color: rgba(212, 175, 55, 0.4);

    .bank-index-label {
      background: #d4af37;
      color: black;
      box-shadow: 0 0 10px rgba(212, 175, 55, 0.5);
    }
  }
}

.bank-index-label {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  color: #ffb300;
  font-weight: bold;
}

.min-width-auto {
  min-width: unset;
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}

.text-shadow {
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}

.tracking-widest {
  letter-spacing: 0.2em;
}

.break-all {
  word-break: break-all;
}

.dir-path {
  font-family: monospace;
  opacity: 0.7;
}


.border-top {
  border-top: 1px solid #222;
}

.bg-black-50 {
  background: rgba(0, 0, 0, 0.5);
}

.max-width-center {
  max-width: 1200px;
  margin: 0 auto;
}

.drive-item {
  background: rgba(40, 40, 40, 0.4);
  border: 1px solid transparent;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(60, 60, 60, 0.6);
    border-color: #444;
  }

  &.drive-selected {
    background: rgba(212, 175, 55, 0.15);
    border-color: rgba(212, 175, 55, 0.5);
  }
}

.animate-fade {
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
