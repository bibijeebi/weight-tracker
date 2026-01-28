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
          const [weights, intake, exercise, vitals, measurements, configRes] = await Promise.all([
            env.DB.prepare('SELECT * FROM weights_v2 ORDER BY logged_at DESC LIMIT 10').all(),
            env.DB.prepare("SELECT * FROM intake_v2 WHERE logged_at > datetime('now', '-1 day')").all(),
            env.DB.prepare('SELECT * FROM exercise_v2 ORDER BY logged_at DESC LIMIT 5').all(),
            env.DB.prepare('SELECT * FROM vitals_v2 ORDER BY logged_at DESC LIMIT 1').all(),
            env.DB.prepare('SELECT * FROM measurements_v2 ORDER BY logged_at DESC LIMIT 1').all(),
            env.DB.prepare('SELECT * FROM config_v2').all()
          ]);
          const cfg = Object.fromEntries(configRes.results.map(r => [r.key, r.value]));
          return json({
            current_weight: weights.results[0]?.weight_lbs,
            today_calories: intake.results.reduce((s, i) => s + (i.calories || 0), 0),
            today_protein: Math.round(intake.results.reduce((s, i) => s + (i.protein_g || 0), 0)),
            goal_weight: parseFloat(cfg.goal_weight || 210),
            tdee: parseFloat(cfg.tdee_base || 2979),
            measurements: measurements.results[0] || null,
            vitals: vitals.results[0] || null,
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

  // Velocity
  let velocity = 0, velocity7d = 0, acceleration = 0;
  if (weights.length >= 2) {
    const first = weights[weights.length - 1];
    const last = weights[0];
    const daysDiff = (parseUTC(last.logged_at) - parseUTC(first.logged_at)) / 86400000;
    if (daysDiff > 0) velocity = (last.weight_lbs - first.weight_lbs) / daysDiff;
    const weekAgo = new Date(now - 7 * 86400000);
    const recentWeights = weights.filter(w => parseUTC(w.logged_at) > weekAgo);
    if (recentWeights.length >= 2) {
      const rf = recentWeights[recentWeights.length - 1];
      const rl = recentWeights[0];
      const rd = (parseUTC(rl.logged_at) - parseUTC(rf.logged_at)) / 86400000;
      if (rd > 0) velocity7d = (rl.weight_lbs - rf.weight_lbs) / rd;
    }
    acceleration = velocity - velocity7d;
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
    velocity_lbs_day: round(velocity, 4),
    velocity_7d: round(velocity7d, 4),
    acceleration: round(acceleration, 4),
    mlbs_per_hr: round(velocity * 1000 / 24, 1),
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
  
  // Generate last 14 days
  const result = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz });
    const dayData = days[dateStr] || { calories_in: 0, exercise_burn: 0 };
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
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px;line-height:1.5}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{border-right:none;border-bottom:1px solid var(--border);padding:16px}}
.sidebar{background:var(--surface);border-right:1px solid var(--border);padding:20px;display:flex;flex-direction:column;gap:16px}
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
main{padding:24px;overflow-y:auto}
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
.bar.surplus{background:linear-gradient(to top,var(--rose),#fb7185)}
.bar.deficit{background:linear-gradient(to top,var(--emerald),#34d399)}
.bar.weight{background:linear-gradient(to top,var(--cyan),var(--blue))}
.bar:hover{opacity:0.8}
.chart-wrap{display:flex;gap:8px;align-items:stretch}
.y-axis{display:flex;flex-direction:column;justify-content:space-between;font-size:10px;color:var(--text-muted);padding:2px 0;min-width:36px;text-align:right}
.chart-tooltip{position:fixed;background:var(--surface);border:1px solid var(--border);padding:6px 10px;border-radius:6px;font-size:11px;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:1000;white-space:nowrap}
.chart-tooltip.visible{opacity:1}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)}
th{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);background:var(--surface)}
.table-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-x:auto;-webkit-overflow-scrolling:touch}
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
      <div class="hero-sub">Last weigh-in: <strong id="last-weight">--</strong> · Trend: <span id="trend-weight">--</span></div>
    </div>
    <div class="velocity-card">
      <div class="velocity-header"><span class="velocity-label">Velocity</span><span class="velocity-toggle" id="vel-toggle">mlbs ↔ lbs</span></div>
      <div class="velocity-main"><span class="velocity-arrow" id="vel-arrow">↓</span><span class="velocity-value" id="vel-value">--</span><span class="velocity-unit" id="vel-unit">lbs/day</span></div>
      <div class="velocity-sub"><span id="mlbs-hr">-- mlbs/hr</span><span id="lbs-wk">-- lbs/wk</span></div>
    </div>
    <div class="accel-card"><span class="accel-icon" id="accel-icon">⏸</span><div><div class="accel-label">Acceleration vs 7d avg</div><div class="accel-value" id="accel-value">--</div></div></div>
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
        <table><thead><tr><th>ID</th><th>Weight</th><th>Time</th></tr></thead><tbody id="weights-table"><tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Loading...</td></tr></tbody></table>
      </div>
    </div>
  </main>
</div>
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
  document.getElementById('trend-weight').textContent = d.trend_weight;
  
  // Velocity
  renderVelocity(d);
  document.getElementById('mlbs-hr').textContent = round(d.mlbs_per_hr, 0) + ' mlbs/hr';
  document.getElementById('lbs-wk').textContent = round(d.velocity_lbs_day * 7, 2) + ' lbs/wk';
  
  // Acceleration
  const accelGood = d.acceleration <= 0;
  document.getElementById('accel-icon').textContent = accelGood ? '▶▶' : '⏸';
  document.getElementById('accel-icon').style.color = accelGood ? 'var(--emerald)' : 'var(--amber)';
  document.getElementById('accel-value').textContent = (accelGood ? 'Faster: ' : 'Slower: ') + Math.abs(round(d.acceleration, 4)) + ' lbs/day²';
  document.getElementById('accel-value').style.color = accelGood ? 'var(--emerald)' : 'var(--rose)';
  
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
      '<tr><td>'+fmtDate(i.logged_at)+'</td><td class="mono">'+i.calories+'</td><td class="mono">'+(i.protein_g||'-')+'</td><td class="mono">'+(i.carbs_g||'-')+'</td><td class="mono">'+(i.fat_g||'-')+'</td><td class="desc">'+(i.description||'-')+'</td></tr>'
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
      '<tr><td class="mono">#'+w.id+'</td><td class="mono">'+w.weight_lbs+' lbs</td><td>'+fmtDate(w.logged_at)+'</td></tr>'
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
document.addEventListener('mouseover', e => {
  if (e.target.dataset.tip) {
    tooltip.textContent = e.target.dataset.tip;
    tooltip.classList.add('visible');
  }
});
document.addEventListener('mousemove', e => {
  if (tooltip.classList.contains('visible')) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 24) + 'px';
  }
});
document.addEventListener('mouseout', e => {
  if (e.target.dataset.tip) tooltip.classList.remove('visible');
});

loadData();
// Auto-refresh every 60s
setInterval(() => loadData(true), 60000);
</script>
<div class="chart-tooltip" id="chart-tooltip"></div>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
}

