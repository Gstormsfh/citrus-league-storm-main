# Socket Exhaustion Fix (WinError 10048)

## Problem

The code was experiencing `WinError 10048` (socket exhaustion) because:
- Each API call was opening a new TCP connection
- Windows keeps ports in TIME_WAIT state for ~4 minutes after closing
- With thousands of requests, all available ports were exhausted

## Solution Implemented

### 1. Connection Pooling with `requests.Session()`

**Before:**
```python
r = requests.get(url, headers=headers)  # New connection every time
```

**After:**
```python
self.session = requests.Session()  # Reuses connections
r = self.session.get(url, headers=headers)  # Reuses existing connection
```

### 2. Connection Pool Configuration

- **pool_connections**: 100 (number of connection pools to cache)
- **pool_maxsize**: 100 (max connections per pool)
- **pool_block**: False (don't block if pool is full)

### 3. Retry Strategy

Added automatic retry for transient errors:
- **Total retries**: 5
- **Backoff factor**: 1 second
- **Retry on**: 502, 503, 504, 429 (Bad Gateway, Service Unavailable, Gateway Timeout, Too Many Requests)

## Changes Made

### `supabase_rest.py`

1. ✅ Added `requests.Session()` in `__init__`
2. ✅ Configured `HTTPAdapter` with connection pooling
3. ✅ Added retry strategy for transient errors
4. ✅ Replaced all `requests.get/post/patch/delete` with `session.get/post/patch/delete`

## Impact

- **Before**: Each request = new connection = potential socket exhaustion
- **After**: Requests reuse connections from pool = no socket exhaustion
- **Performance**: Faster requests (no connection overhead)
- **Reliability**: Automatic retry on transient errors

## Verification

The backtest script already correctly:
- ✅ Creates a single `SupabaseRest` instance at startup
- ✅ Passes it to all functions (no new instances in loops)

## Optional: Windows OS Tweaks

If you still experience issues with very large backtests, you can reduce TIME_WAIT delay:

```powershell
# Run PowerShell as Administrator
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name 'TcpTimedWaitDelay' -Value 30
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name 'MaxUserPort' -Value 65534
```

**Note**: Requires computer restart to take effect.

## Testing

Run the backtest:

```bash
python backtest_vopa_model_fast.py 2025-10-07 2026-01-03 2025
```

You should no longer see `WinError 10048` errors. The session will reuse connections efficiently.


