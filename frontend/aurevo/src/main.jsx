import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import './store.css';

if (import.meta.env.DEV && window.location.hostname === '127.0.0.1') {
    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.hostname = 'localhost';
    window.location.replace(canonicalUrl);
} else {
    createRoot(document.getElementById('root')).render(<App />);
}
