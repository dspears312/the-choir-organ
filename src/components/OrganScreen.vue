<template>
    <div class="organ-screen-container" ref="containerRef">
        <div class="organ-screen-scaler" :style="scalerStyle">
            <div class="organ-screen" :style="screenStyle">
                <!-- Background Image (Moved to Elements loop for Z-Index accuracy) -->
                <!-- <img v-if="screen.backgroundImage" ... /> -->

                <!-- All Elements (including backgrounds) -->
                <div v-for="element in screen.elements" :key="element.id" class="organ-element"
                    :style="getElementStyle(element)" :data-element-id="element.id" :class="{
                        'is-switch': element.type === 'Switch',
                        'is-active': element.type === 'Switch' && element.linkId &&
                            organStore.currentCombination.includes(element.linkId)
                    }" @mousedown="handleMouseDown(element, $event)" @mouseenter="handleMouseEnter(element)"
                    @touchstart="handleTouchStart(element, $event)">
                    <!-- Switch / Stop -->
                    <template v-if="element.type === 'Switch'">
                        <img :src="getElementImage(element)" class="element-img"
                            :class="{ 'clickable': element.linkId }" draggable="false" />
                    </template>

                    <!-- Static Image -->
                    <template v-else-if="element.type === 'Image'">
                        <img :src="getElementImage(element)" class="element-img" draggable="false" />
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
import { computed, ref, onMounted, onUnmounted, watch, inject, nextTick } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import type { OrganScreenData, OrganScreenElement } from '../../src-electron/utils/odf-parser';

const props = defineProps<{
    screen: OrganScreenData;
    autoSwitchLayout?: boolean;
}>();

// Try to get injected store (remote mode), fallback to Pinia store (main app)
const organStore: any = inject('organStore', null) || useOrganStore();
const containerRef = ref<HTMLElement | null>(null);
const scale = ref(1);
const activeLayoutIndex = ref(0);

// Helper to get element style based on active layout
function getElementStyle(element: OrganScreenElement) {
    let x = element.x;
    let y = element.y;
    // Default width/height (usually set on image, but some elements have it)
    let w = element.width;
    let h = element.height;

    // Override if active layout (1 or 2) defines new coordinates
    // Note: parser stores layouts[1] and layouts[2].
    if (activeLayoutIndex.value > 0) {
        // Safe access because we check element.layouts
        const layout = element.layouts ? element.layouts[activeLayoutIndex.value] : undefined;

        if (layout) {
            x = layout.x;
            y = layout.y;
            // Height/Width might not be in layout, use default or scale?
            // Usually alternate layout only changes position X/Y.
            // But if we want to support resizing, we need W/H in layout interface.
            // Currently parser only sends X/Y.
            w = element.width;
            h = element.height;
        } else if (element.isBackground) {
            // Fallback for background: maintain visibility at default coords
            x = element.x;
            y = element.y;
            w = element.width;
            h = element.height;
        } else {
            // If we are in an alternate layout (1 or 2), and the element does NOT have
            // coordinates for this layout, it should be hidden.
            return { display: 'none' };
        }
    }

    return {
        position: 'absolute' as const,
        left: x + 'px',
        top: y + 'px',
        width: w && w > 0 ? w + 'px' : undefined,
        height: h && h > 0 ? h + 'px' : undefined,
        zIndex: element.zIndex
    };
}

let switchTimeout: any = null;

function checkBestLayout(containerRatio: number) {
    if (props.autoSwitchLayout === false) return;

    // Layout 0: Default
    const defaultRatio = props.screen.width / props.screen.height;
    let bestDifference = Math.abs(defaultRatio - containerRatio);
    let bestIndex = 0;

    if (switchTimeout === null) {
        console.groupCollapsed(`[OrganScreen] Checking Layout (Container: ${containerRatio.toFixed(2)})`);
        console.log(`Layout 0 (Default): ${props.screen.width}x${props.screen.height} (${defaultRatio.toFixed(2)}) -> Diff: ${bestDifference.toFixed(3)}`);
    }

    // Check Alternate Layouts if they exist
    if (props.screen.alternateLayouts) {
        props.screen.alternateLayouts.forEach((layout, index) => {
            if (!layout) return;
            // The parser populates index 1 and 2.
            const ratio = layout.width / layout.height;
            const diff = Math.abs(ratio - containerRatio);

            if (switchTimeout === null) {
                console.log(`Layout ${index}: ${layout.width}x${layout.height} (${ratio.toFixed(2)}) -> Diff: ${diff.toFixed(3)} ${diff < bestDifference - 0.1 ? '(BETTER)' : ''}`);
            }

            // Bias slightly towards keeping current?
            // Use a simple threshold to prefer alternates if they are significantly better fits
            if (diff < bestDifference) {
                bestDifference = diff;
                bestIndex = index;
            }
        });
    }

    if (switchTimeout === null) {
        console.groupEnd();
    }

    if (activeLayoutIndex.value !== bestIndex) {
        if (switchTimeout) clearTimeout(switchTimeout);
        switchTimeout = setTimeout(() => {
            console.log(`[OrganScreen] Switching to Layout ${bestIndex}`);
            activeLayoutIndex.value = bestIndex;
            switchTimeout = null;
            // Trigger re-scale after layout switch
            nextTick(() => updateScale());
        }, 200);
    }
}

function updateScale() {
    if (!containerRef.value) return;
    const containerWidth = containerRef.value.clientWidth;
    const containerHeight = containerRef.value.clientHeight;

    if (containerWidth === 0 || containerHeight === 0) return;

    checkBestLayout(containerWidth / containerHeight);

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
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchend', stopDrag);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchcancel', stopDrag);
});

onUnmounted(() => {
    if (resizeObserver) {
        resizeObserver.disconnect();
    }
    window.removeEventListener('mouseup', stopDrag);
    window.removeEventListener('touchend', stopDrag);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchcancel', stopDrag);
});

// Watch screen dimensions change (e.g. valid logic update)
watch(() => [props.screen.width, props.screen.height], () => {
    updateScale();
});


const scalerStyle = computed(() => {
    let w = props.screen.width;
    let h = props.screen.height;

    if (activeLayoutIndex.value > 0 && props.screen.alternateLayouts) {
        const altLayout = props.screen.alternateLayouts[activeLayoutIndex.value];
        if (altLayout) {
            w = altLayout.width;
            h = altLayout.height;
        }
    }

    return {
        width: `${w}px`,
        height: `${h}px`,
        transform: `translate(-50%, -50%) scale(${scale.value})`,
        transformOrigin: 'center center',
        position: 'absolute' as const,
        top: '50%',
        left: '50%',
    };
});

const screenStyle = computed(() => ({
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    backgroundColor: '#000',
    overflow: 'hidden',
}));

function getImageUrl(imageUrl?: string) {
    if (!imageUrl) return '';
    // If it's already an absolute URL (with protocol), return as is
    if (imageUrl.includes('://')) return imageUrl;

    // In Electron, we use the custom protocol
    if ((window as any).myApi) {
        return `organ-img://${imageUrl}`;
    }

    // In Remote mode (standard browser), we use our proxy endpoint
    return `/organ-img/${encodeURIComponent(imageUrl)}`;
}


const isDragging = ref(false);
const dragTargetState = ref(false);
const affectedIds = ref(new Set<string>());
const lastTouchTime = ref(0); // Guard to prevent mouse events after touch

function startDrag(element: OrganScreenElement) {
    if (element.type !== 'Switch' || !element.linkId) return;

    isDragging.value = true;
    affectedIds.value.clear();

    const isCurrentlyOn = organStore.currentCombination.includes(element.linkId);
    dragTargetState.value = !isCurrentlyOn;

    organStore.setStopState(element.linkId, dragTargetState.value);
    affectedIds.value.add(element.linkId);
}

function handleMouseDown(element: OrganScreenElement, event: MouseEvent) {
    // If we just had a touch event, ignore mouse events for 500ms
    if (Date.now() - lastTouchTime.value < 500) return;
    // Only handle left click
    if (event.button !== 0) return;
    startDrag(element);
}

function handleMouseEnter(element: OrganScreenElement) {
    if (!isDragging.value) return;
    if (element.type !== 'Switch' || !element.linkId) return;
    if (affectedIds.value.has(element.linkId)) return;

    organStore.setStopState(element.linkId, dragTargetState.value);
    affectedIds.value.add(element.linkId);
}

function handleTouchStart(element: OrganScreenElement, event: TouchEvent) {
    lastTouchTime.value = Date.now();
    startDrag(element);
    // DO NOT preventDefault here, as it can break Safari's click/focus logic
}

function handleTouchMove(event: TouchEvent) {
    if (!isDragging.value) return;

    // Prevent scrolling or bouncing on iOS
    if (event.cancelable) event.preventDefault();

    const touch = event.touches[0];
    if (!touch) return;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;

    // Find the closest .organ-element
    const elementDiv = target.closest('.organ-element');
    if (!elementDiv) return;

    const elementId = elementDiv.getAttribute('data-element-id');
    if (!elementId) return;

    const element = props.screen.elements.find(e => e.id === elementId);
    if (element) {
        handleMouseEnter(element);
    }
}

const getElementImage = (element: OrganScreenElement) => {
    let imgOff = element.imageOff;
    let imgOn = element.imageOn;

    // Check for alternate layout images
    if (activeLayoutIndex.value > 0 && element.layouts) {
        const layout = element.layouts[activeLayoutIndex.value];
        if (layout) {
            if (layout.imageOff) imgOff = layout.imageOff;
            if (layout.imageOn) imgOn = layout.imageOn;
        }
    }

    // Determine active state (for Switches)
    const isSwitchedOn = element.linkId && organStore.currentCombination && organStore.currentCombination.includes(element.linkId);

    // Choose image based on state
    const finalImage = isSwitchedOn ? imgOn : imgOff;

    // Fallback: if 'On' image is missing but switch is active, default to Off? 
    // Usually On image should exist if it's a switch. If not, use Off.
    return getImageUrl(finalImage || imgOff);
};

function stopDrag() {
    isDragging.value = false;
}
</script>

<style lang="scss" scoped>
.organ-screen-container {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background-color: #111;
}

.organ-screen-scaler {
    // Positioned via style binding
    touch-action: none;
    will-change: transform;
}

.organ-screen {
    // box-shadow: 0 0 50px rgba(0, 0, 0, 0.9);
    user-select: none;
    touch-action: none;
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
    touch-action: none;

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
