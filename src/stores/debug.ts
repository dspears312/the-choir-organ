import { defineStore } from 'pinia';

export const useDebugStore = defineStore('debug', {
    state: () => ({
        isOpen: false,
    }),
    actions: {
        toggle() {
            this.isOpen = !this.isOpen;
        },
        open() {
            this.isOpen = true;
        },
        close() {
            this.isOpen = false;
        },
    },
});
