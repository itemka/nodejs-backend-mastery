import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.js';
import { ErrorBoundary } from './components/error-boundary.js';
import './index.css';

const container = document.querySelector('#root');

if (!container) {
  throw new Error('Could not find the root element.');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
