import React,{lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';
const Admin=lazy(()=>import('./pages/Admin'));
createRoot(document.getElementById('root')).render(location.pathname==='/admin'||location.pathname==='/admin/'?<Suspense fallback={<div className="route-loading">BANG / ADMINISTRATION</div>}><Admin/></Suspense>:<App/>);
