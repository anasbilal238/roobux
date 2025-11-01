/* ==========================================
   ROOBUX - Firebase Initialization
   Purpose: Initialize Firebase and export instances
   ========================================== */

// This is your new Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyANzGN6-HN6tN6XPZ_uQK77MpR0VDb-EZk",
  authDomain: "roobux-mine.firebaseapp.com",
  projectId: "roobux-mine",
  storageBucket: "roobux-mine.firebasestorage.app",
  messagingSenderId: "544259588873",
  appId: "1:544259588873:web:7cbc8000a76b81406349d8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
// We no longer need to export storage for the free plan

// Enable Firestore offline persistence
db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('Persistence failed: Multiple tabs open');
        } else if (err.code === 'unimplemented') {
            console.warn('Persistence not available in this browser');
        }
    });

// Configure Firestore settings
db.settings({
    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});

console.log('Firebase initialized successfully');

