import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useSettingsStore } from './settings';

export type ActiveDrawerTab = 'combinations' | 'recordings' | 'export' | 'remote' | 'debug' | 'settings';

export const useUIStore = defineStore('ui', () => {
    const settingsStore = useSettingsStore();

    // State
    const rightDrawerOpen = ref(false);
    const activeDrawer = ref<ActiveDrawerTab>('combinations');
    const selectedBank = ref(0);
    const showVirtualKeyboard = ref(settingsStore.showVirtualKeyboard);

    // Watch for internal changes and save to settings
    watch(showVirtualKeyboard, (newVal) => {
        if (newVal !== settingsStore.showVirtualKeyboard) {
            settingsStore.saveSettings({ showVirtualKeyboard: newVal });
        }
    });

    // Watch for external changes (e.g. from loadSettings)
    watch(() => settingsStore.showVirtualKeyboard, (newVal) => {
        showVirtualKeyboard.value = newVal;
    });

    // Actions
    function toggleDrawer(tab: ActiveDrawerTab) {
        if (activeDrawer.value === tab && rightDrawerOpen.value) {
            rightDrawerOpen.value = false;
        } else {
            activeDrawer.value = tab;
            rightDrawerOpen.value = true;
        }
    }

    function openDrawer(tab?: ActiveDrawerTab) {
        if (tab) activeDrawer.value = tab;
        rightDrawerOpen.value = true;
    }

    function closeDrawer() {
        rightDrawerOpen.value = false;
    }

    return {
        rightDrawerOpen,
        activeDrawer,
        selectedBank,
        showVirtualKeyboard,
        toggleDrawer,
        openDrawer,
        closeDrawer
    };
});
