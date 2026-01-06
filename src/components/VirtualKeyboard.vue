<template>
    <div class="virtual-keyboard-container bg-grey-10">
        <!-- <div class="keyboard-header row items-center justify-between q-mb-sm">
            <div class="row items-center q-gutter-x-sm">
                <q-btn flat dense round icon="mdi-close" color="grey-7" size="sm"
                    @click="uiStore.showVirtualKeyboard = false" />
            </div>
        </div> -->

        <div ref="scrollContainer" class="keyboard-scroll-area" @mouseleave="allNotesOff">
            <div class="keyboard-row row no-wrap items-end">
                <div v-for="note in visibleNotes" :key="note.midi" class="key-wrapper"
                    :class="{ 'black-key-wrapper': note.isBlack }">
                    <div class="key" :class="[
                        note.isBlack ? 'black-key' : 'white-key',
                        { 'active': activeNotes.has(note.midi) }
                    ]" @mousedown="noteOn(note.midi)" @mouseup="noteOff(note.midi)"
                        @mouseenter="onMouseEnter(note.midi)">
                        <div class="key-label" v-if="!note.isBlack">{{ note.label }}</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import { useUIStore } from 'src/stores/ui';

const organStore = useOrganStore();
const uiStore = useUIStore();
const activeNotes = ref(new Set<number>());
const isMouseDown = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

const notes = [
    { midi: 0, label: 'C', isBlack: false },
    { midi: 1, label: 'C#', isBlack: true },
    { midi: 2, label: 'D', isBlack: false },
    { midi: 3, label: 'D#', isBlack: true },
    { midi: 4, label: 'E', isBlack: false },
    { midi: 5, label: 'F', isBlack: false },
    { midi: 6, label: 'F#', isBlack: true },
    { midi: 7, label: 'G', isBlack: false },
    { midi: 8, label: 'G#', isBlack: true },
    { midi: 9, label: 'A', isBlack: false },
    { midi: 10, label: 'A#', isBlack: true },
    { midi: 11, label: 'B', isBlack: false },
];

const visibleNotes = computed(() => {
    const result = [];
    const baseMidi = 36; // C2

    for (let i = 0; i < 61; i++) { // 61 keys (5 octaves + high C)
        const midi = baseMidi + i;
        const noteInfo = notes[midi % 12];
        if (noteInfo) {
            result.push({
                midi: midi,
                label: noteInfo.label + (Math.floor(midi / 12) - 1),
                isBlack: noteInfo.isBlack
            });
        }
    }
    return result;
});

function noteOn(midi: number) {
    if (activeNotes.value.has(midi)) return;

    activeNotes.value.add(midi);
    isMouseDown.value = true;

    // Simulate MIDI Note ON
    organStore.handleMIDIMessage({
        data: [144, midi, 100]
    });
}

function noteOff(midi: number) {
    if (!activeNotes.value.has(midi)) return;

    activeNotes.value.delete(midi);

    // Simulate MIDI Note OFF
    organStore.handleMIDIMessage({
        data: [128, midi, 0]
    });
}

function onMouseEnter(midi: number) {
    if (isMouseDown.value) {
        noteOn(midi);
    }
}

function allNotesOff() {
    activeNotes.value.forEach(midi => noteOff(midi));
    isMouseDown.value = false;
}

// Global mouse up to stop notes if we leave the key
const onGlobalMouseUp = () => {
    isMouseDown.value = false;
};

onMounted(() => {
    window.addEventListener('mouseup', onGlobalMouseUp);

    nextTick(() => {
        // Scroll to middle C (MIDI 60)
        // MIDI 60 is 24 half-steps from MIDI 36.
        // White keys before MIDI 60 are: 36, 38, 40, 41, 43, 45, 47 (7) + 48, 50, 52, 53, 55, 57, 59 (7) = 14 keys
        // Each white key is 30px.
        if (scrollContainer.value) {
            const whiteKeyWidth = 30;
            const scrollOffset = 14 * whiteKeyWidth;
            // Center it a bit more
            const containerWidth = scrollContainer.value.clientWidth;
            scrollContainer.value.scrollLeft = scrollOffset - (containerWidth / 2) + (whiteKeyWidth / 2);
        }
    });
});

onUnmounted(() => {
    window.removeEventListener('mouseup', onGlobalMouseUp);
    allNotesOff();
});

</script>

<style lang="scss" scoped>
.virtual-keyboard-container {
    user-select: none;
    // border: 1px solid #332211;
    width: 100%;
    overflow: hidden;
    background: #111;
}

.keyboard-scroll-area {
    overflow-x: auto;
    width: 100%;
    scrollbar-width: thin;
    scrollbar-color: #443322 #000;

    &::-webkit-scrollbar {
        height: 8px;
    }

    &::-webkit-scrollbar-track {
        background: #000;
    }

    &::-webkit-scrollbar-thumb {
        background: #443322;
        border-radius: 4px;
        border: 2px solid #000;
    }
}

.keyboard-row {
    height: 160px;
    position: relative;
    padding: 0 20px 10px 20px;
    width: fit-content;
    margin: 0 auto;
    display: flex;
    flex-direction: row;
    align-items: flex-end;
}

.key-wrapper {
    position: relative;
    width: 30px;
    height: 100%;
    flex-shrink: 0;
}

.white-key {
    width: 30px;
    height: 140px;
    background: #eee;
    border: 1px solid #999;
    border-bottom: 4px solid #ccc;
    border-radius: 0 0 4px 4px;
    cursor: pointer;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 10px;
    z-index: 1;

    &.active {
        background: #d4af37;
        border-bottom: 2px solid #a6892c;
        height: 138px;
        margin-top: 2px;
    }
}

.black-key {
    width: 18px;
    height: 85px;
    background: #222;
    border: 1px solid #000;
    border-bottom: 3px solid #111;
    border-radius: 0 0 2px 2px;
    cursor: pointer;
    position: absolute;
    top: 0;
    left: -9px;
    z-index: 2;

    &.active {
        background: #a6892c;
        height: 83px;
        border-bottom: 1px solid #7a6521;
    }
}

.key-label {
    font-size: 10px;
    color: #666;
    pointer-events: none;
}

.black-key-wrapper {
    width: 0;
    overflow: visible;
}

.font-cinzel {
    font-family: 'Cinzel', serif;
}
</style>
