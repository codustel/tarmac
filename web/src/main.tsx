import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bindSocket } from './socket';
import { ToastProvider } from './ui';
import { I18nProvider } from './i18n';
import { registerServiceWorker } from './pwa';
import App from './App';
import './index.css';

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 2000 } } });
bindSocket(qc);
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
