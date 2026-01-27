# Enterprise Proxy Configuration Guide

## Overview
The Citrus scraping engine now uses an enterprise-grade rotating proxy system with 100 IPs from Webshare. This eliminates rate limiting and enables 10x faster scraping.

## Environment Variables

Add these to your `.env` file:

```bash
# ===================================================================
# ENTERPRISE PROXY CONFIGURATION
# ===================================================================

# Proxy Authentication (Webshare credentials)
# Get these from your Webshare dashboard
CITRUS_PROXY_USERNAME=your_webshare_username
CITRUS_PROXY_PASSWORD=your_webshare_password

# Proxy API Endpoint (Webshare proxy list download)
# Get this from your Webshare dashboard
CITRUS_PROXY_API_URL=your_webshare_api_url

# Enable/Disable Proxy Rotation (set to "false" to disable for testing)
CITRUS_PROXY_ENABLED=true

# Circuit Breaker Configuration
CITRUS_CIRCUIT_BREAKER_THRESHOLD=3
CITRUS_CIRCUIT_BREAKER_PAUSE=60

# Retry Configuration
CITRUS_MAX_RETRIES=5
CITRUS_BACKOFF_BASE=2
```

## How It Works

### 1. Proxy Rotation
- **100 IPs** rotate sequentially using `itertools.cycle`
- Each request uses a different IP
- Proxies are cached for 1 hour, then refreshed automatically

### 2. Exponential Backoff with Jitter
When a 429 (Rate Limit) error occurs:
- Wait time = `(2^retry_attempt + random(0, 0.5))` seconds
- Example: Attempt 1 → 2.3s, Attempt 2 → 4.1s, Attempt 3 → 8.4s
- Automatically rotates to a new proxy after each retry

### 3. Circuit Breaker
Protects your proxy pool from being burned through:
- Tracks consecutive failures per thread
- After 3 consecutive failures, pauses for 60 seconds
- Prevents cascading failures when NHL API is down

### 4. Smart Retry Logic
- **429 Rate Limit** → Retry with new proxy + backoff
- **403/407 Proxy Auth** → Refresh proxy list
- **5xx Server Error** → Retry with new proxy (max 2 attempts)
- **Timeout/Connection Error** → Retry with new proxy

## Usage

### Automatic (Recommended)
All scraping scripts now use the proxy system automatically. No code changes needed!

```python
# Old code still works - it's been refactored internally
from data_scraping_service import run_unified_loop
run_unified_loop()
```

### Manual Usage
If you're writing new scrapers:

```python
from src.utils.citrus_request import citrus_request

# Drop-in replacement for requests.get()
response = citrus_request("https://api-web.nhle.com/v1/schedule/now")
data = response.json()

# All standard kwargs work
response = citrus_request(
    url="https://api-web.nhle.com/v1/player/8478402/landing",
    timeout=30,
    params={"season": "20252026"}
)
```

## Monitoring

### Log Format
Every request is logged with the proxy IP used:

```
[Citrus-IP-Rotator] Requesting https://api-web.nhle.com/v1/gamecenter/... via 157.245.xxx.xxx... Success (0.8s)
[Citrus-IP-Rotator] Rate limited (429), backing off 4.2s and rotating proxy...
[Circuit-Breaker] 3 consecutive failures detected, pausing 60s to protect proxy pool
```

### Success Metrics
- **Zero 429 errors** in production for 24 hours
- **100 unique IPs** visible in logs over 1 hour
- **Circuit breaker never activates** (healthy proxies)
- **No home IP leaks** in audit logs

## Troubleshooting

### Proxy List Not Loading
```
[ProxyManager] ❌ Failed to fetch proxy list: Connection timeout
```

**Solution:** Check your internet connection and verify the `CITRUS_PROXY_API_URL` is correct.

### All Proxies Failing
```
[Circuit-Breaker] ⚠️ 3 consecutive failures detected!
```

**Solution:** 
1. Check if NHL API is down (try accessing in browser)
2. Verify proxy credentials are correct
3. Check Webshare dashboard for proxy status

### Disable Proxies for Testing
Set in `.env`:
```bash
CITRUS_PROXY_ENABLED=false
```

This will use direct requests (your home IP) for debugging.

## Files Refactored

### Core Scraping (7 files)
1. `data_scraping_service.py` - Master orchestrator
2. `fetch_nhl_stats_from_landing_fast.py` - Concurrent season stats
3. `fetch_nhl_stats_from_landing.py` - Sequential season stats
4. `data_acquisition.py` - Data acquisition
5. `scrape_per_game_nhl_stats.py` - Per-game stats
6. `sync_ppp_from_gamelog.py` - PPP/SHP sync
7. `run_daily_pbp_processing.py` - PBP wrapper

### Ingest Scripts (3 files)
8. `ingest_live_raw_nhl.py` - Live game ingestion
9. `ingest_raw_nhl.py` - Raw data ingestion
10. `ingest_shiftcharts.py` - Shift chart ingestion

### Utility Scripts (5 files)
11. `scripts/utilities/populate_player_directory.py`
12. `scripts/utilities/populate_player_names_from_api.py`
13. `scripts/utilities/populate_goalie_names_from_api.py`
14. `scripts/utilities/populate_gp_last_10_metric.py`
15. `scripts/utilities/calculate_player_toi.py`

## Architecture

```
┌─────────────────┐
│ Scraper Files   │
│ (15 files)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ citrus_request()                        │
│ - Exponential Backoff + Jitter          │
│ - Circuit Breaker Protection            │
│ - Random User-Agent per request         │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ ProxyManager                            │
│ - 100 IPs from Webshare                 │
│ - Sequential rotation (itertools.cycle) │
│ - 1-hour cache with auto-refresh        │
│ - Thread-safe proxy selection           │
└─────────────────────────────────────────┘
```

## Cost Optimization

### Current Usage
- **100 IPs** rotating
- ~0.5-1s overhead per request
- Unlimited scraping capacity

### Tips
1. Use `CITRUS_PROXY_ENABLED=false` for local development
2. Monitor Webshare dashboard for bandwidth usage
3. Adjust `CITRUS_MAX_RETRIES` if seeing too many retries

## Security

- Proxy credentials stored in `.env` (gitignored)
- IPs masked in logs (last octet hidden): `157.245.xxx.xxx`
- No hardcoded credentials in source code
- Thread-safe for concurrent scraping

## Next Steps

1. **Add to .env:** Copy the configuration above to your `.env` file
2. **Test:** Run `python test_proxy_system.py` to verify setup
3. **Monitor:** Watch logs for `[Citrus-IP-Rotator]` messages
4. **Deploy:** Run `data_scraping_service.py` and enjoy rate-limit-free scraping!

## Support

If you encounter issues:
1. Check logs for `[ProxyManager]` and `[Citrus-IP-Rotator]` messages
2. Verify environment variables are set correctly
3. Test with `CITRUS_PROXY_ENABLED=false` to isolate proxy issues
4. Check Webshare dashboard for proxy health

