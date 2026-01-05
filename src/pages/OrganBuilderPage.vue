<template>
    <q-page class="organ-page text-white column no-wrap">
        <!-- Organ Console -->
        <!-- Toolbar Portal (Teleported to MainLayout) -->
        <Teleport to="#main-toolbar-portal" v-if="isMounted">
            <div class="row no-wrap items-center full-width">
                <!-- <q-btn flat round icon="arrow_back" color="grey-6" @click="goBack" class="q-mr-md" /> -->
                <div class="row items-center q-gutter-x-sm col justify-end">
                    <!-- MIDI Status -->
                    <div class="status-indicator row items-center q-gutter-x-sm cursor-pointer hover-opacity-100"
                        @click="organStore.initMIDI" :class="{ 'opacity-50': organStore.midiStatus !== 'Connected' }">
                        <q-icon name="mdi-circle" :color="midiColor" size="12px" />
                        <span class="text-caption text-uppercase tracking-wide">MIDI</span>
                        <q-tooltip class="bg-grey-10 text-amber shadow-4">
                            <div v-if="organStore.midiStatus === 'Connected'">MIDI Connected & Ready ({{
                                organStore.midiStatus }})</div>
                            <div v-else-if="organStore.midiStatus === 'Error'">
                                <strong>MIDI Error:</strong> {{ organStore.midiError || 'Unknown Error' }}<br />
                                Click to retry connection
                            </div>
                            <div v-else>MIDI Disconnected. Click to retry connection.</div>
                        </q-tooltip>
                    </div>

                    <!-- <q-separator vertical color="grey-9" dark class="q-mx-sm" /> -->

                    <!-- Right Side: Drawer Toggles -->
                    <div class="row no-wrap items-center toolbar-btn-group">

                        <q-separator vertical dark class="q-mx-sm opacity-20" inset />

                        <div class="row no-wrap q-gutter-x-sm">
                            <q-btn v-for="tab in drawerTabs" :key="tab.id" flat dense
                                :color="uiStore.activeDrawer === tab.id && uiStore.rightDrawerOpen ? 'amber' : 'grey-8'"
                                :class="{ 'active-tab': uiStore.activeDrawer === tab.id && uiStore.rightDrawerOpen }"
                                class="drawer-tab-btn" no-caps @click="uiStore.toggleDrawer(tab.id as any)"
                                :icon="tab.icon" :label="tab.label">
                                <!-- <div class="column items-center"> -->
                                <!-- <q-icon :name="tab.icon" size="20px" /> -->
                                <!-- <span class="tab-label" style="font-size: 12px;">{{ tab.label }}</span> -->
                                <!-- </div> -->
                                <q-tooltip>{{ tab.tooltip }}</q-tooltip>
                            </q-btn>
                        </div>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Organ Console -->
        <div class="organ-console column" style="flex: 1 1 auto">

            <!-- Main Body (Flex Row taking remaining height) -->
            <div class="console-body col row no-wrap overflow-hidden">

                <!-- Left Area: Tabs for Basic or Organ Screens -->
                <div class="col column no-wrap">
                    <div class="row items-center bg-grey-10 text-amber">
                        <span class="font-cinzel text-grey-6 text-shadow q-mx-md">{{
                            organStore.organData?.name }}
                        </span>

                        <q-tabs v-model="activeTab" dense active-color="amber" align="center" indicator-color="amber"
                            narrow-indicator>
                            <q-tab name="basic" label="Basic" class="font-cinzel" />
                            <q-tab v-for="screen in filteredScreens" :key="screen.id" :name="screen.id"
                                :label="screen.name" class="font-cinzel" />
                        </q-tabs>
                    </div>

                    <q-tab-panels v-model="activeTab" animated class="col bg-transparent overflow-hidden"
                        style="background: transparent;">
                        <!-- Basic Grid View -->
                        <q-tab-panel name="basic" class="q-pa-none overflow-hidden">
                            <q-scroll-area id="stops-container" style="height: 100%" class="col q-pa-md">
                                <div v-for="manual in sortedManuals" :key="manual.id" class="col-12 q-mb-md">
                                    <div class="manual-section q-pa-md">
                                        <div
                                            class="manual-name font-cinzel text-h6 text-amber-7 q-mb-lg text-center border-bottom-amber">
                                            {{ manual.name }}
                                        </div>
                                        <div class="stops-grid row justify-center q-gutter-md">
                                            <template v-for="stopId in manual.stopIds" :key="`${manual.id}-${stopId}`">
                                                <Drawknob v-if="organStore.organData?.stops[stopId]"
                                                    :name="parseStopLabel(organStore.organData.stops[stopId].name).name"
                                                    :pitch="parseStopLabel(organStore.organData.stops[stopId].name).pitch"
                                                    :classification="parseStopLabel(organStore.organData.stops[stopId].name).classification"
                                                    :active="organStore.currentCombination.includes(stopId)"
                                                    :volume="organStore.stopVolumes[stopId] || 100"
                                                    @toggle="organStore.toggleStop(stopId)"
                                                    @update:volume="organStore.setStopVolume(stopId, $event)">
                                                    <q-menu touch-position context-menu class="bg-grey-10 text-amber">
                                                        <q-list dense style="min-width: 150px">
                                                            <q-item clickable v-close-popup
                                                                @click="openCreateVirtualStop(stopId)">
                                                                <q-item-section avatar><q-icon name="mdi-plus-circle"
                                                                        color="green" /></q-item-section>
                                                                <q-item-section>Create Virtual stop</q-item-section>
                                                            </q-item>
                                                        </q-list>
                                                    </q-menu>
                                                </Drawknob>

                                                <Drawknob v-for="vs in getVirtualStopsFor(stopId)" :key="vs.id"
                                                    :name="vs.name" :pitch="vs.pitch"
                                                    :classification="parseStopLabel(vs.name).classification"
                                                    :active="organStore.currentCombination.includes(vs.id)"
                                                    :volume="organStore.stopVolumes[vs.id] || 100" :is-virtual="true"
                                                    @toggle="organStore.toggleStop(vs.id)"
                                                    @update:volume="organStore.setStopVolume(vs.id, $event)"
                                                    @delete="organStore.deleteVirtualStop(vs.id)">
                                                    <q-menu touch-position context-menu class="bg-grey-10 text-amber">
                                                        <q-list dense style="min-width: 150px">
                                                            <q-item clickable v-close-popup
                                                                @click="openEditVirtualStop(vs)">
                                                                <q-item-section avatar><q-icon name="mdi-pencil"
                                                                        color="blue" /></q-item-section>
                                                                <q-item-section>Edit Virtual stop</q-item-section>
                                                            </q-item>
                                                            <q-item clickable v-close-popup
                                                                @click="organStore.deleteVirtualStop(vs.id)">
                                                                <q-item-section avatar><q-icon name="mdi-delete"
                                                                        color="red" /></q-item-section>
                                                                <q-item-section>Delete Virtual stop</q-item-section>
                                                            </q-item>
                                                        </q-list>
                                                    </q-menu>
                                                </Drawknob>
                                            </template>

                                            <!-- Couplers -->
                                            <template v-if="manual.couplerIds && manual.couplerIds.length > 0">
                                                <!-- <div class="col-12 text-center text-grey-5 q-my-sm">Couplers</div> -->
                                                <Drawknob v-for="couplerId in manual.couplerIds"
                                                    :key="`${manual.id}-${couplerId}`"
                                                    v-if="organStore.organData?.couplers[couplerId]"
                                                    :name="organStore.organData.couplers[couplerId].name"
                                                    classification="Coupler" pitch="Cpl"
                                                    :active="organStore.currentCombination.includes(couplerId)"
                                                    :volume="0" hide-volume
                                                    @toggle="organStore.toggleStop(couplerId)" />
                                            </template>

                                            <!-- Tremulants -->
                                            <template v-if="manual.tremulantIds && manual.tremulantIds.length > 0">
                                                <!-- <div class="col-12 text-center text-grey-5 q-my-sm">Tremulants</div> -->
                                                <Drawknob v-for="tremId in manual.tremulantIds"
                                                    :key="`${manual.id}-${tremId}`"
                                                    v-if="organStore.organData?.tremulants[tremId]"
                                                    :name="organStore.organData.tremulants[tremId].name"
                                                    classification="Tremulant" pitch="Trem"
                                                    :active="organStore.currentCombination.includes(`TREM_${tremId}`)"
                                                    :volume="0" hide-volume
                                                    @toggle="organStore.toggleStop(`TREM_${tremId}`)" />
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </q-scroll-area>
                        </q-tab-panel>

                        <!-- Organ Screen Views -->
                        <q-tab-panel v-for="screen in organStore.organData?.screens" :key="screen.id" :name="screen.id"
                            class="q-pa-sm overflow-hidden" style="display: flex;">
                            <!-- <q-scroll-area style="height: 100%; width: 100%;"> -->
                            <!-- <div class="flex flex-center q-pa-md" style="min-height: 100%"> -->
                            <OrganScreen :screen="screen" />
                            <!-- </div> -->
                            <!-- </q-scroll-area> -->
                        </q-tab-panel>
                    </q-tab-panels>
                </div>
            </div>
        </div>

        <!-- Progress Dialog moved to global -->
        <!-- q-drawer moved to MainLayout -->


        <!-- Dialogs moved to global/managers -->

        <!-- Sample Loading Overlay -->
        <q-inner-loading :showing="organStore.isLoadingOrgan" dark style="z-index: 2000; background: rgba(0,0,0,0.8);">
            <q-spinner-gears size="50px" color="amber" />
            <div class="text-h6 text-amber font-cinzel q-mt-md">Loading Organ...</div>
            <div class="text-caption text-grey-4 q-mt-sm">{{ organStore.renderStatus }}</div>
            <q-linear-progress v-if="organStore.extractionProgress > 0" :value="organStore.extractionProgress"
                color="amber" class="q-mt-md" style="width: 300px" rounded size="6px" />
        </q-inner-loading>

    </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
// Stores
import { useOrganStore } from 'src/stores/organ';
import { useExportStore } from 'src/stores/export';
import { useUIStore } from 'src/stores/ui';
import Drawknob from 'src/components/Drawknob.vue';
import OrganScreen from 'src/components/OrganScreen.vue';
import { parseStopLabel } from 'src/utils/label-parser';
import { useQuasar } from 'quasar';


const $q = useQuasar();

const organStore = useOrganStore();
const exportStore = useExportStore();
const uiStore = useUIStore();
const router = useRouter();
const route = useRoute();
const activeTab = ref('basic');
const showVsDialog = ref(false);
const isMounted = ref(false);


const isDev = process.env.DEV;



const isDevToolsOpen = ref(false);

// Cleanup removed

onMounted(async () => {
    isMounted.value = true;

    // Listen for devtools
    if ((window as any).myApi?.onDevToolsChange) {
        (window as any).myApi.onDevToolsChange((isOpen: boolean) => {
            isDevToolsOpen.value = isOpen;
        });
        // Initial check? We might need an IPC to ask? 
        // Or main process sends it eagerly?
        // Let's assume we can get initial state, or default false.
        // Actually, we can ask for it.
        if ((window as any).myApi?.isDevToolsOpened) {
            isDevToolsOpen.value = await (window as any).myApi.isDevToolsOpened();
        }
    }
    const organPath = route.query.file as string;
    if (organPath) {
        await organStore.startOrgan(organPath);
    } else {
        router.push('/');
        return;
    }

    // Initialize Remote Sync
    organStore.initRemoteSync();

    // Start RAM monitoring
    if ((window as any).myApi?.onMemoryUpdate) {
        ramListenerCleanup = (window as any).myApi.onMemoryUpdate((bytes: number) => {
            ramUsage.value = bytes;
        });
    }
});



const sortedManuals = computed(() => {
    if (!organStore.organData?.manuals) return [];

    return [...organStore.organData.manuals].sort((a: any, b: any) => {
        const isPedalA = isPedal(a.name);
        const isPedalB = isPedal(b.name);

        if (isPedalA && !isPedalB) return 1;
        if (!isPedalA && isPedalB) return -1;
        return 0;
    });
});

function isPedal(name: string) {
    const n = name.toLowerCase();
    return n.includes('pedal') || n.includes('pedale') || n.includes('pedaal') || n.startsWith('ped') || n === 'p';
}

const filteredScreens = computed(() => {
    return organStore.organData?.screens.filter((screen: any) => {
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

// RAM Monitoring
const ramUsage = ref(0);
const formattedRam = computed(() => {
    return (ramUsage.value / 1024 / 1024 / 1024).toFixed(2) + ' GB';
});

const ramColor = computed(() => {
    const usageGB = ramUsage.value / 1024 / 1024 / 1024;

    // RGB Values
    // Green: #4caf50 (76, 175, 80)
    // Yellow/Orange: #ff9800 (255, 152, 0)
    // Red: #f44336 (244, 67, 54)

    if (usageGB <= 1) return '#4caf50'; // Green

    if (usageGB < 2) {
        // Interpolate Green -> Yellow
        const t = (usageGB - 1); // 0 to 1
        const r = Math.round(76 + (255 - 76) * t);
        const g = Math.round(175 + (152 - 175) * t);
        const b = Math.round(80 + (0 - 80) * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else if (usageGB < 4) {
        // Interpolate Yellow -> Red
        const t = (usageGB - 2) / 2; // 0 to 1
        const r = Math.round(255 + (244 - 255) * t);
        const g = Math.round(152 + (67 - 152) * t);
        const b = Math.round(0 + (54 - 0) * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        return '#f44336'; // Red
    }
});

let ramListenerCleanup: (() => void) | null = null;

// Virtual Stop logic
const vsForm = ref({
    id: undefined as string | undefined, // undefined for new, set for edit
    originalStopId: '',
    name: '',
    pitch: '',
    pitchShift: 0,
    harmonicMultiplier: 1.0,
    noteOffset: 0,
    delay: 0
});

function openCreateVirtualStop(stopId: string) {
    const stop = organStore.organData?.stops[stopId];
    if (!stop) return;

    const { name, pitch } = parseStopLabel(stop.name);
    vsForm.value = {
        id: undefined,
        originalStopId: stopId,
        name: name + ' (V)',
        pitch: pitch,
        pitchShift: 0,
        harmonicMultiplier: 1.0,
        noteOffset: 0,
        delay: 0
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
        noteOffset: vs.noteOffset,
        delay: vs.delay || 0
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
        noteOffset: vsForm.value.noteOffset,
        delay: vsForm.value.delay || 0
    };

    if (vsForm.value.id) {
        organStore.updateVirtualStop(vs);
    } else {
        organStore.addVirtualStop(vs);
    }
    showVsDialog.value = false;
}

function getVirtualStopsFor(stopId: string) {
    return organStore.virtualStops.filter(v => v.originalStopId === stopId);
}

const drawerTabs = computed(() => {
    const tabs = [
        { id: 'combinations', icon: 'mdi-view-list', label: 'Banks', tooltip: 'Combination Banks' },
        { id: 'recordings', icon: 'mdi-microphone', label: 'Record', tooltip: 'Recordings' },
        { id: 'export', icon: 'mdi-sd', label: 'SD Card', tooltip: 'Tsunami SD Export' },
        { id: 'settings', icon: 'mdi-cog', label: 'Setup', tooltip: 'Audio & RAM Settings' }
    ];

    if (isDevToolsOpen.value) {
        tabs.splice(3, 0, { id: 'debug', icon: 'mdi-bug', label: 'Debug', tooltip: 'System Inspector' });
    }

    return tabs;
});

const midiColor = computed(() => {
    if (organStore.midiStatus === 'Connected') return 'green-5';
    if (organStore.midiStatus === 'Error') return 'red-5';
    return 'grey-7';
});

onUnmounted(() => {
    // Kill engine and workers
    organStore.stopOrgan();

    if (ramListenerCleanup) ramListenerCleanup();

    if (exportStore.drivePollInterval) {
        clearInterval(exportStore.drivePollInterval as any);
        exportStore.drivePollInterval = null;
    }
});
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

.border-dashed {
    border: 1px dashed #444;
}

.output-destination-area {
    transition: all 0.3s ease;
}

.animate-blink {
    animation: blink 1.5s infinite;
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