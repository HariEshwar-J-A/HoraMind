import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';
import './components/bui/beautiful-ui.css';
import '@horamind/ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
