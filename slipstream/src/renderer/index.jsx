import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';
import { Copy, MagnifyingGlass } from './phosphorIcons';

// These workspace-only leaf icons intentionally belong to the eager entry.
// Keeping them here makes every stable lazy workspace a single recoverable
// resource instead of a fan-out to additional, cache-poisonable chunks.
const retryClosedWorkspaceIcons = [Copy, MagnifyingGlass];
if (retryClosedWorkspaceIcons.some((Icon) => !Icon)) {
  throw new Error('Retry-closed workspace icons are unavailable');
}

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
