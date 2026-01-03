<template>
    <div v-if="loading" class="loading-screen">
        <div class="spinner"></div>
        <div class="font-cinzel text-accent">Loading Console...</div>
    </div>
    <div v-else class="remote-layout">
        <header>
            <div class="header-left">
                <h1 class="font-cinzel organ-name text-accent">{{ organData?.name || 'The Choir Organ' }}</h1>
                <!-- Screen Selector (Condensed) -->
                <div v-if="screens.length > 1" class="header-tabs">
                    <div v-for="(s, idx) in screens" :key="s.id" class="header-tab"
                        :class="{ active: currentScreenIndex === idx }" @click="switchToScreen(idx)">
                        {{ s.name }}
                    </div>
                </div>
            </div>

            <div class="header-right">
                <button class="gc-btn" @click="organStore.clearCombination()" title="General Cancel (Clear All Stops)">
                    GC
                </button>
                <button v-if="!isStandalone" class="fullscreen-btn" @click="toggleFullscreen"
                    :title="isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'">
                    <i class="fullscreen-icon">{{ isFullscreen ? '󱅁' : '󰊓' }}</i>
                </button>
                <div class="status-indicator">
                    <span class="status-dot" :class="connected ? 'status-online' : 'status-offline'"></span>
                    <span class="status-text">{{ connected ? 'Connected' : 'Offline' }}</span>
                </div>
            </div>
        </header>

        <main class="main-view">
            <!-- Graphical Console View -->
            <OrganScreen v-if="currentScreen" :screen="currentScreen" />

            <!-- Fallback List View -->
            <div v-else-if="organData" class="fallback-view">
                <template v-for="manual in organData.manuals" :key="manual.id">
                    <div v-if="getManualStops(manual).length > 0" class="manual-group font-cinzel">
                        {{ manual.name }}
                    </div>
                    <div v-for="stopId in manual.stopIds" :key="stopId" class="stop-btn"
                        :class="{ active: activatedStops.includes(stopId) }" @click="organStore.toggleStop(stopId)">
                        <div>{{ organData.stops[stopId]?.name }}</div>
                        <div v-if="organData.stops[stopId]?.pitch" class="stop-pitch">
                            {{ organData.stops[stopId]?.pitch }}
                        </div>
                    </div>
                </template>
            </div>

            <div v-else
                style="display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5;">
                No organ loaded in the main app.
            </div>
        </main>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive, inject } from 'vue';
import OrganScreen from 'src/components/OrganScreen.vue';

const loading = ref(true);
const connected = ref(false);
const organData = ref<any>(null);
const screens = ref<any[]>([]);
const currentScreenIndex = ref(0);
const activatedStops = ref<string[]>([]);
const manuallySwitched = ref(false);

const isFullscreen = ref(false);
const isStandalone = ref(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
        isFullscreen.value = true;
    } else {
        document.exitFullscreen();
        isFullscreen.value = false;
    }
}

// Listen for fullscreen changes (e.g. Esc key)
document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement;
});

// Mock store to satisfy OrganScreen.vue
const organStore = reactive({
    currentCombination: computed(() => activatedStops.value),
    toggleStop(stopId: string) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'toggleStop', stopId }));
        }
    },
    setStopState(stopId: string, isOn: boolean) {
        const isCurrentlyOn = activatedStops.value.includes(stopId);
        if (isCurrentlyOn !== isOn) {
            this.toggleStop(stopId);
        }
    },
    clearCombination() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'clearCombination' }));
        }
    },
    // These are for Electron renderer process to listen to main process events
    // They are not used in the web remote, but are part of the shared interface
    onRemoteToggleStop: (callback: (event: any, stopId: string) => void) => {
        // In a web environment, ipcRenderer is not available.
        // This function is a no-op or can throw an error if called.
        console.warn("onRemoteToggleStop called in web environment. This is an Electron-specific API.");
        return () => { }; // Return a no-op unsubscribe function
    },
    onRemoteClearCombination: (callback: (event: any) => void) => {
        // In a web environment, ipcRenderer is not available.
        // This function is a no-op or can throw an error if called.
        console.warn("onRemoteClearCombination called in web environment. This is an Electron-specific API.");
        return () => { }; // Return a no-op unsubscribe function
    },
});

const currentScreen = computed(() => {
    return screens.value[currentScreenIndex.value] || null;
});

function switchToScreen(index: number) {
    currentScreenIndex.value = index;
    manuallySwitched.value = true;
}

const getManualStops = (manual: any) => {
    if (!organData.value) return [];
    return (manual.stopIds || []).map((id: string) => organData.value.stops[id]).filter(Boolean);
};

// Polling & Keep-alive
let pollTimer: any = null;
let pingTimer: any = null;

function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
        try {
            const resp = await fetch('/?t=' + Date.now(), { method: 'HEAD' });
            if (resp.ok) {
                console.log('[Remote] Server back! Reloading...');
                window.location.reload();
            }
        } catch (e) {
            // Still offline
        }
    }, 2000);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function startKeepalive() {
    stopKeepalive();
    pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'keepalive' }));
        }
    }, 2000);
}

function stopKeepalive() {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
}

let ws: WebSocket;
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        connected.value = true;
        loading.value = false;
        stopPolling();
        startKeepalive();
    };

    ws.onclose = () => {
        connected.value = false;
        stopKeepalive();
        startPolling();
        setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'tco-init' || data.type === 'tco-update') {
            // If organ name changed, reset manual override
            if (data.organData?.name && data.organData.name !== organData.value?.name) {
                manuallySwitched.value = false;
            }

            if (data.organData) organData.value = data.organData;
            if (data.screens) screens.value = data.screens;
            if (data.activeScreenIndex !== undefined && !manuallySwitched.value) {
                currentScreenIndex.value = data.activeScreenIndex;
            }
            activatedStops.value = data.activatedStops || [];
        }
    };
}

onMounted(() => {
    connect();
});

// Provide for children if needed (OrganScreen uses it)
import { provide } from 'vue';
provide('organStore', organStore);
</script>

<style scoped>
/* Scoped styles are handled by Vite, moving global reset/layout to style.css */
.gc-btn {
    background: #d32f2f;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-weight: bold;
    cursor: pointer;
    margin-right: 12px;
}

.gc-btn:active {
    background: #b71c1c;
}
</style>
