<template>
    <div class="settings-manager column no-wrap full-height">
        <div class="q-pa-md bg-header-gradient border-bottom-amber">
            <div class="text-h6 font-cinzel text-amber-9">Settings</div>
            <div class="text-caption text-grey-6">Audio and performance configuration</div>
        </div>

        <div class="q-pa-md column q-gutter-y-lg">
            <div class="column q-gutter-y-sm">
                <div class="text-subtitle2 text-grey-4">Local Worker Processes</div>
                <div class="text-caption text-grey-6">
                    Distribute synthesis across multiple CPU cores.
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

            <div class="column q-gutter-y-sm">
                <div class="text-subtitle2 text-grey-4">Advanced Settings</div>
                <div class="text-caption text-grey-6">
                    Manage sample-level settings, release modes, and ranks.
                </div>
                <q-btn outline color="amber-7" label="Open Full Audio Settings" icon="mdi-tune"
                    class="full-width q-mt-sm" @click="$emit('open-advanced')" />
            </div>

            <q-separator dark />

            <!-- Remote Server Section (Moved from RemoteServerManager) -->
            <div class="column q-gutter-y-sm">
                <div class="text-subtitle2 text-grey-4">Remote Control</div>
                <div class="text-caption text-grey-6">Access organ controls via web browser</div>

                <q-card dark bordered class="bg-black-50 border-amber-muted">
                    <q-card-section>
                        <div class="row items-center justify-between">
                            <div class="column">
                                <div class="text-subtitle2"
                                    :class="organStore.remoteServerStatus.running ? 'text-green' : 'text-grey-6'">
                                    {{ organStore.remoteServerStatus.running ? 'Server Active' : 'Server Offline' }}
                                </div>
                                <!-- Port Input -->
                                <div class="row items-center q-mt-sm">
                                    <q-input dense dark v-model.number="settingsStore.remoteServerPort" type="number"
                                        label="Port" class="q-mr-sm" :disable="organStore.remoteServerStatus.running"
                                        @update:model-value="updatePort" input-class="text-amber font-mono"
                                        label-color="grey-6" />
                                </div>
                            </div>
                            <q-btn :color="organStore.remoteServerStatus.running ? 'red-9' : 'green-9'"
                                :label="organStore.remoteServerStatus.running ? 'Stop Server' : 'Start Server'"
                                unelevated size="sm" class="q-px-md" @click="organStore.toggleRemoteServer" />
                        </div>
                    </q-card-section>
                </q-card>

                <div v-if="organStore.remoteServerStatus.running" class="column q-gutter-y-sm">
                    <div class="text-overline text-amber-9">Available Addresses</div>
                    <q-list dark bordered separator class="rounded-borders bg-grey-10">
                        <q-item v-for="ip in organStore.remoteServerStatus.ips" :key="ip" class="q-py-xs">
                            <q-item-section>
                                <q-item-label class="text-caption font-mono text-grey-4">http://{{ ip }}:{{
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
                    <div class="text-caption text-grey-6 q-mt-sm">
                        Connect your phone or tablet to the same Wi-Fi network and visit one of the URLs above.
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useSettingsStore } from 'src/stores/settings';
import { useOrganStore } from 'src/stores/organ';

const emit = defineEmits(['open-advanced']);

const settingsStore = useSettingsStore();
const organStore = useOrganStore();

const saveGlobalSettings = async () => {
    await settingsStore.saveSettings({ workerCount: settingsStore.workerCount });
};

const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
}

.bg-black-50 {
    background: rgba(0, 0, 0, 0.5);
}

.border-amber-muted {
    border: 1px solid rgba(212, 175, 55, 0.1);
}
</style>
