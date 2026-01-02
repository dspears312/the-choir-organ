import { defineStore } from 'pinia';

export interface WalkthroughStep {
    id: string;
    title: string;
    text: string;
    targetId?: string; // CSS selector or ID
    route?: string;    // Required route for this step
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export const useWalkthroughStore = defineStore('walkthrough', {
    state: () => ({
        isActive: false,
        currentStepIndex: 0,
        steps: [
            {
                id: 'welcome',
                title: 'Welcome',
                text: 'Welcome to The Choir Organ! This walkthrough will guide you through creating your first Tsunami SD card.',
                position: 'center'
            },
            {
                id: 'load-odf',
                title: '1. Load an Organ',
                text: 'Start by opening a GrandOrgue ODF file. This contains the pipe sounds and console layout.',
                targetId: '#btn-open-odf',
                route: '/'
            },
            {
                id: 'select-stops',
                title: '2. Select Stops',
                text: 'Click on the drawknobs to select the sounds you want to include in a combination.',
                targetId: '#stops-container',
                route: '/'
            },
            {
                id: 'save-bank',
                title: '3. Save a Bank',
                text: 'Once you like the sound, click "Save to New" to create a Bank. Tsunami supports up to 32 banks. You can create as many as you like before proceeding.',
                targetId: '#btn-save-new',
                route: '/'
            },
            {
                id: 'save-json',
                title: '4. Save Combinations',
                text: 'It is a good idea to save your combination file to your computer. This lets you reload your banks later to make changes.',
                targetId: '#btn-save-json',
                route: '/'
            },
            {
                id: 'target-device',
                title: '5. Select Target',
                text: 'Choose your SD card or a local folder as the destination for the audio files.',
                targetId: '#target-device-picker',
                route: '/'
            },
            {
                id: 'burn-card',
                title: '6. Burn to Card',
                text: 'Finally, click "Burn to Card". We recommend the "ERASE AND FORMAT" option. This ensures the card is FAT32 and the files are written in the exact physical order Tsunami expects.',
                targetId: '#btn-burn-card',
                route: '/'
            },
            {
                id: 'ready-preview',
                title: '7. Ready to Preview',
                text: 'Once the files are copied or burned, click "Preview" to switch to the Tsunami monitor.',
                targetId: '#btn-preview-ready',
                route: '/'
            },
            {
                id: 'note-monitor',
                title: '8. Monitor Notes',
                text: 'On this screen, you can see MIDI notes in real-time as they would play on the Tsunami hardware. It simulates the voice limits and loading delays of the board.',
                targetId: '#note-monitor',
                route: '/preview'
            },
            {
                id: 'midi-status',
                title: '9. MIDI Status',
                text: 'Keep an eye on the MIDI indicator. It should be green when your controller is connected and ready to play.',
                targetId: '#midi-status-preview',
                route: '/preview'
            }
        ] as WalkthroughStep[]
    }),
    getters: {
        currentStep: (state) => state.steps[state.currentStepIndex],
        isLastStep: (state) => state.steps.length > 0 && state.currentStepIndex === state.steps.length - 1,
        isFirstStep: (state) => state.currentStepIndex === 0
    },
    actions: {
        start(organStore?: any) {
            this.isActive = true;
            this.currentStepIndex = 0;

            if (organStore) {
                // Intelligence: Jump ahead based on state
                if (organStore.organData) {
                    this.currentStepIndex = this.steps.findIndex(s => s.id === 'select-stops');

                    if (organStore.currentCombination.length > 0) {
                        this.currentStepIndex = this.steps.findIndex(s => s.id === 'save-bank');
                    }

                    if (organStore.banks.length > 0) {
                        this.currentStepIndex = this.steps.findIndex(s => s.id === 'save-json');
                    }

                    if (organStore.outputDir) {
                        this.currentStepIndex = this.steps.findIndex(s => s.id === 'burn-card');
                    }
                }
            }
        },
        stop() {
            this.isActive = false;
        },
        next() {
            if (this.currentStepIndex < this.steps.length - 1) {
                this.currentStepIndex++;
            } else {
                this.stop();
            }
        },
        prev() {
            if (this.currentStepIndex > 0) {
                this.currentStepIndex--;
            }
        },
        goToStep(id: string) {
            const index = this.steps.findIndex(s => s.id === id);
            if (index !== -1) {
                this.currentStepIndex = index;
            }
        }
    }
});
