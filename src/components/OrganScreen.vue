<template>
    <div class="organ-screen" :style="screenStyle">
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
                <!-- <q-tooltip v-if="element.name" class="bg-grey-10 text-amber shadow-4">
                    {{ element.name }}
                </q-tooltip> -->
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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useOrganStore } from 'src/stores/organ';
import type { OrganScreenData, OrganScreenElement } from '../../src-electron/utils/odf-parser';

const props = defineProps<{
    screen: OrganScreenData;
}>();

const organStore = useOrganStore();

const screenStyle = computed(() => ({
    width: `${props.screen.width}px`,
    height: `${props.screen.height}px`,
    position: 'relative' as const,
    backgroundColor: '#000',
    margin: '0 auto',
    overflow: 'hidden',
    transformOrigin: 'top center',
    // Scale to fit might be handled by parent
}));

function getImageUrl(path?: string) {
    if (!path) return '';
    // Use custom protocol for local image loading
    return `organ-img://${path}`;
}



function handleElementClick(element: OrganScreenElement) {
    if (element.linkId) {
        organStore.toggleStop(element.linkId);
    }
}
</script>

<style lang="scss" scoped>
.organ-screen {
    box-shadow: 0 0 50px rgba(0, 0, 0, 0.9);
    user-select: none;
}

.organ-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.organ-element {
    .element-img {
        // width: 100%;
        // height: 100%;

        &.clickable {
            cursor: pointer;

            // &:hover {
            //     filter: brightness(1.2);
            // }
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
