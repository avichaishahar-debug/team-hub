# צוות גולדפרב (Team Hub) – הקשר לפרויקט

PWA בעברית (RTL) לצוות של ~17 איש: הוצאות והתחשבנות של מפגשי צוות, סקרי מועד, אישורי הגעה, משוב אחרי מפגש, ימי הולדת.
המשתמש (אביחי) מעדיף הסברים מפורטים בעברית, ושמחליטים החלטות עיצוב מרכזיות אחת אחת לפני בנייה.

## סטאק ותשתית
- Frontend: JS ESM בלי bundler (public/js/*.js), Firebase v10.14.1 מ-gstatic. אין build step.
- Firebase: פרויקט `team-hub-b45c8`, Auth (Google), Firestore, Hosting. **מסד הנתונים נקרא `default` (בלי סוגריים)**, ולכן `initializeFirestore(app, {...}, 'default')`.
- אתר: https://team-hub-b45c8.web.app
- GitHub: avichaishahar-debug/team-hub, branch main. דחיפה ל-main מפעילה Actions (.github/workflows/deploy.yml): בדיקות unit ← פריסת Hosting. סוד `FIREBASE_SERVICE_ACCOUNT` ומשתנה `FIREBASE_PROJECT_ID` כבר מוגדרים ב-GitHub.
- **כללי Firestore (firestore.rules) לא נפרסים אוטומטית.** אחרי שינוי: להדביק ב-Firebase console ← Firestore ← Rules (מסד default) ← Publish, או `firebase deploy --only firestore:rules` (דורש התחברות CLI).
- בעל המערכת (מנהל-על קבוע): avichaishahar@gmail.com (מוגדר ב-config.js וב-firestore.rules).

## מבנה
- public/js/app.js – כל ה-UI והלוגיקה (render מחרוזות HTML, האזנות `data-a` בלחיצה, `data-form` בשליחה).
- public/js/backend-firebase.js / backend-fake.js – אותו ממשק; ה-fake משמש בבדיקות (`window.__USE_FAKE__`, `window.__fake`).
- public/js/settle.js – מתמטיקת התחשבנות בסנטים שלמים. העברות מוצגות מעוגלות כלפי מעלה לשקל שלם (`settleR` ב-app.js).
- public/js/team.js – חישובי ימי הולדת. public/sw.js – service worker (**להעלות VERSION בכל שחרור**).
- tests/settle.test.js, tests/team.test.js, tests/e2e.js (Playwright).

## מודל נתונים (Firestore)
members {name,email,role member|manager|admin,birthday,photo(dataURL קטן)}; meetups {name,startDate,days,attendance{day:[ids]},rsvp{memberId:yes|maybe|no},feedback{memberId:{score,improve,praise}},time,place,notes};
expenses {meetupId,type,amountCents,payerId,sharerIds,...}; payments {id=meetupId__from__to}; polls {name,days,options[{id,start}],votes{memberId:{optId:yes|maybe|no}},createdById,status,meetupId?};
users/{uid} {memberId,email}; joins/{uid} {code}; config/join {code}.
כל חבר מקושר יכול: להוסיף הוצאה על שמו, לעדכן יום הולדת/תמונה/אישור הגעה/משוב על עצמו, ליצור סקר ולהצביע. מנהלים: מפגשים, עריכה. מנהל-על: תפקידים, קוד הצטרפות.

## הרצת בדיקות
```
node tests/settle.test.js && node tests/team.test.js
NODE_PATH=$(npm root -g) node tests/e2e.js   # דורש playwright גלובלי + chromium
```

## עיצוב
Dark theme בלבד, כחול/טורקיז/ענבר. פונטים Rubik + Assistant. ממשק בעברית RTL; מחרוזות קצרות וברורות.

## קונבנציות
- הודעות commit בעברית. בסיום כל הודעת commit: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- אחרי כל שינוי בכללי האבטחה להגיד למשתמש להדביק ולפרסם מחדש.
- iPhone PWA: `html,body{min-height:100lvh}` ומרווח עליון `env(safe-area-inset-top)` כדי שהתפריט התחתון והכותרת יתנהגו.
