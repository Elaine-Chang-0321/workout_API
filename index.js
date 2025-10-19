import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();

/** ---- CORS 設定：如有前端網域就限制，否則開放 ---- */
const allowedOrigin = process.env.FRONTEND_ORIGIN; // 例如：https://elaineworkout.zeabur.app
if (allowedOrigin) {
  app.use(cors({ origin: allowedOrigin }));
} else {
  app.use(cors());
}

app.use(express.json());

/** ---- 資料庫連線（動態 SSL）----
 * 本機：不設 DATABASE_SSL，或把 URL 加 ?sslmode=disable
 * 雲端（Zeabur）：Environment Variables 設 DATABASE_SSL=true
 */
const isProd =
  process.env.DATABASE_SSL === "true" ||
  /clusters\.zeabur\.com/i.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

/** ---- 確保資料表存在 ---- */
await pool.query(`
CREATE TABLE IF NOT EXISTS public.workout_logs (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  exercise TEXT NOT NULL,
  weight_kg NUMERIC(5,2),
  reps INT,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);

/** ---- 健康檢查 ---- */
app.get("/health", (_req, res) => res.json({ ok: true }));

/** ---- Create ---- */
app.post("/api/workouts", async (req, res) => {
  const { date, exercise, weight_kg, reps, note } = req.body || {};
  if (!date || !exercise) {
    return res.status(400).json({ error: "date & exercise are required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.workout_logs (date, exercise, weight_kg, reps, note)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [date, exercise, weight_kg ?? null, reps ?? null, note ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** ---- Read (最新在前) ---- */
app.get("/api/workouts", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, date, exercise, weight_kg, reps, note, created_at
       FROM public.workout_logs
       ORDER BY date DESC, id DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** ---- Update ---- */
app.put("/api/workouts/:id", async (req, res) => {
  const { id } = req.params;
  const { date, exercise, weight_kg, reps, note } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE public.workout_logs
       SET date       = COALESCE($1, date),
           exercise   = COALESCE($2, exercise),
           weight_kg  = COALESCE($3, weight_kg),
           reps       = COALESCE($4, reps),
           note       = COALESCE($5, note)
       WHERE id = $6
       RETURNING *`,
      [date ?? null, exercise ?? null, weight_kg ?? null, reps ?? null, note ?? null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** ---- Delete ---- */
app.delete("/api/workouts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM public.workout_logs WHERE id = $1`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/** ---- Start ---- */
const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`API running on :${port} | SSL=${isProd ? "on" : "off"}`)
);
