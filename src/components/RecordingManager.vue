<template>
    <div class="recording-manager column no-wrap full-height">
        <div class="q-pa-md bg-header-gradient border-bottom-amber row items-center justify-between">
            <div class="text-h6 font-cinzel text-amber-9">Recordings</div>
            <div class="row items-center q-gutter-x-sm">
                <q-btn round flat dense :color="organStore.isRecording ? 'red' : 'grey-6'"
                    :icon="organStore.isRecording ? 'stop' : 'fiber_manual_record'"
                    :class="{ 'animate-blink': organStore.isRecording }" @click="toggleRecording">
                    <q-tooltip>{{ organStore.isRecording ? 'Stop Recording' : 'Start Recording' }}</q-tooltip>
                </q-btn>
                <div v-if="organStore.isRecording" class="font-cinzel text-red text-caption gt-xs animate-fade">
                    REC
                </div>
            </div>
        </div>

        <div v-if="isRenderingExport" class="q-pa-md bg-grey-9 q-mb-sm">
            <div class="text-caption text-grey-4 q-mb-xs">{{ renderStatus || 'Rendering...' }}</div>
            <q-linear-progress stripe size="15px" :value="(renderProgress || 0) / 100" color="amber-9">
                <div class="absolute-full flex flex-center">
                    <q-badge color="transparent" text-color="black" :label="(renderProgress || 0) + '%'" />
                </div>
            </q-linear-progress>
        </div>

        <q-scroll-area class="col"
            :thumb-style="{ width: '5px', borderRadius: '5px', background: '#d4af37', opacity: '0.5' }">
            <q-list dark separator>
                <q-item v-if="organStore.recordings.length === 0" class="text-grey-6 text-center italic q-pa-lg">
                    No recordings available.
                </q-item>

                <q-item v-for="rec in organStore.recordings" :key="rec.id" class="q-py-md">
                    <q-item-section>
                        <q-item-label class="text-amber-1 font-cinzel text-weight-bold">
                            {{ rec.name }}
                            <q-popup-edit v-model="rec.name" auto-save v-slot="scope" class="bg-grey-10 text-amber">
                                <q-input v-model="scope.value" dense autofocus @keyup.enter="scope.set" dark
                                    color="amber" />
                            </q-popup-edit>
                            <q-icon name="edit" size="xs" color="grey-8"
                                class="q-ml-sm cursor-pointer opacity-50 hover-opacity-100" />
                        </q-item-label>
                        <q-item-label caption class="text-grey-5">
                            {{ new Date(rec.date).toLocaleString() }}
                        </q-item-label>
                        <q-item-label caption class="text-grey-6">
                            {{ (rec.duration / 1000).toFixed(1) }}s • {{ rec.events.length }} events
                        </q-item-label>
                    </q-item-section>

                    <q-item-section side>
                        <div class="row q-gutter-x-xs">
                            <q-btn v-if="allowExport" flat round dense icon="download" color="green-5"
                                @click="initRenderRecording(rec)">
                                <q-tooltip>Render to WAV</q-tooltip>
                            </q-btn>
                            <q-btn flat round dense icon="delete" color="red-9"
                                @click="organStore.deleteRecording(rec.id)">
                                <q-tooltip>Delete</q-tooltip>
                            </q-btn>
                        </div>
                    </q-item-section>
                </q-item>
            </q-list>
        </q-scroll-area>
    </div>

    <!-- Render Options Dialog -->
    <q-dialog v-model="showRenderOptions" persistent>
        <q-card dark style="min-width: 400px; background: #1a1a1a; border: 1px solid #444;" class="q-pa-md">
            <q-card-section>
                <div class="text-h6 font-cinzel text-amber">Render Recording</div>
                <div class="text-caption text-grey-5 q-mb-md">Choose rendering mode for "{{
                    exportStore?.selectedRecording?.name
                }}"
                </div>

                <q-list dark>
                    <q-item tag="label" v-ripple class="bg-grey-9 rounded-borders q-mb-sm">
                        <q-item-section avatar>
                            <q-radio v-model="renderMode" val="tsunami" color="amber" />
                        </q-item-section>
                        <q-item-section>
                            <q-item-label>Standard (Tsunami Mode)</q-item-label>
                            <q-item-label caption>Fast decay (50ms fade out). Best for hardware/sampler
                                use.</q-item-label>
                        </q-item-section>
                    </q-item>

                    <q-item tag="label" v-ripple class="bg-grey-9 rounded-borders">
                        <q-item-section avatar>
                            <q-radio v-model="renderMode" val="tails" color="amber" />
                        </q-item-section>
                        <q-item-section>
                            <q-item-label>High Quality (With Tails)</q-item-label>
                            <q-item-label caption>Full natural release samples. Best for
                                listening.</q-item-label>
                        </q-item-section>
                    </q-item>
                </q-list>
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat label="Cancel" color="grey-6" v-close-popup />
                <q-btn label="Render" color="amber-9" text-color="black" @click="confirmRenderRecording"
                    v-close-popup />
            </q-card-actions>
        </q-card>
    </q-dialog>

</template>

<script setup lang="ts">
import { inject, computed } from 'vue';

const props = withDefaults(
    defineProps<{
        isRenderingExport?: boolean
        renderStatus?: string
        renderProgress?: number
        allowExport?: boolean
    }>(),
    {
        allowExport: true,
    }
)

const emit = defineEmits(['toggle-recording']);

// Use injection to allow mocking in remote app
const organStore = inject<any>('organStore');
const exportStore = inject<any>('exportStore');

// Safe computed properties to avoid template errors if exportStore is null
const showRenderOptions = computed({
    get: () => exportStore?.showRenderOptions || false,
    set: (val) => { if (exportStore) exportStore.showRenderOptions = val; }
});

const renderMode = computed({
    get: () => exportStore?.renderMode || 'tsunami',
    set: (val) => { if (exportStore) exportStore.renderMode = val; }
});

const toggleRecording = () => {
    emit('toggle-recording');
};

const initRenderRecording = (rec: any) => {
    if (exportStore) {
        exportStore.selectedRecording = rec;
        exportStore.showRenderOptions = true;
    } else {
        console.warn('Export store not available in remote mode');
    }
};

const confirmRenderRecording = async () => {
    if (exportStore && exportStore.selectedRecording) {
        const useTails = exportStore.renderMode === 'tails';
        await exportStore.renderPerformance(exportStore.selectedRecording, organStore.organData, useTails);
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
