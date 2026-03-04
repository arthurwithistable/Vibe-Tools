# DVSA Driving Test Cancellation Checker

Automatically checks for cancelled driving test slots on the DVSA booking system and books them for you.

## How It Works

1. Opens the DVSA booking website in a browser
2. You solve the initial CAPTCHA manually (one-time)
3. The script fills in your details and navigates to the calendar
4. It continuously checks for available dates matching your criteria
5. When a slot is found, it selects the date and time automatically
6. **You complete the payment manually** (the script stops at the payment page and alerts you)

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

### Install

```bash
cd dvsa-cancellation-checker
npm install
npm run install-browser
```

### Configure

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your details:
   ```
   LICENCE_NUMBER=SMITH612119J99XX
   TEST_CENTRE=Goodmayes
   CHECK_INTERVAL_MINUTES=3
   EARLIEST_DATE=2025-04-01
   LATEST_DATE=2025-08-30
   PREFERRED_DAYS=Monday,Tuesday,Wednesday,Thursday,Friday
   ```

### Run

```bash
npm start
```

A browser window will open. When CAPTCHA appears, solve it manually. The script handles everything else until payment.

## Configuration Options

| Variable | Required | Description |
|----------|----------|-------------|
| `LICENCE_NUMBER` | Yes | Your 16-character driving licence number |
| `TEST_CENTRE` | No | Test centre name (default: `Goodmayes`) |
| `CHECK_INTERVAL_MINUTES` | No | Minutes between checks (default: `3`) |
| `EARLIEST_DATE` | No | Earliest acceptable date `YYYY-MM-DD` |
| `LATEST_DATE` | No | Latest acceptable date `YYYY-MM-DD` |
| `PREFERRED_DAYS` | No | Comma-separated day names (e.g. `Monday,Saturday`) |
| `HEADLESS` | No | Run browser hidden (`true`/`false`, default: `false`) |

## Important Notes

- **Payment is manual** - the script cannot and will not enter payment details
- **CAPTCHA** - you must solve the initial CAPTCHA yourself. The script waits up to 5 minutes for you
- **Slot hold** - once a slot is found, it's held for ~15 minutes. Complete payment within that window
- **Rate limiting** - don't set `CHECK_INTERVAL_MINUTES` below 2, or the DVSA may block your IP
- **Service hours** - the DVSA booking system is available 6:00 AM - 11:40 PM daily
- The script saves screenshots on errors to help with debugging
