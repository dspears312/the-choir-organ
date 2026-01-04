<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" persistent>
    <q-card dark style="width: 700px; max-width: 90vw; background: #1a1a1a; border: 1px solid #d4af37;" class="q-pa-sm">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h5 font-cinzel text-amber-8">
          <q-icon name="mdi-help-circle-outline" class="q-mr-sm" />
          The Choir Organ: Help & Walkthrough
        </div>
        <q-space />
        <q-btn icon="mdi-close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="q-pa-md">
        <q-stepper v-model="step" vertical dark animated color="amber-8" class="bg-transparent" header-nav>
          <!-- Step 1: Welcome -->
          <q-step :name="1" title="Welcome to The Choir Organ" icon="mdi-piano" :done="step > 1">
            <div class="text-body1 q-mb-md">
              The Choir Organ is a professional tool for creating custom sound configurations for Tsunami hardware-based
              pipe organ playback systems.
            </div>
            <div class="text-grey-5">
              It processes GrandOrgue ODF files into high-performance Wav files optimized for SD card playback on
              Tsunami boards.
            </div>
          </q-step>

          <!-- Step 2: How it Works -->
          <q-step :name="2" title="The High-Level Flow" icon="mdi-file-tree" :done="step > 2">
            <div class="row q-gutter-md">
              <div class="col-12 col-md-auto">
                <div class="flow-item">
                  <q-icon name="mdi-folder-open" color="amber-7" size="sm" />
                  <span>1. Load ODF File</span>
                </div>
              </div>
              <div class="col-12 col-md-auto">
                <q-icon name="mdi-arrow-right" color="grey-7" size="xs" class="q-mt-xs gt-sm" />
              </div>
              <div class="col-12 col-md-auto">
                <div class="flow-item">
                  <q-icon name="mdi-magic-staff" color="amber-7" size="sm" />
                  <span>2. Create Banks</span>
                </div>
              </div>
              <div class="col-12 col-md-auto">
                <q-icon name="mdi-arrow-right" color="grey-7" size="xs" class="q-mt-xs gt-sm" />
              </div>
              <div class="col-12 col-md-auto">
                <div class="flow-item">
                  <q-icon name="mdi-sd" color="amber-7" size="sm" />
                  <span>3. Burn to Card</span>
                </div>
              </div>
            </div>
          </q-step>

          <!-- Step 3: Creating Combinations -->
          <q-step :name="3" title="Creating Combinations & Banks" icon="mdi-database" :done="step > 3">
            <div class="text-body2 q-mb-sm">
              In the <strong>Organ Console</strong>, you can select stops and tremulants to create a specific sound.
            </div>
            <ul class="text-grey-5 q-pl-md">
              <li><strong>GC (General Cancel)</strong>: Clears all active stops.</li>
              <li><strong>Save to New</strong>: Saves the current active stops as a new <strong>Bank</strong>.</li>
              <li><strong>Overwrite</strong>: Updates the selected bank with the current configuration.</li>
              <li><strong>Reorder</strong>: Use the arrows (up/down) to change the bank order (001.wav, 002.wav, etc).
              </li>
            </ul>
          </q-step>

          <!-- Step 4: Exporting & Burning -->
          <q-step :name="4" title="Burning an SD Card" icon="mdi-sd" :done="step > 4">
            <div class="bg-red-10 q-pa-sm rounded-borders q-mb-md border-red">
              <div class="text-caption text-red-2 text-weight-bold">CRITICAL FOR TSUNAMI COMPATIBILITY:</div>
              <div class="text-caption text-white">Files must be contiguous on the SD card for high-polyphony playback.
              </div>
            </div>
            <div class="text-body2 q-mb-sm">
              When you are ready to create your card:
            </div>
            <ul class="text-grey-5 q-pl-md">
              <li>Insert your SD card and select it in <strong>Target Device</strong>.</li>
              <li>Click <strong>Burn to Card</strong>.</li>
              <li>We highly recommend the <strong>ERASE AND FORMAT</strong> option. This ensures the card is FAT32,
                named correctly, and the files are written in the exact physical order Tsunami expects.</li>
            </ul>
          </q-step>

          <!-- Step 5: Tsunami Preview -->
          <q-step :name="5" title="Preview & Status" icon="mdi-eye">
            <div class="text-body2 q-mb-sm">
              Before taking your card to the organ, you can verify it in the <strong>Tsunami Preview</strong> screen.
            </div>
            <div class="text-grey-5 q-mb-md">
              This simulates the Tsunami hardware behavior, including real-time loading delays and voice limits.
            </div>
            <div class="row items-center q-gutter-x-sm">
              <q-icon name="mdi-circle" color="green-5" size="12px" />
              <span class="text-caption">MIDI Connected indicator (Top Toolbar)</span>
            </div>
          </q-step>

          <template v-slot:navigation>
            <q-card-actions align="right" class="q-pa-md">
              <q-btn v-if="step > 1" flat color="grey-7" @click="step--" label="Back" class="q-mr-sm" />
              <q-btn v-if="step < 5" color="amber-9" text-color="black" @click="step++" label="Next" />
              <q-btn v-if="step === 5" color="green-8" v-close-popup label="Finish" />
            </q-card-actions>
          </template>
        </q-stepper>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  modelValue: boolean;
}>();

defineEmits(['update:modelValue']);

const step = ref(1);
</script>

<style lang="scss" scoped>
.font-cinzel {
  font-family: 'Cinzel', serif;
}

.flow-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid rgba(212, 175, 55, 0.2);
}

.border-red {
  border: 1px solid #d32f2f;
}
</style>
