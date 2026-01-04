<template>
    <div class="combination-manager column no-wrap full-height">
        <div class="q-pa-md bg-header-gradient border-bottom-amber"
            style="display: flex; flex-direction: row; align-items: center; gap: 12px;">
            <q-btn round label="GC" unelevated color="white" text-color="black" @click="organStore.clearCombination">
                <q-tooltip>General Cancel</q-tooltip>
            </q-btn>
            <div class="col">
                <div class="text-h6 font-cinzel text-amber-9 text-center">Combinations</div>
                <div class="text-caption text-grey-6 text-center">
                    {{ organStore.banks.length }} / 32 Banks Used
                </div>
            </div>
            <div class="row no-wrap q-gutter-x-xs">
                <template v-if="allowImportExport">
                    <q-btn flat icon="mdi-folder-open" round size="sm" color="amber-7"
                        @click="organStore.importFromJSON">
                        <q-tooltip>Open Combination File</q-tooltip>
                    </q-btn>
                    <q-btn flat round icon="mdi-content-save" color="green" size="sm" @click="organStore.exportToJSON">
                        <q-tooltip>Save Combination File</q-tooltip>
                    </q-btn>
                </template>
                <q-btn v-else flat round :icon="editMode ? 'mdi-check' : 'mdi-pencil'"
                    :color="editMode ? 'green' : 'grey-6'" size="sm" @click="editMode = !editMode">
                    <q-tooltip>{{ editMode ? 'Finish Editing' : 'Edit Banks' }}</q-tooltip>
                </q-btn>
            </div>
        </div>

        <!-- Scrollable Bank List -->
        <q-scroll-area class="col"
            :thumb-style="{ width: '5px', borderRadius: '5px', background: '#d4af37', opacity: '0.5' }">
            <q-list dark separator class="bank-list">
                <q-item v-for="(bank, index) in organStore.banks" :key="bank.id" clickable v-ripple
                    :active="modelValue === index" active-class="bank-active" class="bank-item q-py-sm"
                    @click="organStore.loadBank(index)">
                    <q-item-section side v-if="showEditControls">
                        <div class="column q-gutter-xs">
                            <q-btn flat dense role="img" icon="mdi-chevron-up" size="xs" color="grey-6"
                                @click.stop="organStore.moveBank(index as number, (index as number) - 1)"
                                :disable="index === 0" />
                            <q-btn flat dense role="img" icon="mdi-chevron-down" size="xs" color="grey-6"
                                @click.stop="organStore.moveBank(index as number, (index as number) + 1)"
                                :disable="index === organStore.banks.length - 1" />
                        </div>
                    </q-item-section>

                    <q-item-section>
                        <q-item-label class="text-amber-1 font-cinzel row items-center">
                            {{ bank.name }}
                            <template v-if="showEditControls">
                                <q-popup-edit v-model="bank.name" auto-save v-slot="scope"
                                    class="bg-grey-10 text-amber">
                                    <q-input v-model="scope.value" dense autofocus counter @keyup.enter="scope.set" dark
                                        color="amber" label="Rename Bank" />
                                </q-popup-edit>
                                <q-icon name="mdi-pencil" size="xs" color="grey-8"
                                    class="q-ml-sm cursor-pointer opacity-50 hover-opacity-100" />
                            </template>
                        </q-item-label>
                        <q-item-label caption class="text-grey-5">{{ bank.combination.length }}
                            Stops</q-item-label>
                    </q-item-section>

                    <q-item-section side v-if="showEditControls">
                        <q-btn flat round dense icon="mdi-delete" color="red-9" size="sm"
                            @click.stop="organStore.deleteBank(index)" />
                    </q-item-section>
                </q-item>

                <div v-if="organStore.banks.length === 0" class="text-center text-grey-8 q-pa-lg italic text-caption">
                    No banks saved. Set stops and click "Add Bank".
                </div>
            </q-list>
        </q-scroll-area>

        <!-- Bank Actions -->
        <div class="q-pa-md bg-dark-sidebar column border-top-amber-muted" v-if="showEditControls">
            <div class="row q-gutter-x-sm">
                <q-btn id="btn-save-new-comp" color="amber" text-color="black" icon-right="mdi-plus" label="Save to New"
                    class="col font-cinzel text-caption" :disable="organStore.banks.length >= 32" @click="addNewBank">
                    <q-tooltip v-if="organStore.banks.length >= 32">Bank limit reached (32)</q-tooltip>
                </q-btn>

                <q-btn color="grey-9" text-color="grey-5" icon-right="mdi-backspace" label="Overwrite"
                    class="col font-cinzel text-caption" outline
                    :disable="modelValue === null || !organStore.banks[modelValue]" @click="saveToCurrentBank" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { inject, ref, computed } from 'vue';

const props = withDefaults(defineProps<{
    modelValue: number | null;
    allowImportExport?: boolean;
}>(), {
    allowImportExport: true
});

const emit = defineEmits(['update:modelValue']);

// Use injection to allow mocking in remote app
const organStore = inject<any>('organStore');

const editMode = ref(false); // Local toggle for "Edit Mode" (mostly for remote/touch)
const showEditControls = computed(() => props.allowImportExport || editMode.value);

const addNewBank = () => {
    organStore.addBank();
    emit('update:modelValue', organStore.banks.length - 1);
};

const saveToCurrentBank = () => {
    if (props.modelValue !== null) {
        organStore.saveToBank(props.modelValue);
    }
}
</script>

<style scoped>
.bank-active {
    background: rgba(212, 175, 55, 0.1);
    border-left: 3px solid #d4af37;
}

.bg-header-gradient {
    background: linear-gradient(to bottom, #2a2a2a, #1a1a1a);
}

.border-bottom-amber {
    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
}

.border-top-amber-muted {
    border-top: 1px solid rgba(212, 175, 55, 0.1);
}

.bg-dark-sidebar {
    background: #121212;
}
</style>
