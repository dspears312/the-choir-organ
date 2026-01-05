<template>
    <div class="settings-manager column no-wrap full-height bg-dark-sidebar">
        <div class="q-pa-md bg-header-gradient border-bottom-amber">
            <div class="text-h6 font-cinzel text-amber-9">Settings</div>
            <div class="text-caption text-grey-6">Audio and performance configuration</div>
        </div>

        <q-scroll-area class="col">
            <div class="q-pa-md column q-gutter-y-lg">
                <!-- Global Volume -->
                <div class="column q-gutter-y-xs">
                    <div class="row items-center justify-between">
                        <div class="text-subtitle2 text-grey-4">Global Volume</div>
                        <div class="text-caption text-amber font-mono">{{ Math.round(organStore.globalVolume) }}%</div>
                    </div>
                    <div class="row items-center q-gutter-x-sm">
                        <q-icon name="mdi-volume-high" color="grey-6" size="xs" />
                        <q-slider v-model="organStore.globalVolume" :min="0" :max="100" color="amber" class="col" dense
                            @update:model-value="val => organStore.setGlobalVolume(val ?? 0)" />
                    </div>
                </div>

                <q-separator dark />

                <!-- Performance Section -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-amber-8 font-cinzel text-uppercase">Performance</div>

                    <!-- Worker Count -->
                    <div class="column q-gutter-y-xs">
                        <div class="row items-center justify-between">
                            <div class="text-caption text-grey-5">Worker Processes</div>
                            <div class="text-caption text-amber font-mono">{{ settingsStore.workerCount }}</div>
                        </div>
                        <q-slider v-model="settingsStore.workerCount" :min="1" :max="8" :step="1" label markers snap
                            color="amber" class="col" dense @change="saveGlobalSettings" />
                    </div>

                    <!-- Loading Mode -->
                    <div class="column q-gutter-y-xs">
                        <div class="text-caption text-grey-5">Sample Loading Mode</div>
                        <q-btn-toggle v-model="organStore.audioSettings.loadingMode" spread class="col" no-caps dense
                            toggle-color="amber" color="grey-9" text-color="grey-4" size="sm" :options="[
                                { label: 'None', value: 'none' },
                                { label: 'Quick', value: 'quick' },
                                { label: 'Full', value: 'full' }
                            ]" @update:model-value="val => organStore.setLoadingMode(val)" />
                        <div class="text-tiny text-grey-6 q-px-xs">
                            <span v-if="organStore.audioSettings.loadingMode === 'none'">Low RAM, disk streaming
                                only.</span>
                            <span v-else-if="organStore.audioSettings.loadingMode === 'quick'">Preload 1s,
                                balanced.</span>
                            <span v-else>Max performance, high RAM.</span>
                        </div>
                    </div>
                </div>

                <q-separator dark />

                <!-- Audio Engine Section -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-amber-8 font-cinzel text-uppercase">Audio Engine</div>

                    <!-- Release Mode -->
                    <div class="column q-gutter-y-xs">
                        <div class="text-caption text-grey-5">Release Tails</div>
                        <q-btn-toggle v-model="organStore.audioSettings.releaseMode" spread class="col" no-caps dense
                            toggle-color="amber" color="grey-9" text-color="grey-4" size="sm" :options="[
                                { label: 'Authentic', value: 'authentic' },
                                { label: 'Digital', value: 'convolution' },
                                { label: 'None', value: 'none' }
                            ]" @update:model-value="val => organStore.setReleaseMode(val)" />
                    </div>

                    <!-- Reverb Settings (Only if convolution) -->
                    <div v-if="organStore.audioSettings.releaseMode === 'convolution'"
                        class="column q-gutter-y-xs q-pl-sm border-left-amber">
                        <div class="text-caption text-amber">Digital Reverb</div>

                        <q-select v-model="reverbPreset" :options="reverbPresets" label="Preset" dense dark
                            color="amber" emit-value map-options outlined options-dense class="q-mb-xs" />

                        <div class="row items-center q-gutter-x-sm">
                            <div class="text-tiny text-grey-5" style="width: 40px">Time</div>
                            <q-slider v-model="organStore.audioSettings.reverbLength" :min="0.5" :max="8.0" :step="0.1"
                                :label-value="organStore.audioSettings.reverbLength + 's'" label-always
                                @update:model-value="onReverbChange" @change="updateReverb" color="amber" class="col"
                                dense />
                        </div>
                        <div class="row items-center q-gutter-x-sm">
                            <div class="text-tiny text-grey-5" style="width: 40px">Mix</div>
                            <q-slider v-model="organStore.audioSettings.reverbMix" :min="0" :max="1" :step="0.05"
                                :label-value="Math.round(organStore.audioSettings.reverbMix * 100) + '%'" label-always
                                @update:model-value="onReverbChange" @change="updateReverb" color="amber" class="col"
                                dense />
                        </div>
                    </div>
                </div>

                <q-separator dark />

                <!-- Ranks Section -->
                <q-expansion-item expand-separator icon="mdi-pipe-organ" label="Ranks & Samples"
                    header-class="text-amber-8 font-cinzel text-uppercase bg-grey-9" dark dense>
                    <div class="column q-pa-sm bg-black-20">
                        <q-input v-model="rankSearch" dense filled dark placeholder="Search..." color="amber"
                            class="q-mb-sm">
                            <template v-slot:append>
                                <q-icon name="mdi-magnify" size="xs" />
                            </template>
                        </q-input>

                        <div v-if="isLoadingRanks" class="text-center q-pa-sm">
                            <q-spinner-dots color="amber" size="sm" />
                        </div>

                        <div v-else class="column q-gutter-y-xs" style="max-height: 200px; overflow-y: auto;">
                            <div v-if="filteredRanks.length === 0" class="text-caption text-grey-6 text-center">No ranks
                                found.</div>
                            <q-item v-for="rank in filteredRanks" :key="rank.id" tag="label" dense
                                class="rounded-borders bg-grey-9" style="min-height: 32px">
                                <q-item-section avatar style="min-width: 0; padding-right: 8px;">
                                    <q-checkbox
                                        :model-value="!organStore.audioSettings.disabledRanks?.includes(rank.id)"
                                        @update:model-value="toggleRank(rank.id)" color="amber" dense size="xs" />
                                </q-item-section>
                                <q-item-section>
                                    <q-item-label class="text-amber-1 text-caption ellipsis">{{ rank.name
                                    }}</q-item-label>
                                </q-item-section>
                            </q-item>
                        </div>
                    </div>
                </q-expansion-item>

                <q-separator dark />

                <!-- Remote Server Section -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-grey-4">Remote Control</div>

                    <q-card dark bordered class="bg-black-50 border-amber-muted flat">
                        <q-card-section class="q-pa-sm">
                            <div class="row items-center justify-between">
                                <div class="column">
                                    <div class="text-caption"
                                        :class="organStore.remoteServerStatus.running ? 'text-green' : 'text-grey-6'">
                                        {{ organStore.remoteServerStatus.running ? 'On' : 'Off' }}
                                    </div>
                                    <q-input dense dark v-model.number="settingsStore.remoteServerPort" type="number"
                                        label="Port" dense-options borderless
                                        :disable="organStore.remoteServerStatus.running"
                                        @update:model-value="updatePort" input-class="text-amber font-mono small-input"
                                        label-color="grey-6" style="max-width: 60px" />
                                </div>
                                <q-btn :color="organStore.remoteServerStatus.running ? 'red-9' : 'green-9'"
                                    :icon="organStore.remoteServerStatus.running ? 'mdi-stop' : 'mdi-play'"
                                    :label="organStore.remoteServerStatus.running ? 'Stop' : 'Start'" unelevated
                                    size="sm" dense class="q-px-sm" @click="organStore.toggleRemoteServer" />
                            </div>
                        </q-card-section>
                    </q-card>

                    <div v-if="organStore.remoteServerStatus.running" class="column q-gutter-y-xs">
                        <div class="text-tiny text-amber-9 text-uppercase">Addresses</div>
                        <div v-for="ip in organStore.remoteServerStatus.ips" :key="ip"
                            class="row items-center justify-between bg-grey-10 q-px-sm q-py-xs rounded-borders">
                            <div class="text-tiny font-mono text-grey-4 ellipsis">http://{{ ip }}:{{
                                organStore.remoteServerStatus.port }}</div>
                            <q-btn flat round dense icon="mdi-content-copy" size="xs" color="grey-6"
                                @click="copyToClipboard(`http://${ip}:${organStore.remoteServerStatus.port}`)" />
                        </div>
                    </div>
                </div>
            </div>
        </q-scroll-area>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useSettingsStore } from 'src/stores/settings';
import { useOrganStore } from 'src/stores/organ';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const settingsStore = useSettingsStore();
const organStore = useOrganStore();

const rankSearch = ref('');
const isLoadingRanks = ref(false);
const ranks = ref<any[]>([]);

// Reverb Preset Logic
const reverbPreset = ref('custom');
const reverbPresets = [
    { label: 'Custom', value: 'custom' },
    { label: 'Dry', value: 'dry', length: 1.0, mix: 0.1 },
    { label: 'Small', value: 'small', length: 2.5, mix: 0.35 },
    { label: 'Large', value: 'large', length: 4.0, mix: 0.5 },
    { label: 'Cathedral', value: 'cathedral', length: 6.0, mix: 0.7 }
];

watch(reverbPreset, (newVal) => {
    if (newVal === 'custom') return;
    const preset = reverbPresets.find(p => p.value === newVal);
    if (preset) {
        organStore.setReverbSettings(preset.length!, preset.mix!);
    }
});

function onReverbChange() {
    reverbPreset.value = 'custom';
}

function updateReverb() {
    organStore.setReverbSettings(organStore.audioSettings.reverbLength, organStore.audioSettings.reverbMix);
}

// Watch for organ change to load ranks
watch(() => organStore.organData, async (newData) => {
    if (newData) {
        await loadRanks(newData.sourcePath);

        // Sync reverb preset with loaded settings
        const current = organStore.audioSettings;
        const match = reverbPresets.find(p => p.value !== 'custom' && Math.abs(p.length! - current.reverbLength) < 0.1 && Math.abs(p.mix! - current.reverbMix) < 0.05);
        reverbPreset.value = match ? match.value : 'custom';
    }
}, { immediate: true });


async function loadRanks(path: string) {
    isLoadingRanks.value = true;
    try {
        // Simple cache check or re-parse
        if (organStore.organData && organStore.organData.sourcePath === path && organStore.organData.ranks) {
            ranks.value = Object.values(organStore.organData.ranks).map((r: any) => ({
                id: r.id,
                name: r.name
            })).sort((a: any, b: any) => a.name.localeCompare(b.name));
            return;
        }

        const data = await window.myApi.parseOdf(path);
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

const filteredRanks = computed(() => {
    if (!rankSearch.value) return ranks.value;
    const term = rankSearch.value.toLowerCase();
    return ranks.value.filter(r => r.name.toLowerCase().includes(term));
});

function toggleRank(rankId: string) {
    organStore.toggleRankDisabled(rankId);
}

const saveGlobalSettings = async () => {
    await settingsStore.saveSettings({ workerCount: settingsStore.workerCount });
};

const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    $q.notify({ type: 'positive', message: 'Copied to clipboard', timeout: 1000, position: 'top' });
};

const updatePort = (val: number | string | null) => {
    if (!val) return;
    const port = Number(val);
    if (!isNaN(port) && port > 0 && port < 65536) {
        if (organStore.remoteServerStatus.running) {
            organStore.toggleRemoteServer(); // Stop it
        }

        settingsStore.saveSettings({ remoteServerPort: port });
        organStore.remoteServerStatus.port = port;
    }
};

onMounted(() => {
    settingsStore.loadSettings();
});
</script>

<style scoped>
.bg-dark-sidebar {
    background: #1a1a1a;
}

.bg-header-gradient {
    background: linear-gradient(to bottom, #2a2a2a, #1a1a1a);
}

.border-bottom-amber {
    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
}

.border-left-amber {
    border-left: 2px solid rgba(212, 175, 55, 0.5);
}

.bg-black-50 {
    background: rgba(0, 0, 0, 0.5);
}

.bg-black-20 {
    background: rgba(0, 0, 0, 0.2);
}

.border-amber-muted {
    border: 1px solid rgba(212, 175, 55, 0.1);
}

.text-tiny {
    font-size: 0.7em;
}

.small-input {
    font-size: 0.8em;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-track {
    background: #1a1a1a;
}

::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: #d4af37;
}
</style>
