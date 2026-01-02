<template>
    <div class="audio-meter-container column items-center q-px-sm">
        <!-- Canvas Meter -->
        <canvas ref="canvasFunc" width="100" height="30" class="meter-canvas"></canvas>

        <!-- Volume Slider -->
        <div class="row items-center full-width volume-controls q-mt-xs">
            <q-icon name="volume_up" size="xs" color="grey-6" class="q-mr-xs" />
            <q-slider v-model="volumeModel" :min="0" :max="100" :step="1" color="amber" dense track-size="2px"
                thumb-size="10px" @update:model-value="onVolumeChange" class="col" />
            <div class="text-xs font-mono q-ml-sm text-grey-5" style="width: 35px; text-align: right;">
                {{ Math.round(volumeModel) }}%
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { synth } from '../services/synth-engine';
import { useOrganStore } from '../stores/organ';

const organStore = useOrganStore();
const canvasFunc = ref<HTMLCanvasElement | null>(null);
const volumeModel = ref(organStore.globalVolume);

let animationId: number | null = null;
let ctx: CanvasRenderingContext2D | null = null;
const dataArray = new Uint8Array(512); // Matches fftSize in synth

function draw() {
    if (!canvasFunc.value || !synth.analyser) return;

    // init ctx if needed
    if (!ctx) {
        ctx = canvasFunc.value.getContext('2d');
    }
    if (!ctx) return;

    animationId = requestAnimationFrame(draw);

    synth.analyser.getByteTimeDomainData(dataArray);

    const width = canvasFunc.value.width;
    const height = canvasFunc.value.height;

    ctx.clearRect(0, 0, width, height);

    // Calculate RMS (Root Mean Square) for volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const x = (dataArray[i] - 128) / 128; // -1 to 1
        sum += x * x;
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Scale for display (boost a bit so it's visible)
    const displayValue = Math.min(1.0, rms * 4.0);

    // Draw bar
    const barWidth = width * displayValue;

    // Color based on level (Green -> Yellow -> Red)
    let fillStyle = '#4caf50'; // Green
    if (displayValue > 0.8) {
        fillStyle = '#f44336'; // Red (Clipping/near clipping)
    } else if (displayValue > 0.5) {
        fillStyle = '#ff9800'; // Orange
    }

    ctx.fillStyle = '#1a1a1a'; // Bg
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, barWidth, height);

    // Peak hold/decay logic could be added here for fancy meters
}

function onVolumeChange(val: number | null) {
    if (val !== null) {
        organStore.setGlobalVolume(val);
    }
}

watch(() => organStore.globalVolume, (newVal) => {
    volumeModel.value = newVal;
});

onMounted(() => {
    draw();
});

onUnmounted(() => {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
});
</script>

<style scoped>
.audio-meter-container {
    width: 160px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    padding: 4px;
    border: 1px solid #333;
}

.meter-canvas {
    width: 100%;
    height: 12px;
    border-radius: 2px;
    background: #111;
}

.font-mono {
    font-family: monospace;
}
</style>
