# Video Editor - Sprint 0

## Project Overview
Client-only video editor scaffold built with vanilla JavaScript and Web APIs. Currently implements Sprint 0 features: open, preview, and canvas mirroring.

## Features Implemented
- **File Loading**: Drag & drop or file picker for local video files
- **Video Preview**: Native HTML5 video playback with metadata display
- **Canvas Mirror**: Real-time canvas rendering synced to video for future overlays
- **Transport Controls**: Play/pause and scrubbing with progress slider
- **Metadata Display**: Shows filename, duration, and resolution

## Tech Stack
- **Frontend**: Vanilla JavaScript (ES6 modules), HTML5, CSS3
- **Video**: HTML5 `<video>` element as source of truth
- **Rendering**: Canvas 2D API with device pixel ratio awareness
- **Architecture**: Modular ES6 classes with centralized state management

## Development
### Local Development
Serve the project over HTTP (required for ES modules):
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000

### Testing
Test with short MP4/H.264 + AAC files for broad browser compatibility.

## File Structure
```
/
├── index.html              # Main HTML structure
├── styles.css              # Responsive CSS layout
├── js/
│   ├── main.js            # App bootstrap and DOM wiring
│   ├── video-player.js    # Video handling and metadata
│   ├── frame-renderer.js  # Canvas rendering loop
│   ├── state.js           # Central state management
│   ├── utils.js           # Helper functions
│   └── timeline-view.js   # Future placeholder
└── workers/               # Empty directory for future use
```

## Architecture
- **State Management**: Centralized reactive state with event subscriptions
- **Video Player**: Wraps HTML5 video with file loading and transport controls
- **Frame Renderer**: Canvas mirror with requestAnimationFrame loop
- **Event-Driven**: Components communicate through state updates

## Browser Support
Modern Chrome, Edge, Firefox, Safari. Requires ES6 module support.

## Future Sprints
- Timeline view and scrubbing
- Video trimming and effects
- Export functionality
- WebCodecs integration
- Web Workers for processing