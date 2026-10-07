// 冲分模式入口（2026-09-30 起为默认界面）：构成风格，画面全部由代码绘制。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_CONFIG } from '../engine';
import { installAudioUnlock } from './audio';
import { installFit } from './fit';
import { Game } from './Game';
// 数字字体随包发布（2026-10-07），不依赖 Google Fonts，国内也能加载
import '@fontsource/archivo-black/latin-400.css';
import './game.css';

DEFAULT_CONFIG.scoreMode = true;
installAudioUnlock();
installFit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
