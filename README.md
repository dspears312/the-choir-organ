# The Choir Organ
> Advanced GrandOrgue & Tsunami Toolset by Sacred Music Library

**The Choir Organ** is a specialized utility designed for organists and developers working with the **Tsunami WAV Trigger** and **GrandOrgue** organ definition files (ODF). It provides a high-fidelity interface for managing organ stops, creating custom combinations, and "burning" these configurations into Tsunami-compatible SD card structures.

## Core Features

- **🎹 ODF Parsing**: Load standard GrandOrgue `.organ` files to automatically generate a virtual organ console.
- **🛠️ Virtual Stops**: Create synthetic stops by applying pitch shifts (cents), harmonic multipliers, or note offsets to existing samples.
- **📂 Combination Management**: Save and organize stop combinations into banks (up to 32), with the ability to export/import configurations as JSON.
- **💾 SD Card Renderer**: Compile your organ setup into a folder structure ready for the Tsunami WAV Trigger.
- **🎧 Tsunami Previewer**: A real-time monitor and playback engine that simulates Tsunami hardware behavior, including 32-voice hard polyphony cutoff and track mapping.
- **🎹 MIDI Integration**: Full MIDI support for real-time stop toggling and keyboard input.

## How It Works

1. **Load an ODF**: Open a `.organ` file. The app parses the manuals, stops, and ranks.
2. **Configure Your Organ**: Toggle stops, adjust volumes, and create "Virtual Stops" to expand your palette.
3. **Save Banks**: Store your favorite combinations as "Banks".
4. **Render to SD**: Use the "Burn to Card" feature. The app processes the ODF and your banks to generate the specific `NNNN.wav` files required by the Tsunami board.
5. **Preview**: Verify your rendered files in the built-in Tsunami Simulator before moving them to physical hardware.

## Technical Stack

- **Framework**: [Quasar Framework](https://quasar.dev) (Vue 3)
- **Runtime**: [Electron](https://www.electronjs.org/)
- **State Management**: [Pinia](https://pinia.vuejs.org/)
- **Audio Processing**: Custom renderer using `wavefile` and native Electron utilities.

## Getting Started

### Prerequisites
- Node.js (Latest LTS recommended)
- Bun or NPM

### Installation
```bash
bun install
# or
npm install
```

### Development
```bash
# Start the app in Electron development mode
npm run dev
```

### Build
```bash
# Build the application for your current platform
npm run build
```

---

*Developed by [Sacred Music Library](https://sacredmusiclibrary.com).*
