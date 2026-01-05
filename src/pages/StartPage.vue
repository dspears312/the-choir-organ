<template>
    <q-page class="start-page text-white flex flex-center">
        <div class="welcome-container full-width flex column flex-center">
            <!-- Extraction Progress Overlay -->
            <q-dialog v-model="organStore.isExtracting" persistent transition-show="scale" transition-hide="scale">
                <q-card dark style="width: 500px; background: rgba(20, 20, 20, 0.95); border: 1px solid #d4af37;"
                    class="q-pa-lg shadow-24">
                    <q-card-section class="column items-center">
                        <q-icon name="mdi-archive" size="64px" color="amber-7" class="q-mb-md" />
                        <div class="text-h5 font-cinzel text-amber-8 q-mb-sm">Extracting Organ</div>
                        <div class="text-caption text-grey-5 text-center q-mb-lg">This may take a few minutes for large
                            archives...
                        </div>

                        <q-linear-progress :value="organStore.extractionProgress" color="amber-7" size="12px" rounded
                            class="q-mb-sm" />
                        <div class="row full-width justify-between items-center q-mb-md">
                            <div class="text-h6 text-amber-1">{{ Math.round(organStore.extractionProgress * 100) }}%
                            </div>
                            <div class="text-caption text-grey-6 ellipsis" style="max-width: 300px;">{{
                                organStore.extractionFile }}
                            </div>
                        </div>
                    </q-card-section>
                </q-card>
            </q-dialog>

            <!-- Loading Organ Overlay -->
            <q-dialog v-model="organStore.isLoadingOrgan" persistent transition-show="scale" transition-hide="scale">
                <q-card dark style="width: 400px; background: rgba(20, 20, 20, 0.95); border: 1px solid #d4af37;"
                    class="q-pa-lg shadow-24">
                    <q-card-section class="column items-center">
                        <q-spinner-gears color="amber-7" size="64px" class="q-mb-md" />
                        <div class="text-h5 font-cinzel text-amber-8 q-mb-sm">Loading Organ</div>
                        <div class="text-caption text-grey-5 text-center">Reading organ definition and preparing
                            console...
                        </div>
                    </q-card-section>
                </q-card>
            </q-dialog>

            <!-- Unified Management Dialog -->
            <q-dialog v-model="isInfoDialogVisible">
                <q-card dark style="width: 500px; background: rgba(30, 30, 30, 0.95); border: 1px solid #444;"
                    class="q-pa-md shadow-24">
                    <q-card-section class="row items-center q-pb-none">
                        <div class="text-h6 font-cinzel text-amber-5 ellipsis">{{ selectedOrgan?.name }}</div>
                        <q-space />
                        <q-btn icon="mdi-close" flat round dense v-close-popup />
                    </q-card-section>

                    <q-card-section>
                        <div class="text-caption text-grey-5 q-mb-sm">Location:</div>
                        <div class="text-body2 text-grey-3 q-mb-md" style="word-break: break-all;">
                            {{ selectedOrgan?.path }}
                        </div>

                        <div class="row items-center q-mb-lg">
                            <div class="text-caption text-grey-5 q-mr-md">Total Size:</div>
                            <div v-if="isCalculating" class="row items-center">
                                <q-spinner-dots color="amber" size="1em" class="q-mr-sm" />
                                <span class="text-grey-6 text-caption">Calculating...</span>
                            </div>
                            <div v-else class="text-body1 text-amber-1 font-cinzel">
                                {{ selectedOrgan?.size || 'Unknown' }}
                            </div>
                        </div>

                        <q-separator dark class="q-mb-md" />

                        <div class="column q-gutter-y-md">
                            <q-btn outline color="warning" label="Remove from List" icon="mdi-close"
                                @click="handleRemoveList" align="left" class="full-width"
                                hint="Removes this item from the recent list. Files remain on disk." />

                            <q-separator dark />

                            <div class="text-caption text-grey-5">Troubleshooting</div>
                            <div class="row q-col-gutter-sm">
                                <div class="col-6">
                                    <q-btn outline color="amber-9" label="Clear Cache" icon="mdi-cached"
                                        @click="handleClearCache" align="left" class="full-width" size="sm" />
                                </div>
                                <div class="col-6">
                                    <q-btn outline color="orange-9" label="Clear Save Data" icon="mdi-restore"
                                        @click="handleClearSave" align="left" class="full-width" size="sm" />
                                </div>
                            </div>

                            <q-separator dark />

                            <q-btn outline color="negative" label="Delete from Disk" icon="mdi-delete-forever"
                                @click="handleDeleteDisk" align="left" class="full-width" />
                        </div>
                    </q-card-section>
                </q-card>
            </q-dialog>

            <!-- First time user vs returning user -->
            <div v-if="organStore.recentFiles.length === 0" class="first-time-container column items-center">
                <q-icon name="mdi-piano" size="120px" class="text-amber-8 q-mb-lg" />
                <div class="text-h2 font-cinzel text-amber-9 q-mb-xl text-center">The Choir Organ</div>
                <q-btn id="btn-open-odf-prominent" color="amber-9" size="xl" label="Install Organ"
                    @click="() => organStore.installOrgan()" icon="mdi-folder-open" class="font-cinzel q-px-xl q-py-md"
                    outline />
                <div class="q-mt-xl text-center">
                    <q-btn flat color="grey-6" label="Preview SD card" @click="$router.push('/preview')"
                        class="font-cinzel text-subtitle1" icon="mdi-sd" />
                </div>
            </div>

            <div v-else class="returning-user-container full-width column items-center">
                <!-- Carousel -->
                <div class="carousel-wrapper full-width q-mb-lg">
                    <q-carousel v-model="slide" transition-prev="slide-right" transition-next="slide-left" swipeable
                        animated control-color="amber-7" navigation infinite arrows height="400px"
                        class="bg-transparent rounded-borders">
                        <q-carousel-slide v-for="(file, index) in organStore.recentFiles" :key="file" :name="index"
                            class="column no-wrap flex-center cursor-pointer"
                            @click="$router.push({ path: '/builder', query: { file } })">
                            <div class="slide-background-gradient absolute-full"></div>
                            <q-icon name="mdi-church" size="100px" color="amber-8" class="q-mb-md"
                                style="z-index: 1;" />
                            <div class="text-h3 font-cinzel text-amber-1 q-px-xl text-center" style="z-index: 1;">
                                {{ getDisplayName(file) }}
                            </div>
                        </q-carousel-slide>
                    </q-carousel>
                </div>

                <!-- List & Other Buttons -->
                <div class="list-wrapper q-pa-md" style="max-width: 600px; width: 100%;">
                    <div class="text-overline text-grey-6 q-mb-sm text-center">Recent Organs</div>
                    <q-list dark separator bordered class="rounded-borders bg-grey-10 shadow-2">
                        <q-item v-for="file in organStore.recentFiles" :key="file" clickable v-ripple
                            @click="loadOrgan($event, file)">
                            <q-item-section avatar>
                                <q-icon name="mdi-history" color="amber-7" />
                            </q-item-section>
                            <q-item-section>
                                <q-item-label class="text-amber-1 ellipsis">{{ getDisplayName(file) }}</q-item-label>
                            </q-item-section>
                            <q-item-section side>
                                <div class="row q-gutter-x-xs">
                                    <q-btn flat round color="grey-5" icon="mdi-dots-vertical"
                                        @click.stop="openManagementDialog(file)" />
                                </div>
                            </q-item-section>
                        </q-item>
                    </q-list>

                    <div class="row q-mt-xl justify-center q-gutter-md">
                        <q-btn color="amber-9" outline label="Install Organ" icon="mdi-folder-open"
                            @click="() => organStore.installOrgan()" class="font-cinzel" />
                        <q-btn flat color="grey-6" label="Preview SD card" @click="$router.push('/preview')"
                            class="font-cinzel" icon="mdi-sd" />
                    </div>
                </div>
            </div>
        </div>
    </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useOrganStore } from 'src/stores/organ';
import { useQuasar } from 'quasar';
const organStore = useOrganStore();
const router = useRouter();
const slide = ref(0);
const $q = useQuasar();

const isInfoDialogVisible = ref(false);
const selectedOrgan = ref<{ path: string; name: string; size: string | null } | null>(null);
const isCalculating = ref(false);

function getDisplayName(path: string) {
    if (!path || typeof path !== 'string') return '';
    const basename = path.split(/[\\/]/).pop() || path;
    return basename.replace(/\.organ$/i, '').replace(/\.Organ(_|\.)Hauptwerk(_|\.)xml$/i, '');
}

function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function openManagementDialog(file: string) {
    selectedOrgan.value = {
        path: file,
        name: getDisplayName(file),
        size: null
    };
    isInfoDialogVisible.value = true;
    isCalculating.value = true;

    // Calculate size in background
    try {
        const size = await organStore.getOrganSize(file);
        // Only update if the dialog is still open for the same organ
        if (selectedOrgan.value && selectedOrgan.value.path === file) {
            selectedOrgan.value.size = formatBytes(size);
        }
    } catch (e) {
        console.error('Size calc failed', e);
        if (selectedOrgan.value) selectedOrgan.value.size = 'Unknown';
    } finally {
        isCalculating.value = false;
    }
}

async function loadOrgan($event: Event, file: string) {
    if ($event.shiftKey) {
        await window.myApi.deleteOrganCache(file);
    }
    router.push({ path: '/builder', query: { file } })
}

async function handleClearCache() {
    if (!selectedOrgan.value) return;
    isCalculating.value = true;
    try {
        const result = await window.myApi.deleteOrganCache(selectedOrgan.value.path);
        if (result) {
            $q.notify({ type: 'positive', message: 'Cache cleared successfully' });
        } else {
            $q.notify({ type: 'negative', message: 'Failed to clear cache' });
        }
    } finally {
        isCalculating.value = false;
    }
}

async function handleClearSave() {
    if (!selectedOrgan.value) return;

    const path = selectedOrgan.value.path;
    $q.dialog({
        title: 'Clear Organ Save Data?',
        message: `This will reset all combinations, virtual stops, and volume settings for <b>${getDisplayName(path)}</b>.`,
        html: true,
        dark: true,
        ok: { label: 'Clear Data', color: 'orange-9', flat: true },
        cancel: { label: 'Cancel', color: 'white', flat: true }
    }).onOk(async () => {
        const result = await window.myApi.deleteOrganSave(path);
        if (result) {
            $q.notify({ type: 'positive', message: 'Save data cleared' });
        } else {
            $q.notify({ type: 'negative', message: 'Failed to clear save data' });
        }
    });
}

function handleRemoveList() {
    if (!selectedOrgan.value) return;
    organStore.removeRecent(selectedOrgan.value.path);
    isInfoDialogVisible.value = false;
    $q.notify({ type: 'info', message: 'Removed from recent list' });
}

function handleDeleteDisk() {
    if (!selectedOrgan.value) return;
    const file = selectedOrgan.value.path;

    $q.dialog({
        title: 'Delete Organ Data?',
        message: `Are you sure you want to delete the organ files for <b>${getDisplayName(file)}</b>?<br><br>The system will delete the organ definition file AND any detected dependency folders.<br><br>This action cannot be undone.`,
        html: true,
        dark: true,
        ok: { label: 'Delete', color: 'negative', flat: true },
        cancel: { label: 'Cancel', color: 'white', flat: true }
    }).onOk(async () => {
        isInfoDialogVisible.value = false;
        const dialog = $q.dialog({
            message: 'Deleting...',
            persistent: true,
            dark: true,
            ok: false
        });
        const result = await organStore.deleteOrgan(file);
        dialog.hide();
        if (result.success) {
            $q.notify({ type: 'positive', message: 'Organ deleted successfully' });
        } else {
            $q.dialog({
                title: 'Error',
                message: result.error || 'Failed to delete organ.',
                dark: true
            });
        }
    });
}

onMounted(() => {
    organStore.fetchRecents();
});

watch(() => organStore.organData, (newData) => {
    if (newData) {
        router.push({
            path: '/builder',
            query: { organ: newData.sourcePath }
        });
    }
});
</script>

<style lang="scss" scoped>
.start-page {
    background: radial-gradient(circle at center, #111 0%, #050505 100%);
    overflow: hidden;
}

.font-cinzel {
    font-family: 'Cinzel', serif;
}

.welcome-container {
    padding: 40px;
}

.slide-background-gradient {
    background: linear-gradient(135deg, rgba(30, 30, 30, 0.9) 0%, rgba(10, 10, 10, 0.95) 100%);
}

.list-wrapper {
    z-index: 10;
}

.q-carousel {
    max-width: 1000px;
    margin: 0 auto;
}

.returning-user-container {
    height: 100%;
    justify-content: flex-start;
    padding-top: 5vh;
}

.first-time-container {
    height: 100%;
}
</style>
