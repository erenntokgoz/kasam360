import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import '@fontsource-variable/schibsted-grotesk/wght.css';
import '@fontsource/kalam/latin-700.css';
import '@fontsource/kalam/latin-ext-700.css';
import './index.css';
import { ErrorBoundary } from './app/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
