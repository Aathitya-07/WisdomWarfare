import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD5olknMuO1mdZJ_25S96UXLEjtGuhj-WU",
  authDomain: "gamified-learning-89fa5.firebaseapp.com",
  projectId: "gamified-learning-89fa5",
  storageBucket: "gamified-learning-89fa5.appspot.com",
  messagingSenderId: "372047414058",
  appId: "1:372047414058:web:f9195649866927daa71453",
  measurementId: "G-Z233GF05ZC"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Set persistence and additional auth settings
auth.setPersistence && auth.setPersistence({ persistence: 'LOCAL' }).catch(err => {
  console.warn("Could not set persistence:", err);
});

export { app, auth, googleProvider };