#!/usr/bin/env python3
"""
proxy_manager.py - Enterprise-Grade Proxy Management for Citrus Scraping

Features:
- Fetches and caches 100 IPs from Webshare proxy service
- Sequential rotation using itertools.cycle
- Thread-safe proxy selection
- Auto-refresh on authentication failures
- 1-hour TTL cache with fallback to direct requests
"""

import os
import time
import threading
import itertools
import logging
from typing import Optional, List, Dict
from dotenv import load_dotenv
import requests

load_dotenv()

logger = logging.getLogger("CitrusProxyManager")


class ProxyManager:
    """
    Manages a pool of rotating proxies with caching and thread-safe access.
    
    Architecture:
    - Fetches proxy list from Webshare API on initialization
    - Caches proxies in memory with 1-hour TTL
    - Uses itertools.cycle for sequential rotation
    - Thread-safe via threading.Lock
    """
    
    def __init__(self):
        self.username = os.getenv("CITRUS_PROXY_USERNAME", "wtkvqebq")
        self.password = os.getenv("CITRUS_PROXY_PASSWORD", "e2o3t90lka78")
        self.api_url = os.getenv(
            "CITRUS_PROXY_API_URL",
            "https://proxy.webshare.io/api/v2/proxy/list/download/vttnipddbxwfvslipogsgpzsneeydesmgtnfohbk/-/any/username/direct/-/?plan_id=12559674"
        )
        
        self.proxy_list: List[str] = []
        self.proxy_cycle: Optional[itertools.cycle] = None
        self.cache_time: float = 0
        self.cache_ttl: int = 3600  # 1 hour in seconds
        self.lock = threading.Lock()
        self.enabled = os.getenv("CITRUS_PROXY_ENABLED", "true").lower() == "true"
        
        # Initialize proxy list
        if self.enabled:
            self._refresh_proxy_list()
        else:
            logger.warning("[ProxyManager] Proxy rotation DISABLED via CITRUS_PROXY_ENABLED=false")
    
    def _fetch_proxy_list_from_api(self) -> List[Dict]:
        """
        Fetch raw proxy list from Webshare API.
        
        Webshare returns plain text format:
        IP:PORT:USERNAME:PASSWORD (one per line)
        
        Returns:
            List of proxy dicts with 'proxy_address' and 'port' keys
        """
        try:
            logger.info("[ProxyManager] Fetching proxy list from Webshare API...")
            response = requests.get(self.api_url, timeout=30)
            response.raise_for_status()
            
            # Webshare returns plain text: IP:PORT:USERNAME:PASSWORD (one per line)
            text = response.text.strip()
            lines = text.split('\n')
            
            proxies = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Parse format: IP:PORT:USERNAME:PASSWORD
                parts = line.split(':')
                if len(parts) >= 2:
                    proxies.append({
                        'proxy_address': parts[0],
                        'port': parts[1]
                    })
            
            if proxies:
                logger.info(f"[ProxyManager] ✅ Fetched {len(proxies)} proxies from API")
                return proxies
            else:
                logger.error("[ProxyManager] ❌ No proxies parsed from API response")
                return []
                
        except requests.exceptions.RequestException as e:
            logger.error(f"[ProxyManager] ❌ Failed to fetch proxy list: {e}")
            return []
        except Exception as e:
            logger.error(f"[ProxyManager] ❌ Unexpected error fetching proxies: {e}")
            return []
    
    def _format_proxy(self, proxy_dict: Dict) -> str:
        """
        Format proxy dict into requests-compatible proxy URL.
        
        Args:
            proxy_dict: Dict with 'proxy_address' and 'port' keys
        
        Returns:
            Formatted proxy string: http://username:password@IP:PORT
        """
        ip = proxy_dict.get("proxy_address", "")
        port = proxy_dict.get("port", "")
        
        if not ip or not port:
            return ""
        
        return f"http://{self.username}:{self.password}@{ip}:{port}"
    
    def _refresh_proxy_list(self) -> bool:
        """
        Refresh the cached proxy list from API.
        Thread-safe and updates cache timestamp.
        
        Returns:
            True if successful, False otherwise
        """
        with self.lock:
            raw_proxies = self._fetch_proxy_list_from_api()
            
            if not raw_proxies:
                logger.warning("[ProxyManager] ⚠️ No proxies fetched, keeping existing cache if available")
                return False
            
            # Format all proxies
            formatted_proxies = []
            for proxy_dict in raw_proxies:
                formatted = self._format_proxy(proxy_dict)
                if formatted:
                    formatted_proxies.append(formatted)
            
            if not formatted_proxies:
                logger.error("[ProxyManager] ❌ No valid proxies after formatting")
                return False
            
            # Update cache
            self.proxy_list = formatted_proxies
            self.proxy_cycle = itertools.cycle(self.proxy_list)
            self.cache_time = time.time()
            
            logger.info(f"[ProxyManager] ✅ Proxy cache refreshed: {len(self.proxy_list)} proxies available")
            return True
    
    def _is_cache_expired(self) -> bool:
        """Check if proxy cache has exceeded TTL."""
        return (time.time() - self.cache_time) > self.cache_ttl
    
    def get_next_proxy(self) -> Optional[str]:
        """
        Get the next proxy in rotation sequence.
        Thread-safe and handles cache refresh automatically.
        
        Returns:
            Proxy URL string or None if proxies disabled/unavailable
        """
        if not self.enabled:
            return None
        
        with self.lock:
            # Refresh cache if expired or empty
            if not self.proxy_list or self._is_cache_expired():
                logger.info("[ProxyManager] Cache expired or empty, refreshing...")
                self._refresh_proxy_list()
            
            # Return next proxy in cycle
            if self.proxy_cycle:
                try:
                    return next(self.proxy_cycle)
                except StopIteration:
                    # Should never happen with itertools.cycle, but safety fallback
                    logger.warning("[ProxyManager] ⚠️ Proxy cycle exhausted unexpectedly, refreshing...")
                    self._refresh_proxy_list()
                    if self.proxy_cycle:
                        return next(self.proxy_cycle)
            
            return None
    
    def force_refresh(self) -> bool:
        """
        Force an immediate refresh of the proxy list.
        Useful when detecting authentication failures.
        
        Returns:
            True if refresh successful
        """
        logger.info("[ProxyManager] 🔄 Force refresh requested")
        return self._refresh_proxy_list()
    
    def get_proxy_count(self) -> int:
        """Get the current number of cached proxies."""
        with self.lock:
            return len(self.proxy_list)
    
    def is_enabled(self) -> bool:
        """Check if proxy rotation is enabled."""
        return self.enabled


# Global singleton instance
_proxy_manager_instance: Optional[ProxyManager] = None
_instance_lock = threading.Lock()


def get_proxy_manager() -> ProxyManager:
    """
    Get or create the global ProxyManager singleton.
    Thread-safe initialization.
    
    Returns:
        Global ProxyManager instance
    """
    global _proxy_manager_instance
    
    if _proxy_manager_instance is None:
        with _instance_lock:
            # Double-check locking pattern
            if _proxy_manager_instance is None:
                _proxy_manager_instance = ProxyManager()
    
    return _proxy_manager_instance


# User-Agent pool for realistic request headers
USER_AGENTS = [
    # Chrome on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Chrome on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Firefox on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    # Firefox on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
    # Safari on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    # Edge on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    # Chrome on Linux
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Firefox on Linux
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    # Safari on iOS
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    # Chrome on Android
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36"
]


def get_random_user_agent() -> str:
    """
    Get a random user agent from the pool.
    
    Returns:
        User-Agent string
    """
    import random
    return random.choice(USER_AGENTS)


def get_realistic_headers() -> Dict[str, str]:
    """
    Get realistic HTTP headers for requests.
    
    Returns:
        Dict of common browser headers
    """
    return {
        "User-Agent": get_random_user_agent(),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site"
    }

