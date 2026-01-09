const midi = require('midi');

const output = new midi.Output();
const portName = 'The Choir Organ';

// Connect to the virtual port created by the application
let portIndex = -1;
for (let i = 0; i < output.getPortCount(); i++) {
    if (output.getPortName(i) === portName) {
        portIndex = i;
        break;
    }
}

if (portIndex === -1) {
    console.error(`Could not find MIDI port: ${portName}`);
    process.exit(1);
}

output.openPort(portIndex);
console.log(`Connected to virtual port: ${portName}`);

// Send Note On (status 144, note 60, velocity 100)
console.log('Sending Note On (60)...');
output.sendMessage([144, 60, 100]);

setTimeout(() => {
    // Send Note Off (status 128, note 60, velocity 0)
    console.log('Sending Note Off (60)...');
    output.sendMessage([128, 60, 0]);
    output.closePort();
    process.exit(0);
}, 1000);
