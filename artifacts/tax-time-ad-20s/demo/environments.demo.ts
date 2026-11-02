import { initializeApp } from 'firebase/app';

// The demo supplies local service fixtures. Imported production components must
// never initialize Firebase with the real project's configuration.
export const firebaseConfig = {
  apiKey: 'demo-only-not-a-real-api-key',
  authDomain: 'demo-receiptnest.invalid',
  projectId: 'demo-receiptnest',
  storageBucket: 'demo-receiptnest.invalid',
  appId: 'demo-only'
};

export const app = initializeApp(firebaseConfig);
