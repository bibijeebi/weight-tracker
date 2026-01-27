# Weight Tracker

Operation 210 - Personal weight tracking dashboard with real-time interpolation, body composition tracking, and VO2 max estimation.

## Features

- **Interpolated Weight**: Real-time weight estimation based on calorie intake/burn
- **Velocity Tracking**: Rate of weight change (lbs/day, mlbs/hr)
- **Acceleration**: 2nd derivative showing if you're speeding up or slowing down
- **Body Composition**: Navy method body fat %, lean mass, fat mass tracking
- **VO2 Max**: Estimated from resting/max heart rate
- **Operation 210 Status**: Progress toward goal body composition

## Deployment

This is a Cloudflare Pages project with a `_worker.js` for full SSR.

**Environments:**
- `main` branch → `weight-tracker.pages.dev` (production)
- `staging` branch → preview URL
- Any PR → auto-generated preview URL

**D1 Binding:**
- Binding name: `DB`
- Database: `weight-tracker` (`66a59049-f2a1-40bb-a279-c13dd8ff85d1`)

## API Endpoints

All write endpoints require `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/weight` | List weights |
| POST | `/api/weight` | Log weight `{weight: number}` |
| PUT | `/api/weight/:id` | Update weight |
| DELETE | `/api/weight/:id` | Delete weight |
| GET | `/api/intake` | List intake |
| POST | `/api/intake` | Log intake `{calories, protein?, carbs?, fat?, description?}` |
| GET | `/api/exercise` | List exercise |
| POST | `/api/exercise` | Log exercise `{type, duration_min?, calories_burned?, distance_miles?, max_hr?, notes?}` |
| GET | `/api/vitals` | List vitals |
| POST | `/api/vitals` | Log vitals `{resting_hr?, max_hr?, notes?}` |
| GET | `/api/measurements` | List measurements |
| POST | `/api/measurements` | Log measurements `{neck?, waist?, height?}` |
| GET | `/api/metrics` | Full calculated metrics |
| GET | `/api/stats` | Quick stats summary |

## Local Development

```bash
npx wrangler pages dev . --d1=DB=66a59049-f2a1-40bb-a279-c13dd8ff85d1
```
