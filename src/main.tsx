import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppDataProvider } from './state/AppData';
import { LibraryProvider } from './state/Library';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <LibraryProvider>
        <App />
      </LibraryProvider>
    </AppDataProvider>
  </StrictMode>,
);
