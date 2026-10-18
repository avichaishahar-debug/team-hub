# Team Hub – הצוות שלנו

אפליקציית PWA לצוות: הוצאות מפגשים (קיים), ובהמשך ימי הולדת ואירועים. מתקינים על המסך הראשי באנדרואיד ובאייפון.
Firebase (Auth + Firestore + Hosting), בלי שרת משלנו ובלי build: קבצי ווב רגילים.

## הקמה חד-פעמית (כ-20 דקות)

1. **פרויקט Firebase.** ב-https://console.firebase.google.com לחץ Add project, שם למשל `team-hub`, בלי Analytics.
2. **מסד נתונים.** Build ← Firestore Database ← Create database ← Production mode. אזור: `me-west1` (תל אביב) או `eur3`.
3. **התחברות.** Build ← Authentication ← Get started ← Sign-in method ← Google ← Enable, ובחר מייל תמיכה.
4. **אפליקציית ווב.** Project settings (גלגל שיניים) ← General ← Your apps ← אייקון `</>` ← שם `team-hub` ← Register. העתק את `firebaseConfig`
   והדבק ב-`public/js/config.js`.
5. **כללי אבטחה.** Firestore ← לשונית Rules ← מחק הכול, הדבק את `firestore.rules` ← Publish.
6. **אחסון האתר.** במחשב עם Node: `npm i -g firebase-tools`, ואז `firebase login`, ואז בתיקיית הפרויקט `firebase init hosting:github`
   (בחר את הפרויקט, public directory: `public`, single-page app: No, ובחר את הריפו). האשף יוצר לבד את סוד ה-GitHub ואת ה-workflow.
   בהגדרות הריפו ב-GitHub ← Settings ← Secrets and variables ← Actions ← Variables הוסף `FIREBASE_PROJECT_ID`.
   (במקום האשף אפשר גם `firebase deploy --only hosting` ידנית.)
7. אחרי הפריסה האתר זמין ב-`https://<project-id>.web.app`. זו הכתובת לשיתוף עם הצוות.

## כניסה ראשונה

1. פותחים את הכתובת ומתחברים עם `avichaishahar@gmail.com` (בעל המערכת, מוגדר ב-`firestore.rules` וב-`config.js`).
2. האפליקציה יוצרת פרופיל מנהל-על.
3. **העברת הנתונים הישנים:** ב-Apps Script של הגרסה הקודמת מוסיפים את `tools/ExportForMigration.gs`, מריצים `exportForMigration`, מעתיקים את ה-JSON
   מיומן הביצוע, ומדביקים באפליקציה: צוות ← ייבוא מהגיליון הישן. אפשר לייבא שוב בלי כפילויות.
4. צוות ← הדבקת רשימת מיילים: שורה לכל אחד, `שם, מייל`. כל מי שמתחבר עם המייל הזה מקושר אוטומטית לשם שלו.
5. מינוי מנהלים: צוות ← עריכה ← תפקיד.

## התקנה בטלפון

- **אנדרואיד (Chrome):** כפתור "התקנה" באפליקציה, או תפריט ⋮ ← התקן אפליקציה.
- **אייפון (Safari):** שתף ← הוסף למסך הבית. חשוב לפתוח את הקישור ב-Safari ולא בתוך וואטסאפ.

## מבנה

- `public/` האתר. `js/app.js` הממשק, `js/settle.js` חישוב ההתחשבנות (נבדק), `js/backend-firebase.js` שכבת הנתונים.
- `firestore.rules` הרשאות בשרת: חבר צוות מוסיף הוצאה על שמו, מנהל עורך הכול, מנהל-על מנהל תפקידים.
- `tests/` בדיקות: `node tests/settle.test.js` ו-`node tests/e2e.js` (Playwright, עם backend מדומה).

## הוספת מודול חדש (ימי הולדת, אירועים)

ימי ההולדת כבר נשמרים בפרופיל של כל חבר (`members.birthday`). מודול חדש = לשונית חדשה ב-`nav` ב-`app.js`, אוסף חדש ב-Firestore,
וכלל אבטחה אחד ב-`firestore.rules`.
