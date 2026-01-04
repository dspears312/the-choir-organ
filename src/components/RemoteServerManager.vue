<template>
    <div class="remote-server-manager column no-wrap full-height">
        <div class="q-pa-md bg-header-gradient border-bottom-amber">
            <div class="text-h6 font-cinzel text-amber-9">Remote Control</div>
            <div class="text-caption text-grey-6">Access organ controls via web browser</div>
        </div>

        <div class="q-pa-md column q-gutter-y-md">
            <q-card dark bordered class="bg-black-50 border-amber-muted">
                <q-card-section>
                    <div class="row items-center justify-between">
                        <div class="column">
                            <div class="text-subtitle2"
                                :class="organStore.remoteServerStatus.running ? 'text-green' : 'text-grey-6'">
                                {{ organStore.remoteServerStatus.running ? 'Server Active' : 'Server Offline' }}
                            </div>
                            <div v-if="organStore.remoteServerStatus.running"
                                class="text-caption text-amber-7 font-mono">
                                {{ organStore.remoteServerStatus.ips[0] }}:{{ organStore.remoteServerStatus.port }}
                            </div>
                        </div>
                        <q-btn :color="organStore.remoteServerStatus.running ? 'red-9' : 'green-9'"
                            :label="organStore.remoteServerStatus.running ? 'Stop Server' : 'Start Server'" unelevated
                            size="sm" class="q-px-md" @click="organStore.toggleRemoteServer" />
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
                            <q-btn flat round dense icon="content_copy" size="xs" color="grey-7"
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

            <div v-else class="text-body2 text-grey-5 q-pa-sm italic">
                Start the server to enable remote control of stop combinations from other devices.
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useOrganStore } from 'src/stores/organ';

const organStore = useOrganStore();

const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
};
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
