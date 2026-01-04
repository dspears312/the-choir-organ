<template>
    <div class="settings-manager column no-wrap full-height">
        <div class="q-pa-md bg-header-gradient border-bottom-amber">
            <div class="text-h6 font-cinzel text-amber-9">Settings</div>
            <div class="text-caption text-grey-6">Audio and performance configuration</div>
        </div>

        <q-scroll-area class="col">
            <div class="q-pa-md column q-gutter-y-lg">
                <!-- Performance -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-grey-4">Local Worker Processes</div>
                    <div class="text-caption text-grey-6">
                        Distribute synthesis across multiple CPU cores. (Global Setting)
                    </div>
                    <div class="row items-center q-gutter-x-md">
                        <q-slider v-model="settingsStore.workerCount" :min="1" :max="8" :step="1" label markers snap
                            color="amber" class="col" @change="saveGlobalSettings" />
                        <div class="text-h6 text-amber font-cinzel" style="min-width: 30px; text-align: center;">
                            {{ settingsStore.workerCount }}
                        </div>
                    </div>
                </div>

                <q-separator dark />

                <!-- Volume -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-grey-4">Global Volume</div>
                    <div class="row items-center q-gutter-x-md">
                        <q-icon name="mdi-volume-high" color="grey-6" />
                        <q-slider v-model="organStore.globalVolume" :min="0" :max="100" color="amber" class="col"
                            @update:model-value="val => organStore.setGlobalVolume(val ?? 0)" />
                        <div class="text-caption text-amber font-mono" style="min-width: 35px">
                            {{ Math.round(organStore.globalVolume) }}%
                        </div>
                    </div>
                </div>

                <q-separator dark />

                <!-- Audio Engine (Experimental) -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-grey-4">Audio Engine</div>
                    <div class="q-pa-sm bg-amber-1 rounded-borders">
                        <q-toggle v-model="settingsStore.useRustEngine" label="Use Rust Audio Engine (Experimental)"
                            color="amber-9" left-label size="sm" class="text-amber-10"
                            @update:model-value="saveRustSettings" />
                        <div class="text-caption text-amber-9 q-pl-md" style="font-size: 0.7em;">
                            Requires restart. High performance.
                        </div>
                    </div>
                </div>

                <q-separator dark />

                <!-- Audio Settings (Formerly Advanced) -->
                <div class="column q-gutter-y-sm" v-if="organStore.organData">
                    <div class="row items-center justify-between">
                        <div class="text-subtitle2 text-grey-4">Organ Audio Settings</div>
                        <q-btn flat dense icon="mdi-refresh" color="amber-7" label="Apply" size="sm"
                            :loading="isApplying" @click="applyAudioSettings">
                            <q-tooltip>Save & Reload Organ</q-tooltip>
                        </q-btn>
                    </div>

                    <div class="text-caption text-grey-5 q-mb-xs">Release Mode</div>
                    <q-btn-toggle v-model="pendingSettings.releaseMode" spread no-caps toggle-color="amber"
                        color="grey-9" text-color="grey-4" size="sm" :options="[
                            { label: 'Authentic', value: 'authentic' },
                            { label: 'Convolution', value: 'convolution' },
                            { label: 'None', value: 'none' }
                        ]" />

                    <div v-if="pendingSettings.releaseMode === 'convolution'" class="q-pl-sm border-left-amber q-mt-sm">
                        <q-select v-model="reverbPreset" :options="reverbPresets" label="Reverb Preset" dense dark
                            color="amber" emit-value map-options outlined class="q-mb-sm" />

                        <div class="row items-center q-gutter-x-sm">
                            <div class="text-grey-6" style="font-size: 0.8em">Len: {{ pendingSettings.reverbLength }}s
                            </div>
                            <q-slider v-model="pendingSettings.reverbLength" :min="0.5" :max="8.0" :step="0.1"
                                @update:model-value="reverbPreset = 'custom'" color="amber" class="col" />
                        </div>
                        <div class="row items-center q-gutter-x-sm">
                            <div class="text-grey-6" style="font-size: 0.8em">Mix: {{
                                Math.round(pendingSettings.reverbMix *
                                100) }}%</div>
                            <q-slider v-model="pendingSettings.reverbMix" :min="0" :max="1" :step="0.05"
                                @update:model-value="reverbPreset = 'custom'" color="amber" class="col" />
                        </div>
                    </div>

                    <div class="text-caption text-grey-5 q-mt-md q-mb-xs">Sample Loading</div>
                    <q-btn-toggle v-model="pendingSettings.loadingMode" spread no-caps toggle-color="amber"
                        color="grey-9" text-color="grey-4" size="sm" :options="[
                            { label: 'None', value: 'none' },
                            { label: 'Quick', value: 'quick' },
                            { label: 'Full', value: 'full' }
                        ]" />

                    <q-separator dark class="q-my-md" />

                    <!-- Rank Management -->
                    <div class="text-subtitle2 text-grey-4">Enabled Ranks</div>
                    <q-input v-model="rankSearch" dense filled dark placeholder="Search Ranks..." color="amber"
                        class="q-mb-sm" size="sm">
                        <template v-slot:append>
                            <q-icon name="mdi-magnify" size="xs" />
                        </template>
                    </q-input>

                    <div class="row q-gutter-x-xs q-mb-sm">
                        <q-btn flat dense color="amber" label="Enable All" size="xs" class="col"
                            @click="selectAllFiltered" />
                        <q-btn flat dense color="grey-5" label="Disable All" size="xs" class="col"
                            @click="deselectAllFiltered" />
                    </div>

                    <div class="ranks-list q-gutter-y-xs">
                        <div v-for="rank in filteredRanks" :key="rank.id"
                            class="rank-item row items-center q-px-sm rounded-borders bg-grey-10">
                            <q-checkbox :model-value="!pendingSettings.disabledRanks.includes(rank.id)"
                                @update:model-value="toggleRank(rank.id)" color="amber" dense size="sm" />
                            <div class="col q-ml-sm ellipsis text-grey-3" style="font-size: 0.9em;">
                                {{ rank.name }}
                                <q-tooltip>{{ rank.name }} ({{ rank.id }})</q-tooltip>
                            </div>
                        </div>
                        <div v-if="filteredRanks.length === 0" class="text-center text-grey-6 q-pa-sm">
                            No ranks found
                        </div>
                    </div>
                </div>
                <div v-else class="text-center q-pa-lg text-grey-6">
                    <q-icon name="mdi-piano" size="xl" class="q-mb-sm" />
                    <div>Load an organ to configure audio settings and ranks.</div>
                </div>

                <q-separator dark />

                <!-- Remote Control Section -->
                <div class="column q-gutter-y-sm">
                    <div class="text-subtitle2 text-grey-4">Remote Control</div>
                    <div class="text-caption text-grey-6">Access organ controls via web browser</div>

                    <q-card dark bordered class="bg-black-50 border-amber-muted">
                        <q-card-section class="q-pa-sm">
                            <div class="row items-center justify-between">
                                <div class="column">
                                    <div class="text-subtitle2"
                                        :class="organStore.remoteServerStatus.running ? 'text-green' : 'text-grey-6'"
                                        style="font-size: 0.9em">
                                        {{ organStore.remoteServerStatus.running ? 'Server Active' : 'Server Offline' }}
                                    </div>
                                    <!-- Port Input -->
                                    <div class="row items-center q-mt-xs">
                                        <q-input dense dark v-model.number="settingsStore.remoteServerPort"
                                            type="number" label="Port" class="q-mr-sm" style="width: 60px"
                                            :disable="organStore.remoteServerStatus.running"
                                            @update:model-value="updatePort" input-class="text-amber font-mono"
                                            label-color="grey-6" />
                                    </div>
                                </div>
                                <q-btn :color="organStore.remoteServerStatus.running ? 'red-9' : 'green-9'"
                                    :label="organStore.remoteServerStatus.running ? 'Stop' : 'Start'" unelevated
                                    size="sm" class="q-px-md" @click="organStore.toggleRemoteServer" />
                            </div>
                        </q-card-section>
                    </q-card>

                    <div v-if="organStore.remoteServerStatus.running" class="column q-gutter-y-xs">
                        <div class="text-overline text-amber-9" style="line-height: 1">Addresses</div>
                        <q-list dark bordered separator class="rounded-borders bg-grey-10">
                            <q-item v-for="ip in organStore.remoteServerStatus.ips" :key="ip"
                                class="q-py-xs min-item-height" dense>
                                <q-item-section>
                                    <q-item-label class="text-caption font-mono text-grey-4"
                                        style="font-size: 0.75rem">http://{{
                                            ip }}:{{
                                            organStore.remoteServerStatus.port }}</q-item-label>
                                </q-item-section>
                                <q-item-section side>
                                    <q-btn flat round dense icon="mdi-content-copy" size="xs" color="grey-7"
                                        @click="copyToClipboard(`http://${ip}:${organStore.remoteServerStatus.port}`)">
                                        <q-tooltip>Copy URL</q-tooltip>
                                    </q-btn>
                                </q-item-section>
                            </q-item>
                        </q-list>
                    </div>
                </div>
            </div>
        </q-scroll-area>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useSettingsStore } from 'src/stores/settings';
import { useOrganStore } from 'src/stores/organ';
import { useQuasar } from 'quasar';
import { useRoute } from 'vue-router';

const $q = useQuasar();
const settingsStore = useSettingsStore();
const organStore = useOrganStore();
const route = useRoute();

const rankSearch = ref('');
const isApplying = ref(false);

const pendingSettings = ref({
    disabledRanks: [] as string[],
    releaseMode: 'authentic' as 'authentic' | 'convolution' | 'none',
    reverbMix: 0.35,
    reverbLength: 2.5,
    loadingMode: 'none' as 'none' | 'quick' | 'full'
});

const reverbPresets = [
    { label: 'Custom', value: 'custom' },
    { label: 'Dry / Practice Room', value: 'dry', length: 1.0, mix: 0.1 },
    { label: 'Small Church', value: 'small', length: 2.5, mix: 0.35 },
    { label: 'Large Church', value: 'large', length: 4.0, mix: 0.5 },
    { label: 'Cathedral', value: 'cathedral', length: 6.0, mix: 0.7 }
];

const reverbPreset = ref('custom');

watch(reverbPreset, (newVal) => {
    if (newVal === 'custom') return;
    const preset = reverbPresets.find(p => p.value === newVal);
    if (preset) {
        pendingSettings.value.reverbLength = preset.length!;
        pendingSettings.value.reverbMix = preset.mix!;
    }
});

// Initialize pending settings from store
watch(() => organStore.audioSettings, (val) => {
    if (val) {
        pendingSettings.value = JSON.parse(JSON.stringify(val));
        // Match preset
        const current = pendingSettings.value;
        const match = reverbPresets.find(p => p.value !== 'custom' && Math.abs(p.length! - current.reverbLength) < 0.1 && Math.abs(p.mix! - current.reverbMix) < 0.05);
        reverbPreset.value = match ? match.value : 'custom';
    }
}, { immediate: true, deep: true });

const filteredRanks = computed(() => {
    if (!organStore.organData?.ranks) return [];
    const ranksList = Object.values(organStore.organData.ranks).map((r: any) => ({
        id: r.id,
        name: r.name
    })).sort((a, b) => a.name.localeCompare(b.name));

    if (!rankSearch.value) return ranksList;
    const term = rankSearch.value.toLowerCase();
    return ranksList.filter(r => r.name.toLowerCase().includes(term));
});

const toggleRank = (rankId: string) => {
    const list = [...pendingSettings.value.disabledRanks];
    const idx = list.indexOf(rankId);
    if (idx === -1) {
        list.push(rankId);
    } else {
        list.splice(idx, 1);
    }
    pendingSettings.value.disabledRanks = list;
};

const selectAllFiltered = () => {
    const visibleIds = new Set(filteredRanks.value.map(r => r.id));
    pendingSettings.value.disabledRanks = pendingSettings.value.disabledRanks.filter(id => !visibleIds.has(id));
};

const deselectAllFiltered = () => {
    const visibleIds = filteredRanks.value.map(r => r.id);
    const set = new Set(pendingSettings.value.disabledRanks);
    visibleIds.forEach(id => set.add(id));
    pendingSettings.value.disabledRanks = Array.from(set);
};

const applyAudioSettings = async () => {
    isApplying.value = true;
    try {
        organStore.audioSettings = JSON.parse(JSON.stringify(pendingSettings.value));
        await organStore.setReleaseMode(organStore.audioSettings.releaseMode);
        await organStore.setLoadingMode(organStore.audioSettings.loadingMode);
        await organStore.setReverbSettings(organStore.audioSettings.reverbLength, organStore.audioSettings.reverbMix);
        await organStore.saveInternalState();

        const file = route.query.file as string;
        if (file) {
            $q.notify({ message: 'Reloading organ with new settings...', color: 'amber-9', icon: 'mdi-refresh', timeout: 1000 });
            await organStore.startOrgan(file);
        }
        $q.notify({ color: 'positive', message: 'Settings applied successfully', icon: 'mdi-check' });
    } catch (e) {
        console.error(e);
        $q.notify({ color: 'negative', message: 'Failed to apply settings' });
    } finally {
        isApplying.value = false;
    }
};

const saveGlobalSettings = async () => {
    await settingsStore.saveSettings({ workerCount: settingsStore.workerCount });
};

const saveRustSettings = async () => {
    await settingsStore.saveSettings({ useRustEngine: settingsStore.useRustEngine });
};

const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    $q.notify({ message: 'URL copied to clipboard', icon: 'mdi-content-copy', color: 'grey-9', timeout: 800 });
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
.bg-header-gradient {
    background: linear-gradient(to bottom, #2a2a2a, #1a1a1a);
}

.border-bottom-amber {
    border-bottom: 2px solid #ffb300;
}

.border-left-amber {
    border-left: 2px solid #ffb300;
}

.bg-black-50 {
    background: rgba(0, 0, 0, 0.5);
}

.border-amber-muted {
    border: 1px solid rgba(212, 175, 55, 0.1);
}

.font-cinzel {
    font-family: 'Cinzel', serif;
}

.min-item-height {
    min-height: 32px;
}

.ranks-list {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid #444;
    padding: 4px;
    background: #111;
}

.rank-item:hover {
    background: #222;
}

.text-tiny {
    font-size: 0.7em;
}
</style>
