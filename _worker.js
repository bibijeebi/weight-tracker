// Health Tracker - Cloudflare Pages Worker
// Full SSR mode - handles all routes

const CAL_PER_LB = 3500;
const AUTH_TOKEN = 'zwaV2TuGRumDt3mX6AIcVrPQNboM09px';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

function round(n, d = 1) { return Math.round(n * Math.pow(10, d)) / Math.pow(10, d); }
function parseUTC(ts) { return new Date(ts.endsWith('Z') ? ts : ts.replace(' ', 'T') + 'Z'); }
function fmtDate(ts) { const d = parseUTC(ts); const tz = 'America/New_York'; return d.toLocaleDateString('en-US', {month:'short',day:'numeric',timeZone:tz}) + ' ' + d.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',timeZone:tz}); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } }); }
function requireAuth(request) { return request.headers.get('Authorization') === `Bearer ${AUTH_TOKEN}`; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    if (method === 'OPTIONS') return new Response(null, { headers: cors });

    // === LLMS.TXT ===
    if (path === '/llms.txt') {
      return new Response(`# Health Tracker API - LLM Context

## Overview
Personal health tracking API at health.niggerfaggot.club. Tracks weight, food intake, exercise, vitals, body measurements.

## Authentication
Write operations require: \`Authorization: Bearer <TOKEN>\`
Read operations (GET) are public.
Token is stored in Claude's memory - ask user if needed.

## Timestamps
Always UTC with Z suffix (e.g., 2026-01-27T23:30:00Z). The UI displays in America/New_York.

## Endpoints

### Weight
- GET /api/weight?limit=10 - List recent weights
- POST /api/weight - Log weight: {"weight": 178.2, "logged_at?": "ISO"}
- PUT /api/weight/:id - Update: {"weight?", "logged_at?"}
- DELETE /api/weight/:id

### Intake (Food)
- GET /api/intake?limit=20 - List recent intake
- POST /api/intake - Log food: {"calories": 600, "protein": 25, "carbs": 52, "fat": 20, "description": "text", "logged_at?": "ISO"}
- PUT /api/intake/:id - Update any fields
- DELETE /api/intake/:id

**IMPORTANT: Always estimate and include ALL macros (calories, protein, carbs, fat) - never skip P/C/F**

### Exercise
- GET /api/exercise?limit=20
- POST /api/exercise - {"type": "Walking", "duration_min": 30, "calories_burned": 150, "distance_miles": 1.5, "avg_hr": 110, "max_hr": 130, "notes": "text", "logged_at?"}
- PUT /api/exercise/:id
- DELETE /api/exercise/:id

### Vitals
- GET /api/vitals?limit=20
- POST /api/vitals - {"resting_hr": 62, "max_hr": 180, "notes": "text", "logged_at?"}
- PUT /api/vitals/:id
- DELETE /api/vitals/:id

### Measurements
- GET /api/measurements
- POST /api/measurements - {"neck": 15.5, "waist": 34, "height": 71, "notes": "text", "logged_at?"}

### Read-Only
- GET /api/metrics - Computed stats (TDEE, interpolated weight, projections)
- GET /api/stats - Full dashboard data bundle

## Example: Log a meal
\`\`\`bash
curl -X POST https://health.niggerfaggot.club/api/intake \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"calories": 600, "protein": 25, "carbs": 52, "fat": 20, "description": "Japanese beef curry with rice"}'
\`\`\`

## User Context
- Goal: Operation 210 (gain muscle to 210 lbs, currently ~178)
- TDEE: ~2979 cal
- Height: 71 inches (5'11")
`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors } });
    }

    // === API ROUTES ===
    if (path.startsWith('/api/')) {
      try {
        // WEIGHT
        if (path === '/api/weight' && method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '10');
          const { results } = await env.DB.prepare('SELECT * FROM weights_v2 ORDER BY logged_at DESC LIMIT ?').bind(limit).all();
          return json({ weights: results });
        }
        if (path === '/api/weight' && method === 'POST') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const body = await request.json();
          if (typeof body.weight !== 'number') return json({ error: 'weight required' }, 400);
          const ts = body.logged_at || new Date().toISOString();
          await env.DB.prepare('INSERT INTO weights_v2 (weight_lbs, logged_at) VALUES (?, ?)').bind(body.weight, ts).run();
          return json({ success: true, weight: body.weight, logged_at: ts });
        }
        if (path.match(/^\/api\/weight\/(\d+)$/) && method === 'PUT') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          const body = await request.json();
          const sets = [], vals = [];
          if (typeof body.weight === 'number') { sets.push('weight_lbs = ?'); vals.push(body.weight); }
          if (body.logged_at) { sets.push('logged_at = ?'); vals.push(body.logged_at); }
          if (!sets.length) return json({ error: 'No fields' }, 400);
          vals.push(id);
          await env.DB.prepare(`UPDATE weights_v2 SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
          return json({ success: true, id });
        }
        if (path.match(/^\/api\/weight\/(\d+)$/) && method === 'DELETE') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          await env.DB.prepare('DELETE FROM weights_v2 WHERE id = ?').bind(id).run();
          return json({ success: true, deleted: id });
        }

        // INTAKE
        if (path === '/api/intake' && method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '20');
          const { results } = await env.DB.prepare('SELECT * FROM intake_v2 ORDER BY logged_at DESC LIMIT ?').bind(limit).all();
          return json({ intake: results });
        }
        if (path === '/api/intake' && method === 'POST') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const body = await request.json();
          if (typeof body.calories !== 'number') return json({ error: 'calories required' }, 400);
          const ts = body.logged_at || new Date().toISOString();
          await env.DB.prepare('INSERT INTO intake_v2 (calories, protein_g, carbs_g, fat_g, description, logged_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(body.calories, body.protein || null, body.carbs || null, body.fat || null, body.description || null, ts).run();
          return json({ success: true, calories: body.calories, logged_at: ts });
        }
        if (path.match(/^\/api\/intake\/(\d+)$/) && method === 'PUT') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          const body = await request.json();
          const sets = [], vals = [];
          if (typeof body.calories === 'number') { sets.push('calories = ?'); vals.push(body.calories); }
          if (typeof body.protein === 'number') { sets.push('protein_g = ?'); vals.push(body.protein); }
          if (typeof body.carbs === 'number') { sets.push('carbs_g = ?'); vals.push(body.carbs); }
          if (typeof body.fat === 'number') { sets.push('fat_g = ?'); vals.push(body.fat); }
          if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description); }
          if (body.logged_at) { sets.push('logged_at = ?'); vals.push(body.logged_at); }
          if (!sets.length) return json({ error: 'No fields' }, 400);
          vals.push(id);
          await env.DB.prepare(`UPDATE intake_v2 SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
          return json({ success: true, id });
        }
        if (path.match(/^\/api\/intake\/(\d+)$/) && method === 'DELETE') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          await env.DB.prepare('DELETE FROM intake_v2 WHERE id = ?').bind(id).run();
          return json({ success: true, deleted: id });
        }

        // EXERCISE
        if (path === '/api/exercise' && method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '20');
          const { results } = await env.DB.prepare('SELECT * FROM exercise_v2 ORDER BY logged_at DESC LIMIT ?').bind(limit).all();
          return json({ exercise: results });
        }
        if (path === '/api/exercise' && method === 'POST') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const body = await request.json();
          if (!body.type) return json({ error: 'type required' }, 400);
          const ts = body.logged_at || new Date().toISOString();
          await env.DB.prepare('INSERT INTO exercise_v2 (type, duration_min, calories_burned, distance_miles, avg_hr, max_hr, notes, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(body.type, body.duration_min || null, body.calories_burned || null, body.distance_miles || null, body.avg_hr || null, body.max_hr || null, body.notes || null, ts).run();
          return json({ success: true, type: body.type, logged_at: ts });
        }
        if (path.match(/^\/api\/exercise\/(\d+)$/) && method === 'PUT') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          const body = await request.json();
          const sets = [], vals = [];
          if (body.type) { sets.push('type = ?'); vals.push(body.type); }
          if (typeof body.duration_min === 'number') { sets.push('duration_min = ?'); vals.push(body.duration_min); }
          if (typeof body.calories_burned === 'number') { sets.push('calories_burned = ?'); vals.push(body.calories_burned); }
          if (typeof body.distance_miles === 'number') { sets.push('distance_miles = ?'); vals.push(body.distance_miles); }
          if (typeof body.avg_hr === 'number') { sets.push('avg_hr = ?'); vals.push(body.avg_hr); }
          if (typeof body.max_hr === 'number') { sets.push('max_hr = ?'); vals.push(body.max_hr); }
          if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(body.notes); }
          if (body.logged_at) { sets.push('logged_at = ?'); vals.push(body.logged_at); }
          if (!sets.length) return json({ error: 'No fields' }, 400);
          vals.push(id);
          await env.DB.prepare(`UPDATE exercise_v2 SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
          return json({ success: true, id });
        }
        if (path.match(/^\/api\/exercise\/(\d+)$/) && method === 'DELETE') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          await env.DB.prepare('DELETE FROM exercise_v2 WHERE id = ?').bind(id).run();
          return json({ success: true, deleted: id });
        }

        // VITALS
        if (path === '/api/vitals' && method === 'GET') {
          const limit = parseInt(url.searchParams.get('limit') || '20');
          const { results } = await env.DB.prepare('SELECT * FROM vitals_v2 ORDER BY logged_at DESC LIMIT ?').bind(limit).all();
          return json({ vitals: results });
        }
        if (path === '/api/vitals' && method === 'POST') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const body = await request.json();
          if (!body.resting_hr && !body.max_hr) return json({ error: 'resting_hr or max_hr required' }, 400);
          const ts = body.logged_at || new Date().toISOString();
          await env.DB.prepare('INSERT INTO vitals_v2 (resting_hr, max_hr, notes, logged_at) VALUES (?, ?, ?, ?)')
            .bind(body.resting_hr || null, body.max_hr || null, body.notes || null, ts).run();
          return json({ success: true, logged_at: ts });
        }
        if (path.match(/^\/api\/vitals\/(\d+)$/) && method === 'PUT') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          const body = await request.json();
          const sets = [], vals = [];
          if (typeof body.resting_hr === 'number') { sets.push('resting_hr = ?'); vals.push(body.resting_hr); }
          if (typeof body.max_hr === 'number') { sets.push('max_hr = ?'); vals.push(body.max_hr); }
          if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(body.notes); }
          if (body.logged_at) { sets.push('logged_at = ?'); vals.push(body.logged_at); }
          if (!sets.length) return json({ error: 'No fields' }, 400);
          vals.push(id);
          await env.DB.prepare(`UPDATE vitals_v2 SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
          return json({ success: true, id });
        }
        if (path.match(/^\/api\/vitals\/(\d+)$/) && method === 'DELETE') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const id = path.split('/').pop();
          await env.DB.prepare('DELETE FROM vitals_v2 WHERE id = ?').bind(id).run();
          return json({ success: true, deleted: id });
        }

        // MEASUREMENTS
        if (path === '/api/measurements' && method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM measurements_v2 ORDER BY logged_at DESC LIMIT 10').all();
          return json({ measurements: results });
        }
        if (path === '/api/measurements' && method === 'POST') {
          if (!requireAuth(request)) return json({ error: 'Unauthorized' }, 401);
          const body = await request.json();
          const ts = body.logged_at || new Date().toISOString();
          await env.DB.prepare('INSERT INTO measurements_v2 (neck_in, waist_in, height_in, notes, logged_at) VALUES (?, ?, ?, ?, ?)')
            .bind(body.neck || null, body.waist || null, body.height || 71, body.notes || null, ts).run();
          return json({ success: true, logged_at: ts });
        }

        // METRICS
        if (path === '/api/metrics' && method === 'GET') {
          return json(await calculateMetrics(env.DB));
        }

        // STATS
        if (path === '/api/stats' && method === 'GET') {
          // Calculate today's start in UTC using Eastern Time
          const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
          const [y, m, d] = etDateStr.split('-').map(Number);
          const mar2ndSun = new Date(Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 7));
          const nov1stSun = new Date(Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 6));
          const isDST = new Date() >= mar2ndSun && new Date() < nov1stSun;
          const todayStartUTC = new Date(Date.UTC(y, m - 1, d, isDST ? 4 : 5, 0, 0)).toISOString();

          const [weights, intake, exercise, vitals, measurements, configRes] = await Promise.all([
            env.DB.prepare('SELECT * FROM weights_v2 ORDER BY logged_at DESC LIMIT 10').all(),
            env.DB.prepare('SELECT * FROM intake_v2 WHERE logged_at >= ?').bind(todayStartUTC).all(),
            env.DB.prepare('SELECT * FROM exercise_v2 WHERE logged_at >= ?').bind(todayStartUTC).all(),
            env.DB.prepare('SELECT * FROM vitals_v2 ORDER BY logged_at DESC LIMIT 1').all(),
            env.DB.prepare('SELECT * FROM measurements_v2 ORDER BY logged_at DESC LIMIT 1').all(),
            env.DB.prepare('SELECT * FROM config_v2').all()
          ]);
          const cfg = Object.fromEntries(configRes.results.map(r => [r.key, r.value]));
          return json({
            current_weight: weights.results[0]?.weight_lbs,
            today_calories: intake.results.reduce((s, i) => s + (i.calories || 0), 0),
            today_protein: Math.round(intake.results.reduce((s, i) => s + (i.protein_g || 0), 0)),
            today_exercise_calories: exercise.results.reduce((s, e) => s + (e.calories_burned || 0), 0),
            goal_weight: parseFloat(cfg.goal_weight || 210),
            tdee: parseFloat(cfg.tdee_base || 2979),
            measurements: measurements.results[0] || null,
            vitals: vitals.results[0] || null,
          });
        }

        // EXPORT - full database backup
        if (path === '/api/export' && method === 'GET') {
          const [weights, intake, exercise, vitals, measurements, config] = await Promise.all([
            env.DB.prepare('SELECT * FROM weights_v2 ORDER BY logged_at DESC').all(),
            env.DB.prepare('SELECT * FROM intake_v2 ORDER BY logged_at DESC').all(),
            env.DB.prepare('SELECT * FROM exercise_v2 ORDER BY logged_at DESC').all(),
            env.DB.prepare('SELECT * FROM vitals_v2 ORDER BY logged_at DESC').all(),
            env.DB.prepare('SELECT * FROM measurements_v2 ORDER BY logged_at DESC').all(),
            env.DB.prepare('SELECT * FROM config_v2').all()
          ]);
          const backup = {
            exported_at: new Date().toISOString(),
            weights: weights.results,
            intake: intake.results,
            exercise: exercise.results,
            vitals: vitals.results,
            measurements: measurements.results,
            config: config.results
          };
          return new Response(JSON.stringify(backup, null, 2), {
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': 'attachment; filename="health-tracker-backup-' + new Date().toISOString().split('T')[0] + '.json"',
              ...cors
            }
          });
        }

        return json({ error: 'Not found' }, 404);
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Dashboard - serve HTML
    return serveDashboard(env);
  }
};

async function calculateMetrics(db) {
  const [weightsRes, configRes, intakeRes, exerciseRes, measurementsRes, vitalsRes] = await Promise.all([
    db.prepare('SELECT * FROM weights_v2 ORDER BY logged_at DESC LIMIT 30').all(),
    db.prepare('SELECT * FROM config_v2').all(),
    db.prepare("SELECT * FROM intake_v2 WHERE logged_at > datetime('now', '-14 days') ORDER BY logged_at DESC").all(),
    db.prepare("SELECT * FROM exercise_v2 WHERE logged_at > datetime('now', '-14 days') ORDER BY logged_at DESC").all(),
    db.prepare('SELECT * FROM measurements_v2 ORDER BY logged_at DESC LIMIT 1').all(),
    db.prepare('SELECT * FROM vitals_v2 ORDER BY logged_at DESC LIMIT 1').all(),
  ]);

  const weights = weightsRes.results;
  const config = Object.fromEntries(configRes.results.map(r => [r.key, r.value]));
  const intake = intakeRes.results;
  const exercise = exerciseRes.results;
  const measurements = measurementsRes.results[0];
  const vitals = vitalsRes.results[0];

  const TDEE = parseFloat(config.tdee_base || '2979');
  const GOAL_WEIGHT = parseFloat(config.goal_weight || '210');
  const GOAL_LEAN = parseFloat(config.goal_lean_mass || '172');
  const GOAL_BF_PCT = parseFloat(config.goal_body_fat_pct || '18');
  const GOAL_FAT = parseFloat(config.goal_fat_mass || '38');

  const latest = weights[0];
  const currentWeight = latest?.weight_lbs || 200;
  const now = Date.now();

  // Velocity & Acceleration - true instantaneous derivatives
  // Minimum 1 hour between weigh-ins to avoid garbage values
  const MIN_HOURS = 1;
  const MIN_DAYS = MIN_HOURS / 24;
  
  let velocity = 0, velocity7d = 0, velocity3d = 0, velocityAll = 0, acceleration = 0, accel3v7 = 0;
  if (weights.length >= 2) {
    // Find first valid pair (at least MIN_HOURS apart) for instantaneous velocity
    let w0 = null, w1 = null, t01 = 0;
    for (let i = 0; i < weights.length - 1; i++) {
      const a = weights[i], b = weights[i + 1];
      const gap = (parseUTC(a.logged_at) - parseUTC(b.logged_at)) / 86400000;
      if (gap >= MIN_DAYS) {
        w0 = a; w1 = b; t01 = gap;
        break;
      }
    }
    if (w0 && w1 && t01 > 0) {
      velocity = (w0.weight_lbs - w1.weight_lbs) / t01;
    }
    
    // Acceleration: find next valid pair after w1
    if (w1 && weights.length >= 3) {
      const w1idx = weights.indexOf(w1);
      for (let i = w1idx; i < weights.length - 1; i++) {
        const a = weights[i], b = weights[i + 1];
        const t12 = (parseUTC(a.logged_at) - parseUTC(b.logged_at)) / 86400000;
        if (t12 >= MIN_DAYS) {
          const v2 = (a.weight_lbs - b.weight_lbs) / t12;
          const avgT = (t01 + t12) / 2;
          acceleration = (velocity - v2) / avgT;
          break;
        }
      }
    }
    
    // 7-day average velocity
    const weekAgo = new Date(now - 7 * 86400000);
    const recentWeights7d = weights.filter(w => parseUTC(w.logged_at) > weekAgo);
    if (recentWeights7d.length >= 2) {
      const rf = recentWeights7d[recentWeights7d.length - 1];
      const rl = recentWeights7d[0];
      const rd = (parseUTC(rl.logged_at) - parseUTC(rf.logged_at)) / 86400000;
      if (rd > 0) velocity7d = (rl.weight_lbs - rf.weight_lbs) / rd;
    }
    
    // 3-day average velocity
    const threeDaysAgo = new Date(now - 3 * 86400000);
    const recentWeights3d = weights.filter(w => parseUTC(w.logged_at) > threeDaysAgo);
    if (recentWeights3d.length >= 2) {
      const rf = recentWeights3d[recentWeights3d.length - 1];
      const rl = recentWeights3d[0];
      const rd = (parseUTC(rl.logged_at) - parseUTC(rf.logged_at)) / 86400000;
      if (rd > 0) velocity3d = (rl.weight_lbs - rf.weight_lbs) / rd;
    }
    
    // All-time average velocity
    if (weights.length >= 2) {
      const oldest = weights[weights.length - 1];
      const newest = weights[0];
      const totalDays = (parseUTC(newest.logged_at) - parseUTC(oldest.logged_at)) / 86400000;
      if (totalDays > 0) velocityAll = (newest.weight_lbs - oldest.weight_lbs) / totalDays;
    }
    
    // Acceleration: 3d vs 7d velocity comparison
    if (velocity3d !== 0 && velocity7d !== 0) {
      accel3v7 = velocity3d - velocity7d; // positive = recent is faster loss, negative = slowing down
    }
  }

  // Today's calories (Eastern Time with DST detection)
  const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); // YYYY-MM-DD  
  const [y, m, d] = etDateStr.split('-').map(Number);
  // Detect DST by checking if we're between 2nd Sunday of March and 1st Sunday of November
  const mar2ndSun = new Date(Date.UTC(y, 2, 8 + (7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7, 7)); // 2am ET = 7am UTC
  const nov1stSun = new Date(Date.UTC(y, 10, 1 + (7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7, 6)); // 2am ET = 6am UTC (already EDT)
  const nowUTC = new Date();
  const isDST = nowUTC >= mar2ndSun && nowUTC < nov1stSun;
  const etOffsetHours = isDST ? 4 : 5;
  const todayStartUTC = new Date(Date.UTC(y, m - 1, d, etOffsetHours, 0, 0));
  const todayIntake = intake.filter(i => parseUTC(i.logged_at) >= todayStartUTC);
  const todayExercise = exercise.filter(e => parseUTC(e.logged_at) >= todayStartUTC);
  const caloriesIn = todayIntake.reduce((s, i) => s + (i.calories || 0), 0);
  const proteinIn = todayIntake.reduce((s, i) => s + (i.protein_g || 0), 0);
  const carbsIn = todayIntake.reduce((s, i) => s + (i.carbs_g || 0), 0);
  const fatIn = todayIntake.reduce((s, i) => s + (i.fat_g || 0), 0);
  const exerciseBurn = todayExercise.reduce((s, e) => s + (e.calories_burned || 0), 0);

  const hoursSinceMidnight = (now - todayStartUTC.getTime()) / 3600000;
  const tdeeBurnedSoFar = Math.round((hoursSinceMidnight / 24) * TDEE);
  const totalBurned = tdeeBurnedSoFar + exerciseBurn;
  const netCalories = caloriesIn - totalBurned;
  const interpolatedWeight = round(currentWeight + (netCalories / CAL_PER_LB), 2);
  const runway = TDEE - caloriesIn + exerciseBurn;

  // Body composition
  let bodyFatPct = null, leanMass = null, fatMass = null;
  if (measurements && measurements.neck_in && measurements.waist_in) {
    const heightIn = measurements.height_in || 71;
    bodyFatPct = round(86.010 * Math.log10(measurements.waist_in - measurements.neck_in) - 70.041 * Math.log10(heightIn) + 36.76, 1);
    fatMass = round(currentWeight * (bodyFatPct / 100), 1);
    leanMass = round(currentWeight - fatMass, 1);
  }

  // VO2 Max - use highest max HR from vitals or recent exercise
  let vo2max = null, vo2Category = null, vo2Color = null;
  const exerciseMaxHR = exercise.length ? Math.max(...exercise.filter(e => e.max_hr).map(e => e.max_hr)) : 0;
  const maxHR = Math.max(vitals?.max_hr || 0, exerciseMaxHR) || null;
  const restingHR = vitals?.resting_hr || null;
  if (restingHR && maxHR) {
    vo2max = round(15.3 * (maxHR / restingHR), 1);
    if (vo2max >= 57) { vo2Category = 'Elite'; vo2Color = '#22d3ee'; }
    else if (vo2max >= 52) { vo2Category = 'Excellent'; vo2Color = '#10b981'; }
    else if (vo2max >= 44) { vo2Category = 'Good'; vo2Color = '#10b981'; }
    else if (vo2max >= 38) { vo2Category = 'Fair'; vo2Color = '#fbbf24'; }
    else { vo2Category = 'Poor'; vo2Color = '#f43f5e'; }
  }

  const leanDelta = leanMass ? round(GOAL_LEAN - leanMass, 1) : null;
  const fatDelta = fatMass ? round(fatMass - GOAL_FAT, 1) : null;
  const phase = bodyFatPct && bodyFatPct > GOAL_BF_PCT ? 'Cut' : 'Bulk';

  return {
    current_weight: currentWeight,
    interpolated_weight: interpolatedWeight,
    trend_weight: weights.length > 0 ? round(weights.slice(0, 7).reduce((s, w) => s + w.weight_lbs, 0) / Math.min(weights.length, 7), 1) : null,
    velocity_lbs_day: round(velocity7d, 4),
    velocity_7d: round(velocity7d, 4),
    velocity_3d: round(velocity3d, 4),
    velocity_inst: round(velocity, 4),
    velocity_all: round(velocityAll, 4),
    acceleration: round(acceleration, 4),
    accel_3v7: round(accel3v7, 4),
    mlbs_per_hr: round(velocity7d * 1000 / 24, 1),
    calories_in: caloriesIn,
    exercise_burn: exerciseBurn,
    net_calories: netCalories,
    runway: Math.max(0, runway),
    protein_g: round(proteinIn, 0),
    carbs_g: round(carbsIn, 0),
    fat_g: round(fatIn, 0),
    body_fat_pct: bodyFatPct,
    lean_mass: leanMass,
    fat_mass: fatMass,
    lean_delta: leanDelta,
    fat_delta: fatDelta,
    phase: phase,
    vo2max: vo2max,
    vo2_category: vo2Category,
    vo2_color: vo2Color,
    resting_hr: restingHR,
    max_hr: maxHR,
    neck_in: measurements?.neck_in,
    waist_in: measurements?.waist_in,
    tdee: TDEE,
    goal_weight: GOAL_WEIGHT,
    goal_lean: GOAL_LEAN,
    goal_fat: GOAL_FAT,
    goal_bf_pct: GOAL_BF_PCT,
    hours_elapsed: round(hoursSinceMidnight, 1),
    weights: weights,
    intake: intake.slice(0, 20),
    exercise: exercise.slice(0, 10),
    daily_net: calculateDailyNet(intake, exercise, TDEE),
  };
}

function calculateDailyNet(intake, exercise, tdee) {
  const days = {};
  const tz = 'America/New_York';
  
  // Group intake by day (ET)
  intake.forEach(i => {
    const d = parseUTC(i.logged_at);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz });
    if (!days[dateStr]) days[dateStr] = { calories_in: 0, exercise_burn: 0 };
    days[dateStr].calories_in += i.calories || 0;
  });
  
  // Group exercise by day (ET)
  exercise.forEach(e => {
    const d = parseUTC(e.logged_at);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz });
    if (!days[dateStr]) days[dateStr] = { calories_in: 0, exercise_burn: 0 };
    days[dateStr].exercise_burn += e.calories_burned || 0;
  });
  
  // Generate last 14 days, but only include days with actual data
  const result = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz });
    const dayData = days[dateStr];
    if (!dayData) continue; // Skip days with no data
    const net = dayData.calories_in - tdee - dayData.exercise_burn;
    result.push({ date: dateStr, net: Math.round(net), calories_in: dayData.calories_in, exercise_burn: dayData.exercise_burn });
  }
  return result;
}

async function serveDashboard(env) {
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Health Tracker - Operation 210</title>
<meta name="description" content="Real-time weight tracking with caloric interpolation, body composition analysis, and VO₂ max estimation.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://health.niggerfaggot.club">
<meta property="og:title" content="Health Tracker - Operation 210">
<meta property="og:description" content="Real-time weight tracking with caloric interpolation, body composition analysis, and VO₂ max estimation.">
<meta property="og:image" content="https://claude-deploy.bennyforeman1.workers.dev/r2/file/og-weight-tracker.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Health Tracker - Operation 210">
<meta name="twitter:description" content="Real-time weight tracking with caloric interpolation, body composition analysis, and VO₂ max estimation.">
<meta name="twitter:image" content="https://claude-deploy.bennyforeman1.workers.dev/r2/file/og-weight-tracker.png">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0c;--surface:#111114;--card:#16161a;--border:#222228;--border-light:#2a2a32;--text:#f0f0f5;--text-secondary:#a0a0b0;--text-muted:#606070;--emerald:#10b981;--emerald-glow:rgba(16,185,129,0.3);--rose:#f43f5e;--rose-glow:rgba(244,63,94,0.3);--cyan:#22d3ee;--amber:#fbbf24;--violet:#a78bfa;--blue:#3b82f6}
*{box-sizing:border-box;margin:0;padding:0}
html{overflow-x:hidden}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px;line-height:1.5;overflow-x:hidden}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh;overflow-x:hidden;max-width:100vw}
@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{border-right:none;border-bottom:1px solid var(--border);padding:16px}}
.sidebar{background:var(--surface);border-right:1px solid var(--border);padding:20px;display:flex;flex-direction:column;gap:16px;overflow-x:hidden}
.header{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:10px}
.brand-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--emerald),var(--cyan));border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px}
.brand-text{font-weight:600;font-size:15px}
.live{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--emerald);text-transform:uppercase;letter-spacing:0.1em}
.live-dot{width:6px;height:6px;background:var(--emerald);border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.hero{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center}
.hero-label{font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px}
.hero-weight{font-family:'JetBrains Mono',monospace;font-size:48px;font-weight:700;color:var(--emerald);background:linear-gradient(135deg,var(--emerald),var(--cyan));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero-sub{font-size:12px;color:var(--text-muted);margin-top:4px}
.hero-sub strong{color:var(--text-secondary)}
.velocity-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.velocity-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.velocity-label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted)}
.velocity-toggle{font-size:10px;padding:4px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text-secondary);cursor:pointer}
.velocity-main{display:flex;align-items:baseline;gap:8px}
.velocity-arrow{font-size:20px}
.velocity-value{font-family:'JetBrains Mono',monospace;font-size:36px;font-weight:600}
.velocity-unit{font-size:14px;color:var(--text-muted)}
.velocity-sub{display:flex;gap:12px;margin-top:8px;font-size:12px;color:var(--text-muted)}
.accel-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:12px}
.metrics-expand{background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:8px}
.metrics-expand-btn{width:100%;padding:10px;background:none;border:none;color:var(--text-muted);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.metrics-expand-btn:hover{color:var(--text)}
.metrics-expand-content{max-height:0;overflow:hidden;padding:0 12px;border-top:1px solid var(--border);transition:max-height 0.3s ease,padding 0.3s ease}
.metrics-expand-content.show{max-height:600px;padding:12px}
.metric-group{margin-bottom:16px}
.metric-group:last-child{margin-bottom:0}
.metric-group-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--cyan);margin-bottom:8px}
.metric-row{display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)}
.metric-row:last-child{border-bottom:none}
.metric-info{flex:1}
.metric-name{font-size:12px;color:var(--text);font-weight:500}
.metric-desc{font-size:10px;color:var(--text-muted);margin-top:2px}
.metric-val{font-family:'JetBrains Mono',monospace;font-size:12px;text-align:right;white-space:nowrap}
.accel-icon{font-size:18px}
.accel-label{font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)}
.accel-value{font-family:'JetBrains Mono',monospace;font-size:13px}
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
.stat-row:last-child{border-bottom:none}
.stat-label{font-size:13px;color:var(--text-secondary)}
.stat-value{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:500}
.stat-value.positive{color:var(--emerald)}
.stat-value.negative{color:var(--rose)}
.macros{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 0}
.macro{text-align:center}
.macro-value{font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600}
.macro-label{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-top:2px}
.vo2-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative;overflow:hidden}
.vo2-card::before{content:'';position:absolute;top:0;right:0;width:60px;height:60px;background:radial-gradient(circle at top right,rgba(16,185,129,0.12),transparent 70%);pointer-events:none}
.vo2-left{display:flex;align-items:center;gap:12px}
.vo2-label{font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted)}
.vo2-value{font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:700}
.vo2-detail{font-size:10px;color:var(--text-muted)}
.vo2-category{font-size:10px;font-weight:600;padding:4px 10px;border-radius:12px;background:rgba(16,185,129,0.15);white-space:nowrap}
.export-btn{display:block;text-align:center;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text-muted);font-size:12px;text-decoration:none;transition:all 0.2s}
.export-btn:hover{background:var(--card);color:var(--text);border-color:var(--emerald)}
main{padding:24px;overflow-y:auto;overflow-x:hidden;max-width:100%}
@media(max-width:900px){main{padding:16px}}
.section{margin-bottom:24px}
.section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:12px}
.op-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
@media(max-width:1200px){.op-grid{grid-template-columns:repeat(2,1fr)}}
.op-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center}
.op-card-label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:8px}
.op-card-value{font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:700}
@media(max-width:900px){.op-card-value{font-size:26px}}
.op-card-sub{font-size:11px;color:var(--text-muted);margin-top:4px}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
@media(max-width:900px){.charts{grid-template-columns:1fr}}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.chart-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.chart-title{font-size:13px;font-weight:500}
.chart-badge{font-size:10px;padding:4px 8px;background:var(--surface);border-radius:6px;color:var(--text-muted)}
.chart{display:flex;align-items:flex-end;gap:4px;height:80px}
.bar{flex:1;border-radius:3px 3px 0 0;min-width:8px;transition:height 0.3s;cursor:pointer;position:relative}
.bar:hover{opacity:0.8}
.chart-tooltip{position:fixed;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:11px;color:var(--text);pointer-events:none;z-index:1000;opacity:0;transition:opacity 0.15s;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.3)}
.chart-tooltip.visible{opacity:1}
.chart-tooltip.sticky{pointer-events:auto;border-color:var(--cyan)}
.bar.surplus{background:linear-gradient(to top,var(--rose),#fb7185)}
.bar.deficit{background:linear-gradient(to top,var(--emerald),#34d399)}
.bar.weight{background:linear-gradient(to top,var(--cyan),var(--blue))}
.bar:hover{opacity:0.8}
.chart-wrap{display:flex;gap:8px;align-items:stretch}
.y-axis{display:flex;flex-direction:column;justify-content:space-between;font-size:10px;color:var(--text-muted);padding:2px 0;min-width:36px;text-align:right}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)}
th{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);background:var(--surface)}
.table-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.table-wrap.fit{width:fit-content;overflow-x:visible}
.table-wrap.fit table{width:auto;min-width:0}
.table-wrap.fit th,.table-wrap.fit td{padding:10px 14px;white-space:nowrap}
.table-wrap table{min-width:520px}
@media(max-width:900px){th,td{padding:8px 6px;font-size:12px}th{font-size:10px}td:first-child{white-space:nowrap;font-size:11px}}
.mono{font-family:'JetBrains Mono',monospace}
.desc{color:var(--text-secondary);white-space:nowrap}
.skeleton{background:linear-gradient(90deg,var(--card) 25%,var(--border) 50%,var(--card) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skeleton-text{height:1em;width:60%}
.skeleton-number{height:48px;width:80%}
.loading-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;pointer-events:none;transition:opacity 0.3s}
.loading-overlay.visible{opacity:1;pointer-events:auto}
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="header">
      <div class="brand"><div class="brand-icon">H</div><span class="brand-text">Health Tracker</span></div>
      <div class="live"><span class="live-dot"></span>Live</div>
    </div>
    <div class="hero">
      <div class="hero-label">Interpolated Weight</div>
      <div class="hero-weight" id="interpolated">---</div>
      <div class="hero-sub">Last weigh-in: <strong id="last-weight">--</strong></div>
    </div>
    <div class="velocity-card">
      <div class="velocity-header"><span class="velocity-label">Velocity</span><span class="velocity-toggle" id="vel-toggle">mlbs ↔ lbs</span></div>
      <div class="velocity-main"><span class="velocity-arrow" id="vel-arrow">↓</span><span class="velocity-value" id="vel-value">--</span><span class="velocity-unit" id="vel-unit">lbs/day</span></div>
      <div class="velocity-sub"><span id="mlbs-hr">-- mlbs/hr</span><span id="lbs-wk">-- lbs/wk</span></div>
    </div>
    <div class="metrics-expand">
      <button class="metrics-expand-btn" onclick="document.getElementById('metrics-content').classList.toggle('show');this.querySelector('.arrow').textContent=document.getElementById('metrics-content').classList.contains('show')?'▲':'▼'"><span class="arrow">▼</span> More Metrics</button>
      <div class="metrics-expand-content" id="metrics-content">
        <div class="metric-group">
          <div class="metric-group-title">Velocity (rate of weight change)</div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">Instantaneous</div><div class="metric-desc">Last 2 weigh-ins (≥1hr apart)</div></div><div class="metric-val" id="m-vel-inst">--</div></div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">7-Day Average</div><div class="metric-desc">Oldest to newest over last 7 days (displayed above)</div></div><div class="metric-val" id="m-vel-7d">--</div></div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">3-Day Average</div><div class="metric-desc">Short-term trend</div></div><div class="metric-val" id="m-vel-3d">--</div></div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">All-Time Average</div><div class="metric-desc">Since first weigh-in</div></div><div class="metric-val" id="m-vel-all">--</div></div>
        </div>
        <div class="metric-group">
          <div class="metric-group-title">Acceleration (is velocity speeding up or slowing down)</div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">Instantaneous</div><div class="metric-desc">Last 3 weigh-ins - derivative of velocity (displayed above)</div></div><div class="metric-val" id="m-accel-inst">--</div></div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">3d vs 7d Velocity</div><div class="metric-desc">Compare recent vs longer-term velocity</div></div><div class="metric-val" id="m-accel-3v7">--</div></div>
        </div>
        <div class="metric-group">
          <div class="metric-group-title">Interpretation</div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">Velocity ↓ negative</div><div class="metric-desc">Losing weight (good for cut)</div></div><div class="metric-val" style="color:var(--emerald)">✓</div></div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">Acceleration ↓ negative</div><div class="metric-desc">Weight loss speeding up</div></div><div class="metric-val" style="color:var(--emerald)">✓</div></div>
          <div class="metric-row"><div class="metric-info"><div class="metric-name">Acceleration ↑ positive</div><div class="metric-desc">Weight loss slowing down (or gaining faster)</div></div><div class="metric-val" style="color:var(--rose)">⚠</div></div>
        </div>
      </div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px">
      <div class="stat-row"><span class="stat-label">Calories In</span><span class="stat-value" id="cal-in">--</span></div>
      <div class="stat-row"><span class="stat-label">Burned</span><span class="stat-value positive" id="cal-burned">--</span></div>
      <div class="stat-row"><span class="stat-label">Net</span><span class="stat-value" id="cal-net">--</span></div>
      <div class="stat-row"><span class="stat-label">Runway</span><span class="stat-value positive" id="runway">--</span></div>
      <div class="stat-row"><span class="stat-label">Op 210</span><span class="stat-value" id="op210-phase">--</span></div>
      <div class="macros"><div class="macro"><div class="macro-value" id="protein">--</div><div class="macro-label">Protein</div></div><div class="macro"><div class="macro-value" id="carbs">--</div><div class="macro-label">Carbs</div></div><div class="macro"><div class="macro-value" id="fat">--</div><div class="macro-label">Fat</div></div></div>
    </div>
    <div class="vo2-card">
      <div class="vo2-left">
        <div><div class="vo2-label">VO₂ Max</div><div class="vo2-value" id="vo2-val">--</div></div>
        <div class="vo2-detail" id="vo2-detail">RHR -- · Max --</div>
      </div>
      <span class="vo2-category" id="vo2-cat">--</span>
    </div>
    <a href="/api/export" class="export-btn" download>⬇ Export Backup</a>
  </aside>
  <main>
    <div class="section"><div class="section-title">Operation 210 Status</div>
      <div class="op-grid">
        <div class="op-card"><div class="op-card-label">Current</div><div class="op-card-value" id="op-current">--</div><div class="op-card-sub" id="op-current-sub">--</div></div>
        <div class="op-card"><div class="op-card-label">Lean to Gain</div><div class="op-card-value positive" id="op-lean">--</div><div class="op-card-sub" id="op-lean-sub">--</div></div>
        <div class="op-card"><div class="op-card-label">Fat to Lose</div><div class="op-card-value negative" id="op-fat">--</div><div class="op-card-sub" id="op-fat-sub">--</div></div>
        <div class="op-card" style="border-color:var(--emerald)"><div class="op-card-label">Target</div><div class="op-card-value" style="color:var(--emerald)" id="op-target">210</div><div class="op-card-sub">@ 18% BF</div></div>
      </div>
    </div>
    <div class="charts">
      <div class="chart-card"><div class="chart-header"><span class="chart-title">Weight History</span><span class="chart-badge" id="weight-badge">--</span></div><div class="chart-wrap"><div class="y-axis" id="weight-y-axis"></div><div class="chart" id="weight-chart"></div></div></div>
      <div class="chart-card"><div class="chart-header"><span class="chart-title">Daily Net</span><span class="chart-badge">14 days</span></div><div class="chart-wrap"><div class="y-axis" id="net-y-axis"></div><div class="chart" id="net-chart"></div></div></div>
    </div>
    <div class="section"><div class="section-title">Recent Intake</div>
      <div class="table-wrap">
        <table><thead><tr><th>Time</th><th>Cal</th><th>P</th><th>C</th><th>F</th><th>Description</th></tr></thead><tbody id="intake-table"><tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Loading...</td></tr></tbody></table>
      </div>
    </div>
    <div class="section"><div class="section-title">Recent Exercise</div>
      <div class="table-wrap">
        <table><thead><tr><th>Time</th><th>Type</th><th>Min</th><th>Cal</th><th>Dist</th><th>Max HR</th><th>Notes</th></tr></thead><tbody id="exercise-table"><tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Loading...</td></tr></tbody></table>
      </div>
    </div>
    <div class="section"><div class="section-title">Weigh-ins</div>
      <div class="table-wrap">
        <table><thead><tr><th>Time</th><th>Weight</th><th style="width:100%"></th></tr></thead><tbody id="weights-table"><tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Loading...</td></tr></tbody></table>
      </div>
    </div>
  </main>
</div>
<div class="chart-tooltip" id="chart-tooltip"></div>
<script>
const CACHE_KEY = 'weight-tracker-cache';
const CACHE_TTL = 60000; // 1 minute
const TZ = 'America/New_York';

function parseUTC(ts) { return new Date(ts.endsWith && ts.endsWith('Z') ? ts : (ts.includes('T') ? ts + 'Z' : ts.replace(' ', 'T') + 'Z')); }
function fmtDate(ts) { 
  const d = parseUTC(ts); 
  const now = new Date();
  const isToday = d.toLocaleDateString('en-CA',{timeZone:TZ}) === now.toLocaleDateString('en-CA',{timeZone:TZ});
  const time = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:TZ}).replace(' ','').toLowerCase();
  if (isToday) return time;
  const date = (d.getMonth()+1)+'/'+d.getDate();
  return date+' '+time;
}
function round(n, d=1) { return Math.round(n * Math.pow(10,d)) / Math.pow(10,d); }

let showMlbs = false;
document.getElementById('vel-toggle').onclick = () => { showMlbs = !showMlbs; renderVelocity(window._data); };

function renderVelocity(d) {
  if (!d) return;
  const isLosing = d.velocity_lbs_day < 0;
  document.getElementById('vel-arrow').textContent = isLosing ? '↓' : '↑';
  document.getElementById('vel-arrow').style.color = isLosing ? 'var(--emerald)' : 'var(--rose)';
  document.getElementById('vel-value').style.color = isLosing ? 'var(--emerald)' : 'var(--rose)';
  if (showMlbs) {
    document.getElementById('vel-value').textContent = Math.abs(round(d.mlbs_per_hr, 0));
    document.getElementById('vel-unit').textContent = 'mlbs/hr';
  } else {
    document.getElementById('vel-value').textContent = Math.abs(round(d.velocity_lbs_day, 3));
    document.getElementById('vel-unit').textContent = 'lbs/day';
  }
}

function render(d) {
  window._data = d;
  // Hero
  document.getElementById('interpolated').textContent = round(d.interpolated_weight, 2);
  document.getElementById('last-weight').textContent = d.current_weight + ' lbs';
  
  // Velocity
  renderVelocity(d);
  document.getElementById('mlbs-hr').textContent = round(d.mlbs_per_hr, 0) + ' mlbs/hr';
  document.getElementById('lbs-wk').textContent = round(d.velocity_lbs_day * 7, 2) + ' lbs/wk';
  
  // Expanded metrics
  const fmtVel = v => (v < 0 ? '↓ ' : v > 0 ? '↑ ' : '') + Math.abs(round(v, 2)) + ' lbs/day';
  const fmtAcc = v => (v < 0 ? '↓ ' : v > 0 ? '↑ ' : '') + Math.abs(round(v, 3)) + ' lbs/day²';
  const velColor = v => v < 0 ? 'var(--emerald)' : v > 0 ? 'var(--rose)' : 'var(--text-muted)';
  document.getElementById('m-vel-inst').textContent = fmtVel(d.velocity_inst);
  document.getElementById('m-vel-inst').style.color = velColor(d.velocity_inst);
  document.getElementById('m-vel-7d').textContent = fmtVel(d.velocity_7d);
  document.getElementById('m-vel-7d').style.color = velColor(d.velocity_7d);
  document.getElementById('m-vel-3d').textContent = fmtVel(d.velocity_3d);
  document.getElementById('m-vel-3d').style.color = velColor(d.velocity_3d);
  document.getElementById('m-vel-all').textContent = fmtVel(d.velocity_all);
  document.getElementById('m-vel-all').style.color = velColor(d.velocity_all);
  document.getElementById('m-accel-inst').textContent = fmtAcc(d.acceleration);
  document.getElementById('m-accel-inst').style.color = velColor(d.acceleration);
  document.getElementById('m-accel-3v7').textContent = fmtAcc(d.accel_3v7);
  document.getElementById('m-accel-3v7').style.color = velColor(d.accel_3v7);
  
  // Stats
  document.getElementById('cal-in').textContent = d.calories_in;
  document.getElementById('cal-burned').textContent = Math.round(d.tdee * d.hours_elapsed / 24 + d.exercise_burn);
  document.getElementById('cal-net').textContent = d.net_calories;
  document.getElementById('cal-net').className = 'stat-value ' + (d.net_calories < 0 ? 'negative' : 'positive');
  document.getElementById('runway').textContent = d.runway;
  document.getElementById('op210-phase').innerHTML = '<span style="color:var(--cyan)">' + d.phase + '</span> Phase';
  document.getElementById('protein').textContent = d.protein_g + 'g';
  document.getElementById('carbs').textContent = d.carbs_g + 'g';
  document.getElementById('fat').textContent = d.fat_g + 'g';
  
  // VO2
  document.getElementById('vo2-val').textContent = d.vo2max ? round(d.vo2max, 1) : '--';
  document.getElementById('vo2-cat').textContent = d.vo2_category || '--';
  document.getElementById('vo2-cat').style.color = d.vo2_color || 'var(--text-muted)';
  document.getElementById('vo2-cat').style.background = d.vo2_color ? d.vo2_color + '25' : 'transparent';
  document.getElementById('vo2-detail').textContent = 'RHR ' + (d.resting_hr || '--') + ' · Max ' + (d.max_hr || '--');
  
  // Op 210
  document.getElementById('op-current').textContent = d.current_weight;
  document.getElementById('op-current-sub').textContent = 'lbs @ ' + round(d.body_fat_pct || 0, 1) + '% BF';
  document.getElementById('op-lean').textContent = '+' + round(d.lean_delta || 0, 1);
  document.getElementById('op-lean-sub').textContent = round(d.lean_mass || 0, 1) + ' → ' + d.goal_lean + ' lbs';
  document.getElementById('op-fat').textContent = '-' + round(d.fat_delta || 0, 1);
  document.getElementById('op-fat-sub').textContent = round(d.fat_mass || 0, 1) + ' → ' + d.goal_fat + ' lbs';
  
  // Weight chart
  if (d.weights && d.weights.length) {
    const min = Math.min(...d.weights.map(w => w.weight_lbs));
    const max = Math.max(...d.weights.map(w => w.weight_lbs));
    const range = max - min || 1;
    document.getElementById('weight-badge').textContent = d.weights.length + ' entries';
    document.getElementById('weight-y-axis').innerHTML = '<span>'+max+'</span><span>'+min+'</span>';
    document.getElementById('weight-chart').innerHTML = d.weights.slice().reverse().map(w => {
      const h = 20 + ((w.weight_lbs - min) / range) * 60;
      const date = new Date(w.logged_at).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/New_York'});
      return '<div class="bar weight" style="height:'+h+'%" data-tip="'+date+': '+w.weight_lbs+' lbs"></div>';
    }).join('');
  }
  
  // Daily net chart
  if (d.daily_net && d.daily_net.length) {
    const maxAbs = Math.max(...d.daily_net.map(x => Math.abs(x.net))) || 1;
    const maxNet = Math.max(...d.daily_net.map(x => x.net));
    const minNet = Math.min(...d.daily_net.map(x => x.net));
    document.getElementById('net-y-axis').innerHTML = '<span>'+(maxNet>0?'+':'')+maxNet+'</span><span>'+(minNet>0?'+':'')+minNet+'</span>';
    document.getElementById('net-chart').innerHTML = d.daily_net.map(x => {
      const h = Math.max(10, (Math.abs(x.net) / maxAbs) * 80);
      const cls = x.net < 0 ? 'deficit' : 'surplus';
      const sign = x.net > 0 ? '+' : '';
      return '<div class="bar '+cls+'" style="height:'+h+'%" data-tip="'+x.date+': '+sign+x.net+' cal"></div>';
    }).join('');
  }
  
  // Intake table
  if (d.intake && d.intake.length) {
    document.getElementById('intake-table').innerHTML = d.intake.slice(0,10).map(i => 
      '<tr><td>'+fmtDate(i.logged_at)+'</td><td class="mono">'+i.calories+'</td><td class="mono">'+(i.protein_g||'-')+'</td><td class="mono">'+(i.carbs_g||'-')+'</td><td class="mono">'+(i.fat_g||'-')+'</td><td>'+(i.description||'-')+'</td></tr>'
    ).join('');
  }
  
  // Exercise table
  if (d.exercise && d.exercise.length) {
    document.getElementById('exercise-table').innerHTML = d.exercise.slice(0,5).map(e =>
      '<tr><td>'+fmtDate(e.logged_at)+'</td><td>'+e.type+'</td><td class="mono">'+(e.duration_min||'-')+'</td><td class="mono">'+(e.calories_burned||'-')+'</td><td class="mono">'+(e.distance_miles?e.distance_miles.toFixed(2)+'mi':'-')+'</td><td class="mono">'+(e.max_hr||'-')+'</td><td class="desc">'+(e.notes||'-')+'</td></tr>'
    ).join('');
  }
  
  // Weights table
  if (d.weights && d.weights.length) {
    document.getElementById('weights-table').innerHTML = d.weights.slice(0,5).map(w =>
      '<tr><td style="white-space:nowrap">'+fmtDate(w.logged_at)+'</td><td class="mono" style="white-space:nowrap">'+w.weight_lbs+' lbs</td><td></td></tr>'
    ).join('');
  }
}

async function loadData(forceRefresh = false) {
  // Try cache first
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          render(data);
          // Still fetch fresh data in background
          fetch('/api/metrics').then(r => r.json()).then(d => {
            render(d);
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: d, timestamp: Date.now() }));
          }).catch(() => {});
          return;
        }
      }
    } catch (e) {}
  }
  
  // Fetch fresh
  try {
    const res = await fetch('/api/metrics');
    const data = await res.json();
    render(data);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    console.error('Failed to load:', e);
  }
}

// Tooltip handling
const tooltip = document.getElementById('chart-tooltip');
let stickyBar = null;

document.addEventListener('mouseover', e => {
  if (e.target.dataset.tip && !tooltip.classList.contains('sticky')) {
    tooltip.textContent = e.target.dataset.tip;
    tooltip.classList.add('visible');
  }
});
document.addEventListener('mousemove', e => {
  if (tooltip.classList.contains('visible') && !tooltip.classList.contains('sticky')) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 24) + 'px';
  }
});
document.addEventListener('mouseout', e => {
  if (e.target.dataset.tip && !tooltip.classList.contains('sticky')) {
    tooltip.classList.remove('visible');
  }
});
document.addEventListener('click', e => {
  if (e.target.dataset.tip) {
    // Toggle sticky on this bar
    if (stickyBar === e.target) {
      tooltip.classList.remove('sticky', 'visible');
      stickyBar.style.outline = '';
      stickyBar = null;
    } else {
      if (stickyBar) stickyBar.style.outline = '';
      stickyBar = e.target;
      stickyBar.style.outline = '2px solid var(--cyan)';
      tooltip.textContent = e.target.dataset.tip;
      tooltip.classList.add('visible', 'sticky');
      const rect = e.target.getBoundingClientRect();
      tooltip.style.left = (rect.left + rect.width/2) + 'px';
      tooltip.style.top = (rect.top - 30) + 'px';
    }
  } else if (!e.target.closest('.chart-tooltip')) {
    // Click elsewhere clears sticky
    if (stickyBar) {
      stickyBar.style.outline = '';
      stickyBar = null;
      tooltip.classList.remove('sticky', 'visible');
    }
  }
});

loadData();
// Auto-refresh every 60s
setInterval(() => loadData(true), 60000);
</script>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
}


