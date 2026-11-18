import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toasts } from './components/Toasts.jsx';
import { App } from './App.jsx';
import './style.css';
import './desktop.css';

createRoot(document.getElementById('root')).render(<Toasts><App /></Toasts>);
