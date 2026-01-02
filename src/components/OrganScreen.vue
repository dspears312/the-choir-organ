<template>
    <div class="organ-screen-container" ref="containerRef">
        <div class="organ-screen-scaler" :style="scalerStyle">
            <div class="organ-screen" :style="screenStyle">
                <!-- Background Image -->
                <img v-if="screen.backgroundImage" :src="getImageUrl(screen.backgroundImage)" class="organ-bg"
                    draggable="false" />

                <!-- All Elements (including backgrounds) -->
                <div v-for="element in screen.elements" :key="element.id" class="organ-element" :style="{
                    position: 'absolute',
                    left: element.x + 'px',
                    top: element.y + 'px',
                    width: element.width > 0 ? element.width + 'px' : undefined,
                    height: element.height > 0 ? element.height + 'px' : undefined,
                    zIndex: element.zIndex
                }" @click="handleElementClick(element)" :class="{
                    'is-switch': element.type === 'Switch',
                    'is-active': element.type === 'Switch' && element.linkId &&
                        organStore.currentCombination.includes(element.linkId)
                }">
                    <!-- Switch / Stop -->
                    <template v-if="element.type === 'Switch'">
                        <img :src="getImageUrl((element.linkId && organStore.currentCombination.includes(element.linkId)) ? element.imageOn : element.imageOff)"
                            class="element-img" :class="{ 'clickable': element.linkId }" draggable="false" />
                    </template>

                    <!-- Static Image -->
                    <template v-else-if="element.type === 'Image'">
                        <img :src="getImageUrl(element.imageOff)" class="element-img" draggable="false" />
                    </template>

                    <!-- Label (Future enhancement) -->
                    <template v-else-if="element.type === 'Label'">
                        <div class="element-label">{{ element.name }}</div>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import type { OrganScreenData, OrganScreenElement } from '../../src-electron/utils/odf-parser';

const props = defineProps<{
    screen: OrganScreenData;
}>();

const organStore = useOrganStore();
const containerRef = ref<HTMLElement | null>(null);
const scale = ref(1);

function updateScale() {
    if (!containerRef.value) return;
    const containerWidth = containerRef.value.clientWidth;
    const containerHeight = containerRef.value.clientHeight;

    // Tiny delay to ensure layout if needed? Not usually with ResizeObserver.
    if (containerWidth === 0 || containerHeight === 0) return;

    const widthRatio = containerWidth / props.screen.width;
    const heightRatio = containerHeight / props.screen.height;

    // Scale to fit (contain)
    scale.value = Math.min(widthRatio, heightRatio);
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    if (containerRef.value) {
        resizeObserver = new ResizeObserver(() => {
            updateScale();
        });
        resizeObserver.observe(containerRef.value);
        updateScale();
    }
});

onUnmounted(() => {
    if (resizeObserver) {
        resizeObserver.disconnect();
    }
});

// Watch screen dimensions change (e.g. valid logic update)
watch(() => [props.screen.width, props.screen.height], () => {
    updateScale();
});


const scalerStyle = computed(() => ({
    width: `${props.screen.width}px`,
    height: `${props.screen.height}px`,
    transform: `scale(${scale.value})`,
    // transformOrigin: 'top center', // or center center? Top center is usually safer for vertical flows.
}));

const screenStyle = computed(() => ({
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    backgroundColor: '#000',
    overflow: 'hidden',
}));

function getImageUrl(path?: string) {
    if (!path) return '';
    return `organ-img://${path}`;
}

function handleElementClick(element: OrganScreenElement) {
    if (element.linkId) {
        organStore.toggleStop(element.linkId);
    }
}
</script>

<style lang="scss" scoped>
.organ-screen-container {
    width: 100%;
    height: 100%;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center; // Center vertically and horizontally
    overflow: hidden;
    // background-color: #1a1a1a; // Dark background for letterboxing
}

.organ-screen-scaler {
    // Transformer wrapper
    flex-shrink: 0; // Prevent flex squishing
}

.organ-screen {
    // box-shadow: 0 0 50px rgba(0, 0, 0, 0.9);
    user-select: none;
}

.organ-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 0;
}

.organ-element {
    .element-img {
        // width: 100%;
        // height: 100%;

        &.clickable {
            cursor: pointer;
        }
    }
}

.element-label {
    color: white;
    font-size: 12px;
    text-shadow: 1px 1px 2px black;
    pointer-events: none;
}
</style>
