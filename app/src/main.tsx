import React from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
const isScoreRoute = () => window.location.hash.startsWith('#/score');
const mountedScore = isScoreRoute();

// The Score prototype and the canvas UI load separate global styles, so each route is mounted on its own.
window.addEventListener('hashchange', () => {
  if (isScoreRoute() !== mountedScore) window.location.reload();
});

if (mountedScore) {
  void import('./score/ScoreApp').then(({ ScoreApp }) => {
    root.render(
      <React.StrictMode>
        <ScoreApp />
      </React.StrictMode>,
    );
  });
} else {
  void Promise.all([import('@xyflow/react/dist/style.css'), import('./styles.css'), import('./App')]).then(([, , { App }]) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
