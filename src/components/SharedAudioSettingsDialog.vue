<template>
    <q-dialog :model-value="modelValue" persistent @update:model-value="$emit('update:model-value', $event)">
        <q-card dark style="min-width: 600px; height: 75vh; background: #1a1a1a; border: 1px solid #444;"
            class="column">
            <q-card-section class="row items-center justify-between bg-header-gradient border-bottom-amber">
                <div class="text-h6 font-cinzel text-amber">Audio Settings</div>
                <q-btn flat round dense icon="mdi-close" v-close-popup />
            </q-card-section>

            <q-tabs v-model="activeTab" dense class="text-grey bg-dark-sidebar" active-color="amber"
                indicator-color="amber" align="justify" narrow-indicator>
                <q-tab name="general" label="General" />
                <q-tab name="ranks" label="Ranks & Samples" />
            </q-tabs>

            <q-separator dark />

            <q-tab-panels v-model="activeTab" animated class="bg-transparent col overflow-hidden">
                <q-tab-panel name="general">
                    <div class="text-subtitle2 text-grey-4">Local Worker Processes</div>
                    <div class="text-caption text-grey-6 q-mb-md">
                        Distribute audio synthesis across multiple processes to improve performance on multi-core CPUs.
                        (Global Setting)
                    </div>

                    <div class="row items-center q-gutter-x-md">
                        <q-slider v-model="settingsStore.workerCount" :min="1" :max="8" :step="1" label markers snap
                            color="amber" class="col" @change="saveGlobalSettings" />
                        <div class="text-h6 text-amber font-cinzel" style="min-width: 30px; text-align: center;">
                            {{ settingsStore.workerCount }}
                        </div>
                    </div>
                    <div class="text-caption text-amber-9 italic q-mt-sm q-mb-lg">
                        Background Processes (Min: 1)
                    </div>

                    <q-separator dark class="q-mb-md" />


                    <slot></slot>

                    <div class="text-subtitle2 text-grey-4">Release Tails Mode</div>
                    <div class="row q-gutter-sm q-mb-md">
                        <q-btn-toggle v-model="pendingSettings.releaseMode" spread class="col" no-caps
                            toggle-color="amber" color="grey-9" text-color="grey-4" :options="[
                                { label: 'Authentic', value: 'authentic' },
                                { label: 'Convolution', value: 'convolution' },
                                { label: 'None', value: 'none' }
                            ]" />
                    </div>
                    <div class="text-caption text-grey-6 q-mb-lg" v-if="pendingSettings.releaseMode === 'authentic'">
                        Uses original release samples. Best quality, highest RAM usage.
                    </div>
                    <div class="text-caption text-grey-6 q-mb-lg"
                        v-else-if="pendingSettings.releaseMode === 'convolution'">
                        Uses synthetic reverb tails. Saves RAM, good for dry samples.
                    </div>
                    <div class="text-caption text-grey-6 q-mb-lg" v-else>
                        Quick fade-out. Lowest RAM, driest sound.
                    </div>

                    <div v-if="pendingSettings.releaseMode === 'convolution'" class="q-mb-lg q-pl-md border-left-amber">
                        <div class="text-caption text-amber">Reverb Settings</div>

                        <!-- Presets -->
                        <q-select v-model="reverbPreset" :options="reverbPresets" label="Preset" dense dark
                            color="amber" emit-value map-options outlined class="q-mb-md" />

                        <div class="row items-center q-gutter-x-md">
                            <div class="text-caption text-grey-5">Length ({{ pendingSettings.reverbLength }}s)</div>
                            <q-slider v-model="pendingSettings.reverbLength" :min="0.5" :max="8.0" :step="0.1"
                                @update:model-value="reverbPreset = 'custom'" color="amber" class="col" />
                        </div>
                        <div class="row items-center q-gutter-x-md">
                            <div class="text-caption text-grey-5">Mix ({{ Math.round(pendingSettings.reverbMix * 100)
                                }}%)
                            </div>
                            <q-slider v-model="pendingSettings.reverbMix" :min="0" :max="1" :step="0.05"
                                @update:model-value="reverbPreset = 'custom'" color="amber" class="col" />
                        </div>
                    </div>

                    <q-separator dark class="q-mb-md" />

                    <div class="text-subtitle2 text-grey-4">Sample Loading Strategy</div>
                    <div class="row q-gutter-sm q-mb-md">
                        <q-btn-toggle v-model="pendingSettings.loadingMode" spread class="col" no-caps
                            toggle-color="amber" color="grey-9" text-color="grey-4" :options="[
                                { label: 'None (On Demand)', value: 'none' },
                                { label: 'Quick (1s Preload)', value: 'quick' },
                                { label: 'Full (All RAM)', value: 'full' }
                            ]" />
                    </div>
                    <div class="text-caption text-grey-6">
                        <span v-if="pendingSettings.loadingMode === 'none'">Lowest RAM. Potential dropouts on slow
                            disks.</span>
                        <span v-else-if="pendingSettings.loadingMode === 'quick'">Balance of RAM and performance.</span>
                        <span v-else>Maximum performance. Highest RAM usage.</span>
                    </div>
                </q-tab-panel>

                <q-tab-panel name="ranks" class="column no-wrap q-pa-none">
                    <div class="q-pa-md col-auto bg-dark-sidebar border-bottom-amber">
                        <q-input v-model="rankSearch" dense filled dark placeholder="Search Ranks..." color="amber"
                            class="q-mb-sm">
                            <template v-slot:append>
                                <q-icon name="mdi-magnify" />
                            </template>
                        </q-input>
                        <div class="row q-gutter-x-sm">
                            <q-btn flat dense color="amber" label="Select All" size="sm" class="col"
                                @click="selectAllFiltered" />
                            <q-btn flat dense color="grey-5" label="Deselect All" size="sm" class="col"
                                @click="deselectAllFiltered" />
                        </div>
                        <div class="text-caption text-grey-6 q-mt-sm" v-if="isLoadingRanks">
                            <q-spinner-dots color="amber" size="sm" /> Parsing organ definition...
                        </div>
                    </div>

                    <q-scroll-area class="col q-px-md q-py-sm">
                        <div v-if="filteredRanks.length === 0" class="text-grey-6 text-center q-pa-lg">
                            {{ isLoadingRanks ? 'Loading ranks...' : 'No ranks found.' }}
                        </div>
                        <div v-else class="row q-col-gutter-xs">
                            <div v-for="rank in filteredRanks" :key="rank.id" class="col-6">
                                <q-item tag="label" dense class="rounded-borders bg-grey-9 q-mb-xs">
                                    <q-item-section avatar>
                                        <q-checkbox :model-value="!pendingSettings.disabledRanks?.includes(rank.id)"
                                            @update:model-value="togglePendingRank(rank.id)" color="amber" dense />
                                    </q-item-section>
                                    <q-item-section>
                                        <q-item-label class="text-amber-1">{{ rank.name }}</q-item-label>
                                        <q-item-label caption class="text-grey-5 text-tiny">ID: {{ rank.id
                                            }}</q-item-label>
                                    </q-item-section>
                                </q-item>
                            </div>
                        </div>
                    </q-scroll-area>
                </q-tab-panel>
            </q-tab-panels>

            <q-separator dark />

            <q-card-actions align="right" class="bg-dark-sidebar q-pa-md">
                <q-btn flat label="Cancel" color="grey-6" v-close-popup />
                <q-btn label="Apply Changes" color="green-7" text-color="white" :loading="isApplying"
                    @click="applySettings" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useSettingsStore } from 'src/stores/settings';
import { useQuasar } from 'quasar';

const props = defineProps<{
    modelValue: boolean;
    organPath: string; // The full path to the .organ or ODF file
}>();

const emit = defineEmits(['update:model-value', 'apply']);

const $q = useQuasar();
const settingsStore = useSettingsStore();
const activeTab = ref('general');
const rankSearch = ref('');
const isApplying = ref(false);
const isLoadingRanks = ref(false);

const ranks = ref<any[]>([]); // To store parsed ranks if not loaded in store

// Default settings structure
const DEFAULT_AUDIO_SETTINGS = {
    disabledRanks: [] as string[],
    releaseMode: 'authentic' as 'authentic' | 'convolution' | 'none',
    reverbMix: 0.35,
    reverbLength: 2.5,
    loadingMode: 'none' as 'none' | 'quick' | 'full'
};

const pendingSettings = ref({ ...DEFAULT_AUDIO_SETTINGS });

// Reverb Preset Logic
const reverbPreset = ref('custom');
const reverbPresets = [
    { label: 'Custom', value: 'custom' },
    { label: 'Dry / Practice Room', value: 'dry', length: 1.0, mix: 0.1 },
    { label: 'Small Church', value: 'small', length: 2.5, mix: 0.35 },
    { label: 'Large Church', value: 'large', length: 4.0, mix: 0.5 },
    { label: 'Cathedral', value: 'cathedral', length: 6.0, mix: 0.7 }
];

watch(reverbPreset, (newVal) => {
    if (newVal === 'custom') return;
    const preset = reverbPresets.find(p => p.value === newVal);
    if (preset) {
        pendingSettings.value.reverbLength = preset.length!;
        pendingSettings.value.reverbMix = preset.mix!;
    }
});

// Load settings when dialog opens
watch(() => props.modelValue, async (val) => {
    if (val && props.organPath) {
        await loadOrganSettings();
        await loadRanks();
    }
});

async function loadOrganSettings() {
    try {
        const state = await window.myApi.loadOrganState(props.organPath);
        if (state && state.audioSettings) {
            pendingSettings.value = { ...DEFAULT_AUDIO_SETTINGS, ...state.audioSettings };
        } else {
            pendingSettings.value = { ...DEFAULT_AUDIO_SETTINGS };
        }

        // Match preset
        const current = pendingSettings.value;
        const match = reverbPresets.find(p => p.value !== 'custom' && Math.abs(p.length! - current.reverbLength) < 0.1 && Math.abs(p.mix! - current.reverbMix) < 0.05);
        reverbPreset.value = match ? match.value : 'custom';

    } catch (e) {
        console.error('Failed to load organ settings', e);
    }
}

async function loadRanks() {
    // If we can get ranks from parsing the ODF (without full load)
    isLoadingRanks.value = true;
    try {
        // We need an IPC method to parse ODF and return just metadata/ranks
        console.log('Parsing ODF for ranks...', props.organPath);
        const data = await window.myApi.parseOdf(props.organPath);
        if (data && data.ranks) {
            ranks.value = Object.values(data.ranks).map((r: any) => ({
                id: r.id,
                name: r.name
            })).sort((a: any, b: any) => a.name.localeCompare(b.name));
        }
    } catch (e) {
        console.error("Failed to parse ODF for ranks", e);
    } finally {
        isLoadingRanks.value = false;
    }
}

async function saveGlobalSettings() {
    await settingsStore.saveSettings({ workerCount: settingsStore.workerCount });
}

async function applySettings() {
    isApplying.value = true;
    try {
        // Save to Global Store
        await saveGlobalSettings();

        emit('apply', pendingSettings.value);
        emit('update:model-value', false);
    } catch (e) {
        console.error(e);
        $q.notify({ color: 'negative', message: 'Failed to save settings' });
    } finally {
        isApplying.value = false;
    }
}

const filteredRanks = computed(() => {
    if (!rankSearch.value) return ranks.value;
    const term = rankSearch.value.toLowerCase();
    return ranks.value.filter(r => r.name.toLowerCase().includes(term));
});

function togglePendingRank(rankId: string) {
    const list = pendingSettings.value.disabledRanks || [];
    const idx = list.indexOf(rankId);
    if (idx === -1) {
        list.push(rankId);
    } else {
        list.splice(idx, 1);
    }
    pendingSettings.value.disabledRanks = list;
}

function selectAllFiltered() {
    const list = pendingSettings.value.disabledRanks || [];
    const visibleIds = new Set(filteredRanks.value.map(r => r.id));
    const newList = list.filter((id: string) => !visibleIds.has(id)); // Remove visible from disabled list = Enable
    pendingSettings.value.disabledRanks = newList;
}

function deselectAllFiltered() {
    const list = pendingSettings.value.disabledRanks || [];
    const visibleIds = filteredRanks.value.map(r => r.id);
    const set = new Set(list);
    visibleIds.forEach(id => set.add(id)); // Add visible to disabled list
    pendingSettings.value.disabledRanks = Array.from(set);
}

// Init global settings
onMounted(() => {
    settingsStore.loadSettings();
});

</script>

<style scoped>
.bg-dark-sidebar {
    background: #2b2b2b;
}

.border-bottom-amber {
    border-bottom: 2px solid #ffb300;
}

.border-left-amber {
    border-left: 2px solid #ffb300;
}

.bg-header-gradient {
    background: linear-gradient(135deg, #1a1a1a 0%, #2b2b2b 100%);
}

.font-cinzel {
    font-family: 'Cinzel', serif;
}

.text-tiny {
    font-size: 0.7em;
}
</style>
