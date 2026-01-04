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
</style>
