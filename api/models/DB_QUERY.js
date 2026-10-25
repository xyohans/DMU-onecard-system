import db from '../config/db.js';

const TZ = 'Africa/Addis_Ababa';

function getEthiopiaNow() {
  const d = new Date();
  const date = d.toLocaleDateString('en-CA', { timeZone: TZ });                    // YYYY-MM-DD
  const time = d.toLocaleTimeString('en-GB', { timeZone: TZ, hourCycle: 'h23' });  // HH:MM:SS
  const wd = d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[wd];
  return { date, time, day };
}

async function getSchedule() {
  const [rows] = await db.query(
    'SELECT meal_type, start_time, end_time FROM meal_windows ORDER BY start_time'
  );
  return rows;
}

async function getMenu(day, mealType) {
  const [rows] = await db.query(
    'SELECT menu_name FROM weekly_menu WHERE day_of_week = ? AND meal_type = ?',
    [day, mealType]
  );
  return rows[0]?.menu_name ?? null;
}

async function getCurrentMeal() {
  const { date, time, day } = getEthiopiaNow();
  const schedule = await getSchedule();
  const win = schedule.find(w => w.start_time <= time && time <= w.end_time);
  if (!win) return null;

  return {
    meal_type: win.meal_type,
    date,
    menu_name: await getMenu(day, win.meal_type)
  };
}

function cleanId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 40 ? id : null;
}

export { cleanId, getCurrentMeal, getEthiopiaNow, getMenu, getSchedule };

