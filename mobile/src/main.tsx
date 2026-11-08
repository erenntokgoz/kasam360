import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '../../desktop/src/app/App';
import { ErrorBoundary } from '../../desktop/src/app/ErrorBoundary';
import { OperationNotice } from '../../desktop/src/ui/OperationNotice';
import { MobileNavigation } from './MobileNavigation';
import '../../desktop/src/index.css';
import './mobile.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <OperationNotice />
    <MobileNavigation />
  </React.StrictMode>,
);
