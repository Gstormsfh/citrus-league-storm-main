#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Throttled NHL API client with retries + proxy rotation
# Last active: 2026-03-03
# Invoked:     imported by EVERY data-pipeline/acquisition/* script
# Reads:       NHL public API
# Writes:      (returns parsed JSON)
# ────────────────────────────────────────────────────────────
"""
citrus_request.py - Resilient HTTP Request Wrapper with Proxy Rotation

The "Big Dog" request handler that never gets rate limited.

Features:
- Automatic proxy rotation on every request
- Exponential backoff with jitter on 429 errors
- Circuit breaker to protect proxy pool
- Random User-Agent per request
- Comprehensive logging with proxy IP tracking
- Drop-in replacement for requests.get() and requests.post()

Usage:
    from data_pipeline.utils.citrus_request import citrus_request
    
    # Instead of: response = requests.get(url)
    response = citrus_request(url)
    
    # All kwargs supported
    response = citrus_request(url, timeout=30, params={"season": "2025"})
"""

import os
import time
import random
import logging
import threading
from typing import Optional, Dict, Any
from urllib.parse import urlparse
import requests
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry
from dotenv import load_dotenv

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.proxy_manager import get_proxy_manager, get_realistic_headers
from data_pipeline.utils.proxy_health import get_health_monitor

load_dotenv()

logger = logging.getLogger("CitrusIPRotator")

# Enterprise connection pooling
_session_pool = threading.local()


def _get_session() -> requests.Session:
    """
    Get or create a thread-local session with connection pooling.
    
    Enterprise features:
    - Connection pooling (reuse HTTP connections)
    - Automatic retry on network errors (not 429)
    - Keep-alive connections
    """
    if not hasattr(_session_pool, 'session'):
        session = requests.Session()
        
        # Configure connection pooling and retry strategy
        # Retry on connection errors, but NOT on HTTP errors (we handle those)
        retry_strategy = Retry(
            total=0,  # We handle retries manually
            backoff_factor=0,
            status_forcelist=[]  # Don't auto-retry any status codes
        )
        
        adapter = HTTPAdapter(
            pool_connections=10,  # Number of connection pools
            pool_maxsize=50,  # Max connections per pool
            max_retries=retry_strategy
        )
        
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        _session_pool.session = session
    
    return _session_pool.session

# Configuration from environment
MAX_RETRIES = int(os.getenv("CITRUS_MAX_RETRIES", "5"))
BACKOFF_BASE = int(os.getenv("CITRUS_BACKOFF_BASE", "2"))
CIRCUIT_BREAKER_THRESHOLD = int(os.getenv("CITRUS_CIRCUIT_BREAKER_THRESHOLD", "3"))
CIRCUIT_BREAKER_PAUSE = int(os.getenv("CITRUS_CIRCUIT_BREAKER_PAUSE", "60"))

# Thread-local storage for circuit breaker state
_thread_local = threading.local()


def _get_circuit_breaker_state() -> Dict[str, Any]:
    """
    Get circuit breaker state for current thread.
    Thread-safe using threading.local()
    
    Returns:
        Dict with 'consecutive_failures' counter
    """
    if not hasattr(_thread_local, 'circuit_breaker'):
        _thread_local.circuit_breaker = {'consecutive_failures': 0}
    return _thread_local.circuit_breaker


def _reset_circuit_breaker():
    """Reset circuit breaker failure counter."""
    state = _get_circuit_breaker_state()
    state['consecutive_failures'] = 0


def _increment_circuit_breaker():
    """Increment circuit breaker failure counter."""
    state = _get_circuit_breaker_state()
    state['consecutive_failures'] += 1


def _check_circuit_breaker() -> bool:
    """
    Check if circuit breaker threshold exceeded.
    
    Returns:
        True if circuit should break (pause required)
    """
    state = _get_circuit_breaker_state()
    return state['consecutive_failures'] >= CIRCUIT_BREAKER_THRESHOLD


def _extract_ip_from_proxy(proxy_url: Optional[str]) -> str:
    """
    Extract IP address from proxy URL for logging.
    
    Args:
        proxy_url: Format 'http://user:pass@IP:PORT'
    
    Returns:
        IP address or 'direct' if no proxy
    """
    if not proxy_url:
        return "direct"
    
    try:
        # Extract IP from format: http://user:pass@IP:PORT
        parts = proxy_url.split("@")
        if len(parts) == 2:
            ip_port = parts[1]
            ip = ip_port.split(":")[0]
            # Mask last octet for privacy in logs
            octets = ip.split(".")
            if len(octets) == 4:
                return f"{octets[0]}.{octets[1]}.{octets[2]}.xxx"
        return "unknown"
    except Exception:
        return "unknown"


def _validate_url(url: str) -> bool:
    """
    Validate URL before making request.
    Prevents common mistakes and improves error messages.
    """
    if not url or not isinstance(url, str):
        return False
    
    try:
        parsed = urlparse(url)
        # Must have scheme (http/https) and network location
        if not parsed.scheme or not parsed.netloc:
            return False
        if parsed.scheme not in ('http', 'https'):
            return False
        return True
    except Exception:
        return False


def citrus_request(
    url: str,
    method: str = "GET",
    max_retries: Optional[int] = None,
    **kwargs
) -> requests.Response:
    """
    Make HTTP request with automatic proxy rotation and intelligent retry logic.
    
    This is the "Goalie Recovery" function - it never panics, always resets.
    
    Enterprise Features:
    - Rotates through 100 proxy IPs automatically
    - Exponential backoff with jitter on rate limits
    - Circuit breaker prevents burning entire proxy pool
    - Random User-Agent per request
    - Connection pooling for performance
    - Health monitoring and metrics
    - Comprehensive audit logging
    - URL validation
    
    Args:
        url: Target URL to request
        method: HTTP method (GET, POST, PUT, etc.)
        max_retries: Override default retry count (default from env)
        **kwargs: All standard requests kwargs (timeout, headers, params, etc.)
    
    Returns:
        requests.Response object (same as requests.get/post)
    
    Raises:
        requests.exceptions.RequestException: After all retries exhausted
        ValueError: If URL is invalid
    
    Example:
        >>> response = citrus_request("https://api-web.nhle.com/v1/schedule/now")
        >>> data = response.json()
    """
    # Validate URL
    if not _validate_url(url):
        raise ValueError(f"Invalid URL: {url}")
    
    proxy_manager = get_proxy_manager()
    health_monitor = get_health_monitor()
    retries = max_retries if max_retries is not None else MAX_RETRIES
    session = _get_session()
    
    # Merge realistic headers with any user-provided headers
    default_headers = get_realistic_headers()
    user_headers = kwargs.pop("headers", {})
    merged_headers = {**default_headers, **user_headers}
    
    last_exception = None
    
    for attempt in range(retries):
        # Check circuit breaker before attempting request
        if _check_circuit_breaker():
            state = _get_circuit_breaker_state()
            logger.critical(
                f"[Circuit-Breaker] ALERT: {state['consecutive_failures']} consecutive failures detected! "
                f"Pausing {CIRCUIT_BREAKER_PAUSE}s to protect proxy pool..."
            )
            time.sleep(CIRCUIT_BREAKER_PAUSE)
            _reset_circuit_breaker()
            logger.info("[Circuit-Breaker] Cooldown complete, resuming operations")
        
        # Get next proxy in rotation
        proxy_url = proxy_manager.get_next_proxy()
        proxy_ip = _extract_ip_from_proxy(proxy_url)
        
        # Setup proxies for requests
        proxies = None
        if proxy_url:
            proxies = {
                "http": proxy_url,
                "https": proxy_url
            }
        
        # Prepare request
        request_start = time.time()
        try:
            # Truncate URL for cleaner logs
            url_display = url if len(url) <= 60 else f"...{url[-57:]}"
            # Pool position included deliberately. The masked IP alone cannot
            # distinguish rotation from repetition within one /24.
            pool_size = proxy_manager.get_proxy_count()
            position = f" [{attempt + 1}/{retries} via pool of {pool_size}]" if pool_size else ""
            logger.info(f"[Citrus-IP-Rotator] Requesting {url_display} via {proxy_ip}{position}...")
            
            # Make request using session for connection pooling
            response = session.request(
                method=method.upper(),
                url=url,
                headers=merged_headers,
                proxies=proxies,
                **kwargs
            )
            
            request_duration = time.time() - request_start
            
            # Record metrics
            health_monitor.record_request(
                proxy_ip=proxy_ip,
                success=(200 <= response.status_code < 300),
                response_time=request_duration,
                status_code=response.status_code
            )
            
            # Handle rate limiting (429)
            if response.status_code == 429:
                # Calculate exponential backoff with jitter
                backoff_time = (BACKOFF_BASE ** attempt) + random.uniform(0, 0.5)
                
                logger.warning(
                    f"[Citrus-IP-Rotator] Rate limited (429), backing off {backoff_time:.1f}s and rotating proxy..."
                )
                
                _increment_circuit_breaker()
                time.sleep(backoff_time)
                continue
            
            # 407 PROXY AUTHENTICATION REQUIRED — the proxy rejected us.
            # Refreshing the list is right: the credentials may have rotated.
            if response.status_code == 407 and proxy_url:
                logger.warning(
                    "[Citrus-IP-Rotator] Proxy auth rejected (407), refreshing proxy list..."
                )
                proxy_manager.force_refresh()
                _increment_circuit_breaker()
                continue

            # 403 FORBIDDEN — the DESTINATION refused this exit IP. A different
            # condition entirely, and it needs the opposite response.
            #
            # These two were handled together, and force_refresh() rebuilds the
            # pool AND resets itertools.cycle to index 0. So every retry after a
            # 403 re-sent through proxy_list[0] — the one IP already known to be
            # blocked. Five "attempts" were one proxy tried five times, out of a
            # hundred available.
            #
            # It was invisible because _extract_ip_from_proxy masks the last
            # octet: a hundred distinct proxies and one repeated proxy both log
            # as `89.45.125.xxx`. On 2026-08-28 that read as "ESPN has blocked
            # the whole Webshare range" and nearly bought a residential plan to
            # solve a bug. The pool position in the request log below is there
            # so the next occurrence is legible.
            #
            # Correct response to a destination 403 is to advance the rotation,
            # which the loop does on its own. Do not refresh, and do not touch
            # the circuit breaker: the pool is healthy, this exit IP is not.
            if response.status_code == 403 and proxy_url:
                logger.warning(
                    "[Citrus-IP-Rotator] Destination refused this exit IP (403) "
                    "via %s, rotating to the next proxy...",
                    proxy_ip,
                )
                continue
            
            # Handle server errors (5xx)
            if 500 <= response.status_code < 600:
                # Only retry server errors twice
                if attempt < 2:
                    logger.warning(
                        f"[Citrus-IP-Rotator] Server error ({response.status_code}), retrying with new proxy..."
                    )
                    _increment_circuit_breaker()
                    time.sleep(2)
                    continue
                else:
                    # After 2 attempts, raise the error
                    response.raise_for_status()
            
            # Success! Check for other HTTP errors
            response.raise_for_status()
            
            # Reset circuit breaker on success
            _reset_circuit_breaker()
            
            logger.info(
                f"[Citrus-IP-Rotator] OK ({response.status_code}, {request_duration:.2f}s)"
            )
            
            return response
        
        except requests.exceptions.Timeout as e:
            request_duration = time.time() - request_start
            logger.warning(
                f"[Citrus-IP-Rotator] TIMEOUT after {request_duration:.1f}s via {proxy_ip}, rotating proxy..."
            )
            health_monitor.record_request(proxy_ip, success=False, response_time=request_duration)
            _increment_circuit_breaker()
            last_exception = e
            time.sleep(1)
            continue
        
        except requests.exceptions.ProxyError as e:
            request_duration = time.time() - request_start
            
            # Check if this is a 407 auth error in the tunnel connection
            if "407" in str(e):
                logger.warning(
                    f"[Citrus-IP-Rotator] Proxy tunnel auth error (407) via {proxy_ip}, refreshing proxy list..."
                )
                proxy_manager.force_refresh()
            else:
                logger.warning(
                    f"[Citrus-IP-Rotator] Proxy error via {proxy_ip}, rotating to next proxy..."
                )
            
            health_monitor.record_request(proxy_ip, success=False, response_time=request_duration)
            _increment_circuit_breaker()
            last_exception = e
            continue
        
        except requests.exceptions.ConnectionError as e:
            request_duration = time.time() - request_start
            logger.warning(
                f"[Citrus-IP-Rotator] Connection error via {proxy_ip}, rotating proxy..."
            )
            health_monitor.record_request(proxy_ip, success=False, response_time=request_duration)
            _increment_circuit_breaker()
            last_exception = e
            time.sleep(1)
            continue
        
        except requests.exceptions.HTTPError as e:
            # HTTPError for non-retryable status codes (already handled above)
            request_duration = time.time() - request_start
            logger.error(
                f"[Citrus-IP-Rotator] HTTP error {e.response.status_code} ({request_duration:.2f}s)"
            )
            _reset_circuit_breaker()
            raise
        
        except Exception as e:
            request_duration = time.time() - request_start
            logger.error(
                f"[Citrus-IP-Rotator] Unexpected error ({request_duration:.2f}s): {e}"
            )
            last_exception = e
            _increment_circuit_breaker()
            
            # Don't retry on unexpected errors
            if attempt >= retries - 1:
                raise
            continue
    
    # All proxy retries exhausted — try ONE direct (no-proxy) request as last resort.
    # The NHL API is public. Getting rate-limited (429) is recoverable; getting 0/12 games is not.
    all_proxy_errors = isinstance(last_exception, (requests.exceptions.ProxyError, requests.exceptions.ConnectionError))

    if all_proxy_errors and proxy_manager.is_enabled():
        logger.warning(
            f"[Citrus-IP-Rotator] All {retries} proxy retries failed. "
            f"Attempting DIRECT (no-proxy) request as last resort..."
        )
        try:
            request_start = time.time()
            response = session.request(
                method=method.upper(),
                url=url,
                headers=merged_headers,
                proxies=None,
                **kwargs
            )
            request_duration = time.time() - request_start

            health_monitor.record_request(
                proxy_ip="direct-fallback",
                success=(200 <= response.status_code < 300),
                response_time=request_duration,
                status_code=response.status_code
            )

            response.raise_for_status()
            _reset_circuit_breaker()

            logger.info(
                f"[Citrus-IP-Rotator] DIRECT fallback OK ({response.status_code}, {request_duration:.2f}s)"
            )
            return response

        except Exception as direct_err:
            logger.error(
                f"[Citrus-IP-Rotator] DIRECT fallback also failed: {direct_err}"
            )
            # Fall through to raise the original proxy error below

    # All retries exhausted (including direct fallback if attempted)
    logger.error(
        f"[Citrus-IP-Rotator] All {retries} retries exhausted for {url}"
    )

    if last_exception:
        raise last_exception
    else:
        raise requests.exceptions.RequestException(
            f"Failed to complete request after {retries} attempts"
        )


# Convenience wrappers for common HTTP methods
def citrus_get(url: str, **kwargs) -> requests.Response:
    """Convenience wrapper for GET requests."""
    return citrus_request(url, method="GET", **kwargs)


def citrus_post(url: str, **kwargs) -> requests.Response:
    """Convenience wrapper for POST requests."""
    return citrus_request(url, method="POST", **kwargs)


def citrus_put(url: str, **kwargs) -> requests.Response:
    """Convenience wrapper for PUT requests."""
    return citrus_request(url, method="PUT", **kwargs)


def citrus_delete(url: str, **kwargs) -> requests.Response:
    """Convenience wrapper for DELETE requests."""
    return citrus_request(url, method="DELETE", **kwargs)

