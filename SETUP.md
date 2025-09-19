# Podcast Builder Setup Guide

## Overview
This is a comprehensive podcast builder application that allows you to create audio from text using ElevenLabs AI, visualize audio waveforms, highlight text during playback, and regenerate specific portions with seamless merging.

## Features Implemented

### Core Features ✅
- **Single page interface** with text area, generate button, audio player, and export button
- **Generate audio (5 POINTS)** - Full ElevenLabs integration with proper voice settings
- **Audio player (10 POINTS)** - Complete waveform visualization with playhead and controls
- **Play visualization on text (10 POINTS)** - Real-time word highlighting during playback
- **Audio exporting (10 POINTS)** - Export dialog with filename input and WAV format

### Bonus Features ✅
- **Play selected text (10 POINTS)** - Select and play specific text portions
- **Partial regeneration (20 POINTS)** - Advanced merge dialog with visual preview
- **Action History (Undo/Redo) (10 POINTS)** - Full 15-step history with keyboard shortcuts

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Create a `.env.local` file in the root directory:

```env
# ElevenLabs API Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
```

**Get your ElevenLabs API key:**
1. Sign up at [ElevenLabs](https://elevenlabs.io)
2. Go to Settings → API Keys
3. Generate a new API key
4. Copy it to your `.env.local` file

### 3. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Key Features Explained

### 1. Audio Generation
- Uses ElevenLabs API with the specified voice settings:
  - Stability: 1
  - Similarity Boost: 1 
  - Style: 0
  - Speaker Boost: true
- Automatically calculates duration based on text length
- Generates realistic waveform visualization

### 2. Advanced Merge System
When you regenerate a portion of text:
1. **Regeneration Dialog** - Select text and click "Regenerate Selection"
2. **Merge Preview** - Visual comparison of original vs regenerated audio
3. **Seamless Integration** - Proper audio merging using Web Audio API
4. **Visual Feedback** - Waveform shows regenerated segments in different colors

### 3. Text-to-Speech Synchronization
- Real-time word highlighting during playback
- Accurate timing for both original and regenerated segments
- Visual indicators for regenerated portions in the text

### 4. Export System
- Custom filename input
- WAV format export
- Merges all regenerated segments automatically
- Proper audio encoding with WAV headers

### 5. History Management
- 15-step undo/redo system
- Keyboard shortcuts (Ctrl+Z, Ctrl+Y)
- Tracks all actions: generation, regeneration, merging

## Technical Implementation

### Audio Processing
- Uses Web Audio API for audio merging
- Proper WAV encoding for exports
- Base64 audio handling for browser compatibility
- Real-time waveform visualization with react-audio-visualize

### State Management
- Comprehensive React state management
- Audio segments tracking with timing data
- History state preservation
- Error handling and loading states

### UI/UX
- Modern design with Tailwind CSS
- Responsive layout
- Visual feedback for all actions
- Accessible keyboard shortcuts
- Professional audio interface

## Architecture

```
app/
├── api/generate-audio/route.ts    # ElevenLabs API integration
├── page.tsx                       # Main application component
└── globals.css                    # Global styles

components/ui/                     # Reusable UI components
├── button.tsx
├── card.tsx
├── dialog.tsx
├── input.tsx
└── ...
```

## API Endpoints

### POST /api/generate-audio
Generates audio from text using ElevenLabs API.

**Request:**
```json
{
  "text": "Your podcast script text"
}
```

**Response:**
```json
{
  "url": "data:audio/mpeg;base64,..",
  "duration": 30.5,
  "waveform": [0.1, 0.2, ...],
  "wordCount": 25
}
```

## Troubleshooting

### Common Issues

1. **"ElevenLabs API key not configured"**
   - Make sure `.env.local` exists with your API key
   - Restart the development server after adding the key

2. **Audio not playing**
   - Check browser permissions for audio
   - Ensure audio format is supported

3. **Merge not working**
   - Modern browsers required for Web Audio API
   - Check console for audio decoding errors

### Browser Compatibility
- Chrome 66+ (recommended)
- Firefox 60+
- Safari 14.1+
- Edge 79+

## Performance Notes
- Audio files are processed in memory
- Large scripts may take longer to generate
- Waveform rendering is optimized for performance
- History is limited to 15 steps to prevent memory issues

## Future Enhancements
- Multiple voice support
- Background music mixing
- Advanced audio effects
- Cloud storage integration
- Collaboration features
