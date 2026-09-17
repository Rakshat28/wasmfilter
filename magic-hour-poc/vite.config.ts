export default {
  root: '.',
  publicDir: 'public',
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
};
