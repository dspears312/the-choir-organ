<template>
    <q-layout view="lHh LpR lFf" class="bg-black text-amber">
        <q-header bordered class="bg-header-gradient border-bottom-amber text-amber-9">
            <!-- LEFT SIDE: Controls -->
            <div class="row items-center no-wrap">
                <q-btn flat icon="mdi-view-list" label="Banks" @click="toggleDrawer('combos')"
                    :color="activeDrawer === 'combos' && leftDrawerOpen ? 'amber' : 'grey'">
                    <q-tooltip>Combinations</q-tooltip>
                </q-btn>

                <q-btn flat icon="mdi-microphone" label="Recordings" @click="toggleDrawer('recordings')"
                    :color="activeDrawer === 'recordings' && leftDrawerOpen ? 'amber' : 'grey'">
                    <q-tooltip>Recordings</q-tooltip>
                </q-btn>

                <q-separator vertical spaced color="amber-10" />

                <q-btn flat label="G.C." color="grey" icon="mdi-cancel" @click="organStore.clearCombination">
                    <q-tooltip>General Cancel</q-tooltip>
                </q-btn>

                <q-btn flat :color="isRecording ? 'red' : 'grey'" :icon="isRecording ? 'mdi-stop' : 'mdi-record'"
                    :label="isRecording ? 'Stop' : 'Record'" :class="{ 'animate-blink': isRecording }"
                    @click="organStore.toggleRecording">
                </q-btn>
            </div>

            <q-space />

            <!-- CENTER: Title -->
            <q-toolbar-title class="font-cinzel text-center absolute-center q-px-none" style="pointer-events: none;">
                <div class="ellipsis text-h5 text-weight-bold">
                    {{ organData?.name || 'The Choir Organ' }}
                </div>
            </q-toolbar-title>

            <q-space />

            <!-- RIGHT SIDE: Screens -->
            <div class="row items-center no-wrap">
                <q-tabs v-model="currentScreenIndex" dense align="right" class="text-grey-5" active-color="amber"
                    indicator-color="amber" narrow-indicator shrink outside-arrows mobile-arrows>
                    <q-tab :name="-1" label="Basic" />
                    <q-tab v-for="(s, idx) in displayScreens" :key="s.id" :name="s.originalIndex" :label="s.name" />
                </q-tabs>
            </div>
        </q-header>

        <!-- Unified Left Drawer -->
        <q-drawer v-model="leftDrawerOpen" side="left" bordered class="bg-grey-10 border-right-amber" :width="320">
            <template v-if="activeDrawer === 'combos'">
                <CombinationManager :model-value="currentBankIndex" @update:model-value="setCurrentBank"
                    :allow-import-export="false" />
            </template>
            <template v-else-if="activeDrawer === 'recordings'">
                <RecordingManager :allow-export="false" @toggle-recording="organStore.toggleRecording" />
            </template>
        </q-drawer>

        <q-page-container class="bg-black full-height">
            <q-page class="column">
                <div v-if="loading" class="flex flex-center full-height">
                    <div class="column items-center">
                        <q-spinner-grid color="amber" size="4em" />
                        <div class="font-cinzel text-amber q-mt-md">Connecting...</div>
                    </div>
                </div>

                <template v-else>

                    <!-- Basic View -->
                    <div v-if="currentScreenIndex === -1" class="col scroll q-pa-md">
                        <div v-for="manual in sortedManuals" :key="manual.id" class="manual-section q-mb-lg">
                            <div
                                class="manual-header font-cinzel text-h6 text-amber-8 q-mb-sm text-center border-bottom-amber-muted">
                                {{ manual.name }}
                                <q-badge color="grey-9" text-color="amber" :label="manual.stopIds.length" align="top" />
                            </div>
                            <div class="row justify-center q-gutter-md">
                                <Drawknob v-for="stopId in manual.stopIds" :key="stopId"
                                    :name="organData.stops[stopId]?.name || stopId"
                                    :pitch="organData.stops[stopId]?.pitch || ''"
                                    :active="activatedStops.includes(stopId)" :volume="stopVolumes[stopId] ?? 100"
                                    :hide-volume="true" @toggle="organStore.toggleStop(stopId)" class="stop-item" />
                            </div>
                        </div>
                    </div>

                    <!-- Graphic View -->
                    <template v-else>
                        <OrganScreen v-if="currentScreen" :screen="currentScreen" style="flex: 1 1 auto;" />
                        <div v-else class="flex flex-center full-height text-grey-7 italic">
                            No graphical screens available.
                        </div>
                    </template>
                </template>
            </q-page>
        </q-page-container>
    </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive, provide } from 'vue';
import OrganScreen from 'src/components/OrganScreen.vue';
import CombinationManager from 'src/components/CombinationManager.vue';
import RecordingManager from 'src/components/RecordingManager.vue';
import Drawknob from 'src/components/Drawknob.vue';
import { Bank } from 'src/types/models';

const loading = ref(true);
const connected = ref(false);
const organData = ref<any>(null);
const screens = ref<any[]>([]);
const currentScreenIndex = ref(-1); // Start at Basic
const activatedStops = ref<string[]>([]);
const stopVolumes = ref<Record<string, number>>({});
const banks = ref<Bank[]>([]);
const recordings = ref<any[]>([]);
const isRecording = ref(false);

const leftDrawerOpen = ref(false);
const activeDrawer = ref<'combos' | 'recordings'>('combos');

function toggleDrawer(target: 'combos' | 'recordings') {
    if (leftDrawerOpen.value && activeDrawer.value === target) {
        // If already open and same target, close it
        leftDrawerOpen.value = false;
    } else {
        // Switch content and ensure open
        activeDrawer.value = target;
        leftDrawerOpen.value = true;
    }
}

// const showCombos = ref(false); // Default closed
// const showRecording = ref(false);
// const viewMode = ref<'graphic' | 'basic'>('graphic'); // Removed
// const manuallySwitched = ref(false); // Removed

// Fullscreen
const isFullscreen = ref(false);
const isStandalone = ref(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.error(err));
        isFullscreen.value = true;
    } else {
        document.exitFullscreen();
        isFullscreen.value = false;
    }
}
document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement;
});

// Filtering logic (same as OrganBuilderPage)
const displayScreens = computed(() => {
    return screens.value.map((screen, index) => ({ ...screen, originalIndex: index }))
        .filter((screen: any) => {
            let title = screen.name.toLowerCase();
            if (title.includes('noise')) return false;
            if (title.includes('wind')) return false;
            if (title.includes('blow')) return false; // blower
            if (title.includes('cresc')) return false; // crescendo
            if (title.includes('detun')) return false; // detune or detuning
            if (title.includes('voic')) return false; // voice or voicing
            if (title.includes('mix')) return false; // mix or mixing
            if (title.includes('info')) return false; // info or information
            return true;
        });
});


// Mock Store
const organStore = reactive({
    organData: computed(() => organData.value),
    currentCombination: computed(() => activatedStops.value),
    banks: computed(() => banks.value),
    recordings: computed(() => recordings.value),
    isRecording: computed(() => isRecording.value),

    toggleStop(stopId: string) {
        send({ type: 'toggleStop', stopId });
    },
    setStopVolume(stopId: string, volume: number) {
        // Optimistic update
        stopVolumes.value[stopId] = volume;
        // Debounce? For now just send
        send({ type: 'setStopVolume', stopId, volume });
    },
    setStopState(stopId: string, state: boolean) {
        // Simple toggle stop logic, but we can send explicit state if needed
        // For now, toggleStop is what the server expects.
        // Wait, if we want to set a specific state, we need to know if it's already on.
        const isOn = activatedStops.value.includes(stopId);
        if (state !== isOn) {
            send({ type: 'toggleStop', stopId });
        }
    },
    clearCombination() {
        send({ type: 'clearCombination' });
    },
    addBank() {
        send({ type: 'addBank' });
    },
    deleteBank(index: number) {
        send({ type: 'deleteBank', index });
    },
    moveBank(fromIndex: number, toIndex: number) {
        send({ type: 'moveBank', fromIndex, toIndex });
    },
    saveToBank(index: number) {
        send({ type: 'saveToBank', index });
    },
    loadBank(index: number) {
        send({ type: 'loadBank', index });
    },
    importFromJSON() {
        // Not supported on remote yet/easily
        console.warn('Import not supported on remote');
    },
    exportToJSON() {
        // Trigger download from main app? Or locally?
        console.warn('Export not supported on remote');
    },
    toggleRecording() {
        send({ type: 'toggleRecording' });
    },

    // Recording
    // toggleRecording is handled in component via event, but we can expose method
    deleteRecording(id: string) {
        send({ type: 'deleteRecording', id });
    },

    // Legacy / Electron shims
    onRemoteToggleStop: () => (() => { }),
    onRemoteClearCombination: () => (() => { }),
});

// Provide Mock Stores
provide('organStore', organStore);
// Export store not needed for basic remote recording management (view/delete)
// But RecordingManager expects it for rendering.
// We can provide a null or mock exportStore if needed to prevent errors, 
// though we fixed RecordingManager to check for existence.
provide('exportStore', null);


const currentScreen = computed(() => {
    if (currentScreenIndex.value === -1) return null;
    return screens.value[currentScreenIndex.value] || null;
});

// Removed manuallySwitched logic/switchToScreen as tabs model handles it directly now


const sortedManuals = computed(() => {
    if (!organData.value?.manuals) return [];

    let sorted = [...organData.value.manuals];

    // Sort manuals by ID (numeric assumption or existing order) 
    // BUT we want Pedal last.
    // Let's implement the logic from OrganBuilderPage

    const pedalRegex = /pedal|pedale|pedaal|^ped$|^p$/i;

    const pedals: any[] = [];
    const manuals: any[] = [];

    sorted.forEach(m => {
        if (pedalRegex.test(m.name)) {
            pedals.push(m);
        } else {
            manuals.push(m);
        }
    });

    return [...manuals, ...pedals];
});

const currentBankIndex = ref<number | null>(null);
function setCurrentBank(val: number) {
    currentBankIndex.value = val;
    // Potentially sync with server? Main app keeps track of "current bank" maybe?
    // For now purely local UI state for the manager
}


// WebSocket
let ws: WebSocket;
let pollTimer: any = null;
let pingTimer: any = null;

function send(msg: any) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        connected.value = true;
        loading.value = false;
        if (pollTimer) clearInterval(pollTimer);
        startKeepalive();
    };

    ws.onclose = () => {
        connected.value = false;
        stopKeepalive();
        startPolling();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'tco-init' || data.type === 'tco-update') {
            const organChanged = data.organData && data.organData.name !== organData.value?.name;

            if (data.organData) organData.value = data.organData;
            if (data.screens) screens.value = data.screens;

            if (data.activeScreenIndex !== undefined) {
                // Only sync screen index if it's the initial load or the organ has changed
                if (data.type === 'tco-init' || organChanged) {
                    currentScreenIndex.value = data.activeScreenIndex;
                }
            }

            if (data.activatedStops) activatedStops.value = data.activatedStops;
            if (data.stopVolumes) stopVolumes.value = data.stopVolumes;

            // Sync banks/recordings if sent
            if (data.banks) banks.value = data.banks;
            if (data.recordings) recordings.value = data.recordings;
            if (data.isRecording !== undefined) isRecording.value = data.isRecording;
        }
    };
}

function startPolling() {
    pollTimer = setInterval(async () => {
        try {
            const resp = await fetch('/?t=' + Date.now(), { method: 'HEAD' });
            if (resp.ok) window.location.reload();
        } catch (e) { }
    }, 2000);
}

function startKeepalive() {
    pingTimer = setInterval(() => send({ type: 'keepalive' }), 2000);
}

function stopKeepalive() {
    if (pingTimer) clearInterval(pingTimer);
}

onMounted(() => {
    connect();
});
</script>

<style scoped>
.bg-header-gradient {
    background: linear-gradient(to bottom, #2a2a2a, #1a1a1a);
}

.border-bottom-amber {
    border-bottom: 1px solid rgba(212, 175, 55, 0.5);
}

.border-bottom-amber-muted {
    border-bottom: 1px solid rgba(212, 175, 55, 0.2);
}

.border-right-amber {
    border-right: 1px solid rgba(212, 175, 55, 0.3);
}

.border-left-amber {
    border-left: 1px solid rgba(212, 175, 55, 0.3);
}

.text-amber {
    color: #d4af37;
}

.text-amber-9 {
    color: #d4af37;
}

.animate-blink {
    animation: blink 1s infinite;
}

@keyframes blink {
    0% {
        opacity: 1;
    }

    50% {
        opacity: 0.3;
    }

    100% {
        opacity: 1;
    }
}
</style>
