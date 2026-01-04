import { defineStore } from 'pinia';

export type ActiveDrawerTab = 'combinations' | 'recordings' | 'export' | 'remote' | 'debug' | 'settings';

export const useUIStore = defineStore('ui', {
    state: () => ({
        rightDrawerOpen: false,
        activeDrawer: 'combinations' as ActiveDrawerTab,
        selectedBank: 0
    }),
    actions: {
        toggleDrawer(tab: ActiveDrawerTab) {
            if (this.activeDrawer === tab && this.rightDrawerOpen) {
                this.rightDrawerOpen = false;
            } else {
                this.activeDrawer = tab;
                this.rightDrawerOpen = true;
            }
        },
        openDrawer(tab?: ActiveDrawerTab) {
            if (tab) this.activeDrawer = tab;
            this.rightDrawerOpen = true;
        },
        closeDrawer() {
            this.rightDrawerOpen = false;
        }
    }
});
