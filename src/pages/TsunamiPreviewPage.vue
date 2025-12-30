<template>
  <q-page class="tsunami-preview-page q-pa-lg text-white">
    <div class="row items-center q-mb-lg">
      <q-btn flat icon="arrow_back" label="Back to Organ Console" @click="$router.push('/')" color="amber"
        class="font-cinzel" />
      <q-space />
      <div class="text-h4 font-cinzel text-amber-9">Tsunami Board Previewer</div>
      <q-space />
      <q-badge :color="midiStatusColor" :label="`MIDI: ${organStore.midiStatus}`" class="q-px-md q-py-xs" />
    </div>

    <div class="row q-col-gutter-lg">
      <!-- Sidebar Controls -->
      <div class="col-12 col-md-4">
        <div class="preview-panel q-pa-md shadow-10">
          <div class="text-h6 q-mb-md text-amber font-cinzel">Folder Configuration</div>
          <q-btn color="amber" label="Select Rendered Folder" icon="folder_open" class="full-width q-mb-md text-black"
            @click="selectFolder" />

          <div v-if="folderPath" class="folder-shelf q-pa-sm rounded-borders q-mb-md">
            <div class="text-caption text-grey-4">Active Path:</div>
            <div class="text-subtitle2 text-amber break-all">{{ folderPath }}</div>

            <!-- Bank Selector -->
            <div v-if="availableBanks.length > 0" class="q-mt-sm border-top q-pt-sm">
              <div class="text-caption text-grey-4 q-mb-xs">Select Bank:</div>
              <div class="row q-gutter-xs">
                <div v-for="b in availableBanks" :key="b" class="bank-chip cursor-pointer"
                  :class="{ 'active': selectedBank === b }" @click="selectedBank = b">
                  {{ b }}
                </div>
              </div>
            </div>
            <div v-else class="text-caption text-red q-mt-sm">No valid bank files found (NNNN.wav)</div>
          </div>

          <div class="q-mt-xl">
            <div class="text-subtitle2 text-grey-5 q-mb-sm">Simulation Physics</div>
            <q-banner dense class="bg-grey-10 text-amber-2 rounded-borders q-mb-md">
              <template v-slot:avatar>
                <q-icon name="memory" />
              </template>
              32-voice hard polyphony cutoff (Tsunami Board accuracy).
            </q-banner>

            <q-list dark padding class="bg-black rounded-borders">
              <q-item-label header class="text-grey-7">Tsunami Rules</q-item-label>
              <q-item dense>
                <q-item-section avatar><q-icon name="check" color="green" size="xs" /></q-item-section>
                <q-item-section>Note 36 maps to Track 001_L1</q-item-section>
              </q-item>
              <q-item dense>
                <q-item-section avatar><q-icon name="check" color="green" size="xs" /></q-item-section>
                <q-item-section>Immediate hard voice stealing</q-item-section>
              </q-item>
            </q-list>
          </div>
        </div>
      </div>

      <!-- Main Playback Area -->
      <div class="col-12 col-md-8">
        <div class="preview-panel q-pa-lg shadow-20">
          <div class="row items-center q-mb-md">
            <div class="text-h5 text-amber font-cinzel">Real-time Note Monitor</div>
            <q-space />
            <div v-if="samplesLoaded" class="text-positive row items-center">
              <q-icon name="check_circle" class="q-mr-xs" /> Ready to Play
            </div>
            <div v-else class="text-grey-7">Waiting for folder...</div>
          </div>

          <div class="note-visualizer-container bg-black rounded-borders shadow-inset q-pa-xl">
            <div class="text-center" v-if="!samplesLoaded">
              <q-icon name="queue_music" size="100px" color="grey-9" />
              <div class="text-h6 text-grey-8 q-mt-md">Select a Tsunami Render folder to start monitoring</div>
            </div>
            <div v-else class="playback-grid">
              <div class="row q-gutter-md justify-center">
                <div v-for="n in 61" :key="n" :class="{ 'note-active': activeNotes.has(35 + n) }" class="note-box">
                  <div class="note-id">{{ 35 + n }}</div>
                  <div class="track-label">{{ (n).toString().padStart(3, '0') }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="q-mt-xl row items-center justify-center q-gutter-lg">
            <div class="stat-box text-center">
              <div class="text-h3 text-amber-7">{{ activeNotes.size }}</div>
              <div class="text-caption text-grey-6 uppercase">Active Voices</div>
            </div>
            <div class="stat-box text-center">
              <div class="text-h3" :class="activeNotes.size >= 32 ? 'text-red' : 'text-blue'">32</div>
              <div class="text-caption text-grey-6 uppercase">Polyphony Max</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import { tsunamiPlayer } from 'src/services/tsunami-player';

const organStore = useOrganStore();
const folderPath = ref('');
const samplesLoaded = ref(false);
const activeNotes = ref(new Set<number>());
const keysDown = new Set<number>(); // Physical key state
const availableBanks = ref<number[]>([]);
const selectedBank = ref<number>(0);

const midiStatusColor = computed(() => {
  if (organStore.midiStatus === 'Connected') return 'green';
  if (organStore.midiStatus === 'Error') return 'red';
  return 'grey-7';
});

import { useRoute } from 'vue-router';
const route = useRoute();

const midiAccess = ref<MIDIAccess | null>(null);

onMounted(async () => {
  if (navigator.requestMIDIAccess) {
    midiAccess.value = await navigator.requestMIDIAccess();
    midiAccess.value.inputs.forEach(input => {
      input.addEventListener('midimessage', handleMIDI);
    });
  }

  // Auto-load from query or store
  const queryFolder = route.query.folder as string;
  if (queryFolder) {
    folderPath.value = queryFolder;
    await scanForBanks();
    if (availableBanks.value.length > 0) {
      selectedBank.value = availableBanks.value[0] || 0;
      await loadTsunamiSamples();
    }
  }
});

async function selectFolder() {
  const result = await (window as any).myApi.selectFolder();
  if (result) {
    folderPath.value = result;
    await scanForBanks();
    if (availableBanks.value.length > 0) {
      selectedBank.value = availableBanks.value[0] || 0;
      await loadTsunamiSamples();
    }
  }
}

async function scanForBanks() {
  if (!folderPath.value) return;
  const files = await (window as any).myApi.listDir(folderPath.value) as string[];
  const banks = new Set<number>();

  files.forEach(file => {
    // Match NNNN.wav
    const match = file.match(/^(\d{4})\.wav$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      // Derive bank: floor(num / 128)
      const bank = Math.floor(num / 128);
      banks.add(bank);
    }
  });

  availableBanks.value = Array.from(banks).sort((a, b) => a - b);
}

watch(selectedBank, () => {
  if (folderPath.value) {
    loadTsunamiSamples();
  }
});

async function loadTsunamiSamples() {
  if (!folderPath.value) return;
  samplesLoaded.value = false;

  const promises = [];
  // For the selected bank, we load notes 36-96
  // File number = note + (bank * 128)
  const bankOffset = selectedBank.value * 128;

  for (let note = 36; note < 97; note++) {
    const fileNum = note + bankOffset;
    const fileName = `${fileNum.toString().padStart(4, '0')}.wav`;
    const fullPath = `${folderPath.value}/${fileName}`;

    // We load it with a key that is just the Note number, since we only play one bank at a time
    // ACTUALLY, to allow switching banks quickly, maybe we should cache everything?
    // But tsunamiPlayer is simple. Let's just key it by Note for the *current* bank.
    // Or better, key it by File Number to allow multiple banks loaded?
    // User requested "split them up into banks automatically... Add a bank selector".
    // If I select Bank 1, and press Note 36, I expect the sound for (36 + 128) to play.
    // So the key in the player should probably be the file number, or I need to update handleMIDI calls.
    // Let's use File Number as key.

    promises.push(tsunamiPlayer.loadSample(fileNum.toString(), fullPath));
  }

  await Promise.all(promises);
  samplesLoaded.value = true;
}

function handleMIDI(event: any) {
  if (!samplesLoaded.value) return;
  const [status, note, velocity] = event.data;
  const type = status & 0xf0;

  // Calculate target file number based on current bank
  const fileNum = note + (selectedBank.value * 128);
  const key = fileNum.toString();

  if (type === 144 && velocity > 0) {
    keysDown.add(note);
    tsunamiPlayer.playNote(note, key);
    activeNotes.value.add(note);
  } else if (type === 128 || (type === 144 && velocity === 0)) {
    keysDown.delete(note);
    tsunamiPlayer.stopNote(note);
    // Delay removal from UI to match 50ms fade-out
    setTimeout(() => {
      // Only delete if the note is not currently being played (pressed) again
      if (!keysDown.has(note)) {
        activeNotes.value.delete(note);
      }
    }, 50);
  }
}

onUnmounted(() => {
  if (midiAccess.value) {
    midiAccess.value.inputs.forEach(input => {
      input.removeEventListener('midimessage', handleMIDI);
    });
  }
  tsunamiPlayer.clearAll();
});
</script>

<style lang="scss" scoped>
.tsunami-preview-page {
  background: radial-gradient(circle at center, #111 0%, #050505 100%);
  min-height: 100%;
}

.preview-panel {
  background: rgba(40, 40, 40, 0.4);
  border: 1px solid #3d2b1f;
  border-radius: 16px;
  backdrop-filter: blur(10px);
}

.folder-shelf {
  background: #000;
  border-left: 4px solid #d4af37;
}

.note-visualizer-container {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
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

.stat-box {
  padding: 20px 40px;
  background: #000;
  border-radius: 12px;
  border: 1px solid #333;
}

.font-cinzel {
  font-family: 'Cinzel', serif;
}

.break-all {
  word-break: break-all;
}

.bank-chip {
  padding: 2px 8px;
  background: #222;
  border: 1px solid #444;
  border-radius: 4px;
  color: #888;
  font-size: 0.8rem;
  transition: all 0.2s;

  &:hover {
    border-color: #d4af37;
    color: #ddd;
  }

  &.active {
    background: #d4af37;
    color: #000;
    font-weight: bold;
    border-color: #d4af37;
  }
}

.border-top {
  border-top: 1px solid #222;
}
</style>
