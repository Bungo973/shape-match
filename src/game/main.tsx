// 冲分模式入口（2026-09-30 起为默认界面）：构成风格，画面全部由代码绘制。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_CONFIG } from '../engine';
import { installAudioUnlock } from './audio';
import { Game } from './Game';
import './game.css';

DEFAULT_CONFIG.scoreMode = true;
installAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
