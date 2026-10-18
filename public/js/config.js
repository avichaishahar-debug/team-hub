// הגדרות Firebase. את הערכים מעתיקים מ-Firebase Console:
// Project settings ← General ← Your apps ← Web app ← firebaseConfig.
// הערכים האלה גלויים בכל אפליקציית ווב ואינם סוד. ההגנה על הנתונים באה מ-firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyDMFGxNiE0NrgXoMZNZE13X7PnXh7OrkSE',
  authDomain: 'team-hub-b45c8.firebaseapp.com',
  projectId: 'team-hub-b45c8',
  storageBucket: 'team-hub-b45c8.firebasestorage.app',
  messagingSenderId: '276768646348',
  appId: '1:276768646348:web:0fe7ae2362b67b06050e69'
};

// בעל המערכת: תמיד מנהל-על (חייב להיות זהה למה שכתוב ב-firestore.rules).
export const OWNER_EMAIL = 'avichaishahar@gmail.com';

export const EXPENSE_TYPES = ['מזון', 'אלכוהול', 'אטרקציה', 'לינה', 'אחר'];
export const MAX_DAYS = 14;
