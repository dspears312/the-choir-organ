<template>
    <q-drawer :model-value="debugStore.isOpen" side="right" bordered dark behavior="overlay" :width="400"
        class="bg-dark-sidebar" @update:model-value="(v) => !v && debugStore.close()">
        <div class="column full-height">
            <!-- Header -->
            <div class="q-pa-md bg-header-gradient border-bottom-amber row items-center no-wrap">
                <q-icon name="bug_report" color="red-5" size="sm" class="q-mr-sm" />
                <div class="text-h6 font-cinzel text-red-5 ellipsis">Debug Inspector</div>
                <q-space />
                <q-btn flat round dense icon="close" color="grey-6" @click="debugStore.close()" />
            </div>

            <!-- Content -->
            <div class="col q-pa-sm scroll">
                <div v-if="!organStore.organData" class="text-grey-5 q-pa-md text-center">
                    No organ loaded.
                </div>
                <q-tree v-else :nodes="treeNodes" node-key="key" dark dense v-model:expanded="expandedKeys"
                    class="text-grey-4 text-caption">
                    <template v-slot:default-header="prop">
                        <div class="row items-center">
                            <span :class="prop.node.labelClass">{{ prop.node.label }}</span>
                            <q-badge v-if="prop.node.badge" :color="prop.node.badgeColor" class="q-ml-sm">
                                {{ prop.node.badge }}
                            </q-badge>
                            <span v-if="prop.node.detail" class="text-grey-6 q-ml-sm">
                                {{ prop.node.detail }}
                            </span>
                        </div>
                    </template>
                </q-tree>
            </div>
        </div>
    </q-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDebugStore } from 'src/stores/debug';
import { useOrganStore } from 'src/stores/organ';

const debugStore = useDebugStore();
const organStore = useOrganStore();
const expandedKeys = ref<string[]>(['root', 'global']);

const treeNodes = computed(() => {
    if (!organStore.organData) return [];

    const data = organStore.organData;

    // Manuals
    const manualNodes = (data.manuals || []).map((m: any) => {
        const stopNodes = m.stopIds.map((stopId: string) => {
            const stop = data.stops[stopId];
            if (!stop) return { label: `Unknown Stop (${stopId})`, key: stopId };

            const rankNodes = stop.rankIds.map((rankId: string) => {
                const rank = data.ranks[rankId];
                if (!rank) return { label: `Unknown Rank (${rankId})`, key: rankId };

                const pipeNodes = (rank.pipes || []).map((pipe: any, idx: number) => ({
                    label: `Pipe ${pipe.midiNote}`,
                    key: `${rankId}-pipe-${idx}`,
                    detail: `Gain: ${pipe.gain || 0}, Note: ${pipe.midiNote}`,
                    icon: 'music_note',
                }));

                return {
                    label: rank.name,
                    key: rankId,
                    badge: `Gain: ${rank.gain || 0}`,
                    badgeColor: 'blue-9',
                    children: pipeNodes,
                    icon: 'graphic_eq',
                };
            });

            return {
                label: stop.name,
                key: stop.id,
                badge: `Vol: ${organStore.stopVolumes[stop.id]}`,
                badgeColor: 'green-9',
                detail: `Gain: ${stop.gain || 0}`,
                children: rankNodes,
                icon: 'speaker',
            };
        });

        return {
            label: m.name,
            key: `manual-${m.id}`,
            badge: `Gain: ${m.gain || 0}`,
            badgeColor: 'amber-9',
            children: stopNodes,
            icon: 'piano',
            labelClass: 'text-amber-8 text-weight-bold',
        };
    });

    return [
        {
            label: data.name,
            key: 'root',
            icon: 'castle',
            labelClass: 'text-h6 font-cinzel text-amber-5',
            children: [
                {
                    label: 'Global Settings',
                    key: 'global',
                    icon: 'settings',
                    children: [
                        { label: `Global Gain: ${data.globalGain || 0}`, key: 'global-gain', icon: 'volume_up' },
                        { label: `Base Path: ${data.basePath}`, key: 'base-path', icon: 'folder' },
                    ],
                },
                ...manualNodes,
            ],
        },
    ];
});

// Auto-expand manuals when data loads
watch(() => organStore.organData, (newData) => {
    if (newData?.manuals) {
        const manualKeys = newData.manuals.map((m: any) => `manual-${m.id}`);
        expandedKeys.value = ['root', 'global', ...manualKeys];
    }
}, { immediate: true });
</script>

<style lang="scss" scoped>
.bg-dark-sidebar {
    background: #0f0f0f;
}

.bg-header-gradient {
    background: linear-gradient(to bottom, #1a1a1a, #0f0f0f);
}

.border-bottom-amber {
    border-bottom: 2px solid #664422;
}

.font-cinzel {
    font-family: 'Cinzel', serif;
}
</style>
