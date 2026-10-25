import express from "express";
import { getEthiopiaNow, getMenu, getSchedule } from "../models/DB_QUERY.js";
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { date, time, day } = getEthiopiaNow();
    const schedule = await getSchedule();

    const current = schedule.find(w => w.start_time <= time && time <= w.end_time) || null;
    const next = schedule.find(w => w.start_time > time) || null;

    res.json({
      date,
      serverTime: time,
      open: !!current,
      current: current
        ? { ...current, menu_name: await getMenu(day, current.meal_type) }
        : null,
      next,
      schedule
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'ERROR' });
  }
});


export default router;