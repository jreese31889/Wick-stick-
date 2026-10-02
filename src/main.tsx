import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {installAudioBus} from './components/settings';

// Route every AudioContext through the master SFX fader before the engine
// can construct one (SoundFX builds its context lazily on the first effect).
installAudioBus();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
