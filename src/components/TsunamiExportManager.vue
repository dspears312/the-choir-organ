<template>
    <div class="tsunami-export-manager column no-wrap full-height">
        <div class="q-pa-md bg-header-gradient border-bottom-amber">
            <div class="text-h6 font-cinzel text-amber-9">Tsunami Export</div>
            <div class="text-caption text-grey-6">Prepare SD card for hardware playback</div>
        </div>

        <div class="q-pa-md column q-gutter-y-md">
            <!-- Destination picker -->
            <div v-if="!exportStore.isRendering" class="output-destination-area column q-gutter-y-xs">
                <div class="row items-center justify-between">
                    <div class="text-caption text-grey-6">Target Device</div>
                    <q-btn flat dense color="grey-6" :icon="showAdvanced ? 'mdi-arrow-left' : 'mdi-cog'" size="xs"
                        @click="showAdvanced = !showAdvanced">
                        <q-tooltip>{{ showAdvanced ? 'Back to Drive Picker' : 'Advanced Options' }}</q-tooltip>
                    </q-btn>
                </div>

                <!-- Drive Picker -->
                <div v-if="!showAdvanced" class="drive-picker q-gutter-y-sm">
                    <div v-for="drive in exportStore.availableDrives" :key="drive.mountPoint"
                        class="drive-item q-pa-sm rounded-borders cursor-pointer row items-center no-wrap"
                        :class="{ 'drive-selected': exportStore.outputDir === drive.mountPoint }"
                        @click="selectDrive(drive)">
                        <q-icon
                            :name="(drive.volumeName === 'TCO' || drive.volumeName === organStore.targetVolumeLabel) ? 'mdi-sd' : 'mdi-usb'"
                            :color="(drive.volumeName === 'TCO' || drive.volumeName === organStore.targetVolumeLabel) ? 'amber' : 'grey-5'"
                            size="sm" class="q-mr-sm" />
                        <div class="col overflow-hidden">
                            <div class="text-caption text-weight-bold ellipsis">{{ drive.volumeName || 'Untitled' }}
                            </div>
                            <div class="text-xs text-grey-6 ellipsis">{{ drive.mountPoint }}</div>
                        </div>
                        <q-icon v-if="exportStore.outputDir === drive.mountPoint" name="mdi-check-circle" color="amber"
                            size="xs" />
                    </div>

                    <div v-if="exportStore.availableDrives.length === 0"
                        class="text-center q-pa-md border-dashed rounded-borders text-grey-7 italic text-xs">
                        No removable drives detected
                    </div>
                </div>

                <!-- Advanced / Selection fallback -->
                <q-btn v-if="exportStore.availableDrives.length === 0 || showAdvanced" outline color="amber-7"
                    icon="mdi-folder-open" label="Select Custom Folder" class="full-width font-cinzel text-xs"
                    @click="exportStore.setOutputDir" />

                <!-- Advanced Folder View -->
                <div v-if="showAdvanced && exportStore.outputDir"
                    class="advanced-folder q-pa-sm rounded-borders bg-black-50 border-amber-muted q-mt-sm">
                    <div class="text-caption text-amber-8">Selected Path</div>
                    <div class="text-xs text-grey-5 ellipsis dir-path">
                        {{ exportStore.outputDir }}
                    </div>
                </div>
            </div>

            <!-- Burn Button -->
            <q-btn id="btn-burn-card" color="red-10"
                :label="exportStore.isOutputRemovable ? 'Burn to Card' : 'Copy to Folder'"
                class="full-width font-cinzel q-py-md shadow-10" :loading="exportStore.isRendering"
                :disable="organStore.banks.length === 0" @click="handleBurnClick"
                :icon-right="exportStore.isOutputRemovable ? 'mdi-sd' : 'mdi-folder'">
            </q-btn>

            <!-- Progress Area -->
            <div v-if="exportStore.isRendering" class="q-mt-md">
                <div class="text-caption text-amber text-center q-mb-xs">
                    {{ exportStore.renderStatus || 'Rendering...' }}
                </div>
                <q-linear-progress stripe :value="exportStore.renderProgress" color="amber" size="12px" rounded />
                <div class="row items-center justify-between q-mt-xs">
                    <div class="text-xs text-grey-6">{{ Math.round(exportStore.renderProgress * 100) }}%</div>
                    <q-btn flat dense color="red-5" label="Cancel" size="sm" icon="mdi-close"
                        @click="exportStore.cancelRendering" />
                </div>
            </div>

            <!-- Ready / Preview Area -->
            <div v-else-if="exportStore.outputDir"
                class="row items-center justify-between q-px-sm bg-green-10 rounded-borders animate-fade q-py-sm q-mt-md">
                <div class="column">
                    <div class="text-caption text-white text-weight-bold">
                        {{ exportStore.isOutputRemovable ? 'Drive Ready' : 'Folder Ready' }}
                    </div>
                    <div class="text-xs text-green-2 ellipsis" style="max-width: 200px">{{ exportStore.outputDir }}
                    </div>
                </div>
                <q-btn flat dense color="white" label="Preview" size="sm" class="text-weight-bold"
                    @click="$router.push({ path: '/preview', query: { folder: exportStore.outputDir } })" />
            </div>

            <div v-if="organStore.banks.length === 0"
                class="bg-amber-10 q-pa-sm rounded-borders text-black text-caption q-mt-sm">
                <q-icon name="mdi-information" /> Create at least one combination bank before exporting.
            </div>
        </div>

        <!-- Dialogs -->
        <q-dialog v-model="showDiskWarning" persistent>
            <q-card dark style="min-width: 450px; background: #1a1a1a; border: 1px solid #444;" class="q-pa-md">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6 font-cinzel text-amber">
                        <q-icon name="mdi-alert" color="amber" size="32px" class="q-mr-md" />
                        Compatibility Warning
                    </div>
                </q-card-section>
                <q-card-section class="q-pt-md text-body2">
                    <p>The selected output directory is a folder on your computer.</p>
                    <p class="text-grey-5">Tsunami SD cards are very sensitive to file system alignment. For hardware
                        playback, formatting a real SD card is highly recommended.</p>
                    <q-checkbox v-model="exportStore.suppressDiskWarning" label="Don't warn me again" dark color="amber"
                        class="q-mt-sm" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Cancel" color="grey-6" v-close-popup />
                    <q-btn label="Proceed Anyways" color="amber-9" text-color="black" @click="startRendering"
                        v-close-popup />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <q-dialog v-model="showFormatDialog" persistent>
            <q-card dark style="min-width: 500px; background: #1a1a1a; border: 2px solid #d32f2f;"
                class="q-pa-lg shadow-24">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h5 font-cinzel text-red-5">
                        <q-icon name="mdi-sd" color="red-5" size="40px" class="q-mr-md" />
                        Format SD Card?
                    </div>
                </q-card-section>
                <q-card-section class="q-pt-md">
                    <div class="bg-red-10 q-pa-md rounded-borders q-mb-md border-red">
                        <div class="text-subtitle1 text-weight-bold text-white">ALL DATA ON THIS VOLUME WILL BE ERASED
                        </div>
                        <div class="text-caption text-red-2">Mandatory for reliable Tsunami performance.</div>
                    </div>
                    <p class="text-body2">Volume will be named: <span class="text-amber text-weight-bold font-mono">"{{
                        organStore.targetVolumeLabel }}"</span></p>
                </q-card-section>
                <q-card-actions vertical align="center" class="q-gutter-y-sm">
                    <q-btn label="ERASE AND FORMAT (Recommended)" color="red-7"
                        class="full-width q-py-md text-weight-bold" @click="handleFormatAndRender" v-close-popup />
                    <div class="row full-width q-gutter-x-sm">
                        <q-btn flat label="Just copy files" color="grey-6" class="col" @click="startRendering"
                            v-close-popup />
                        <q-btn flat label="Cancel" color="white" class="col" v-close-popup />
                    </div>
                </q-card-actions>
            </q-card>
        </q-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import { useExportStore } from 'src/stores/export';

const organStore = useOrganStore();
const exportStore = useExportStore();

const showAdvanced = ref(false);
const showDiskWarning = ref(false);
const showFormatDialog = ref(false);

const selectDrive = (drive: any) => {
    exportStore.outputDir = drive.mountPoint;
    exportStore.isOutputRemovable = true;
};

const handleBurnClick = async () => {
    const result = await exportStore.checkOutputPath();
    if (result.type === 'removable_root') {
        showFormatDialog.value = true;
    } else if (result.type === 'local_folder') {
        showDiskWarning.value = true;
    } else {
        startRendering();
    }
};

const startRendering = () => {
    exportStore.renderAll();
};

const handleFormatAndRender = async () => {
    try {
        await exportStore.formatOutputVolume();
        startRendering();
    } catch (e) {
        console.error('Format failed', e);
    }
};
</script>

<style scoped>
.bg-header-gradient {
    background: linear-gradient(to bottom, #2a2a2a, #1a1a1a);
}

.border-bottom-amber {
    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
}

.drive-item {
    border: 1px solid #333;
    transition: all 0.2s ease;
}

.drive-item:hover {
    background: rgba(212, 175, 55, 0.05);
    border-color: #555;
}

.drive-selected {
    border-color: #d4af37;
    background: rgba(212, 175, 55, 0.1);
}

.border-amber-muted {
    border: 1px solid rgba(212, 175, 55, 0.1);
}

.bg-black-50 {
    background: rgba(0, 0, 0, 0.5);
}

.animate-fade {
    animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}
</style>
