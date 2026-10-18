/**
 * מוסיפים את הקובץ הזה לפרויקט ה-Apps Script של הגרסה הקודמת (Code.gs חייב להיות הגרסה האחרונה).
 * מריצים את exportForMigration, ופותחים את "יומן הביצוע" (Execution log).
 * מעתיקים את שורת ה-JSON ומדביקים באפליקציה החדשה: צוות ← ייבוא מהגיליון הישן.
 */
function exportForMigration() {
  const s = snapshot_();
  Logger.log(JSON.stringify({ members: s.members, managers: s.managers, events: s.events, expenses: s.expenses }));
}
