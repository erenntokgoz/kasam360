import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';
import { applyMotionPreference } from './lib/motion';
import { applyPerformanceMode, watchFramePerformance } from './lib/perfMode';
import { ErrorBoundary } from './app/ErrorBoundary';
import { OperationNotice } from './ui/OperationNotice';

applyPerformanceMode();
watchFramePerformance();
applyMotionPreference();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <OperationNotice />
  </React.StrictMode>
);
