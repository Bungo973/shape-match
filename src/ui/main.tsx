import './boardSize';
import './gameMode';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CardApp } from './CardApp';
import './app.css';
import { installAudioUnlock } from './audio';

installAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('mode') === 'card' ? <CardApp /> : <App />}
  </StrictMode>,
);
