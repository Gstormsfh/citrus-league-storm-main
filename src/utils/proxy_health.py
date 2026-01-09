#!/usr/bin/env python3
"""
proxy_health.py - Enterprise Proxy Health Monitoring & Metrics

Tracks proxy performance, success rates, and provides health-based routing.
Yahoo/Sleeper-grade quality monitoring.
"""

import time
import threading
from typing import Dict, Optional, List
from collections import defaultdict, deque
from dataclasses import dataclass, field


@dataclass
class ProxyMetrics:
    """Metrics for a single proxy."""
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_response_time: float = 0.0
    last_success_time: float = 0.0
    last_failure_time: float = 0.0
    consecutive_failures: int = 0
    rate_limited_count: int = 0
    recent_response_times: deque = field(default_factory=lambda: deque(maxlen=100))
    
    @property
    def success_rate(self) -> float:
        """Calculate success rate (0.0 to 1.0)."""
        if self.total_requests == 0:
            return 1.0  # Optimistic for new proxies
        return self.successful_requests / self.total_requests
    
    @property
    def average_response_time(self) -> float:
        """Calculate average response time in seconds."""
        if not self.recent_response_times:
            return 0.0
        return sum(self.recent_response_times) / len(self.recent_response_times)
    
    @property
    def is_healthy(self) -> bool:
        """Check if proxy is considered healthy."""
        # Unhealthy if: >5 consecutive failures OR success rate <50% after 10+ requests
        if self.consecutive_failures > 5:
            return False
        if self.total_requests >= 10 and self.success_rate < 0.5:
            return False
        return True


class ProxyHealthMonitor:
    """
    Thread-safe proxy health monitoring and metrics tracking.
    
    Enterprise features:
    - Per-proxy success/failure tracking
    - Response time metrics
    - Health-based proxy selection
    - Automatic blacklisting of bad proxies
    - Performance insights for debugging
    """
    
    def __init__(self):
        self.metrics: Dict[str, ProxyMetrics] = defaultdict(ProxyMetrics)
        self.lock = threading.Lock()
        self.global_requests = 0
        self.global_successes = 0
        self.global_failures = 0
        self.start_time = time.time()
    
    def record_request(self, proxy_ip: str, success: bool, response_time: float, 
                      status_code: Optional[int] = None):
        """
        Record a request result for metrics tracking.
        
        Args:
            proxy_ip: IP address (masked for privacy)
            success: True if request succeeded
            response_time: Time in seconds
            status_code: HTTP status code (optional)
        """
        with self.lock:
            metrics = self.metrics[proxy_ip]
            metrics.total_requests += 1
            self.global_requests += 1
            
            if success:
                metrics.successful_requests += 1
                metrics.consecutive_failures = 0
                metrics.last_success_time = time.time()
                self.global_successes += 1
            else:
                metrics.failed_requests += 1
                metrics.consecutive_failures += 1
                metrics.last_failure_time = time.time()
                self.global_failures += 1
            
            metrics.total_response_time += response_time
            metrics.recent_response_times.append(response_time)
            
            # Track rate limits specifically
            if status_code == 429:
                metrics.rate_limited_count += 1
    
    def get_proxy_health(self, proxy_ip: str) -> ProxyMetrics:
        """Get health metrics for a specific proxy."""
        with self.lock:
            return self.metrics[proxy_ip]
    
    def get_healthy_proxies(self) -> List[str]:
        """Get list of healthy proxy IPs."""
        with self.lock:
            return [ip for ip, metrics in self.metrics.items() if metrics.is_healthy]
    
    def get_unhealthy_proxies(self) -> List[str]:
        """Get list of unhealthy proxy IPs."""
        with self.lock:
            return [ip for ip, metrics in self.metrics.items() if not metrics.is_healthy]
    
    def get_best_proxy(self) -> Optional[str]:
        """Get the best performing proxy based on success rate and response time."""
        with self.lock:
            if not self.metrics:
                return None
            
            # Filter to healthy proxies
            healthy = [(ip, m) for ip, m in self.metrics.items() if m.is_healthy]
            if not healthy:
                return None
            
            # Score: 70% success rate + 30% response time (inverse)
            # Lower is better for response time
            def score_proxy(item):
                ip, metrics = item
                if metrics.total_requests == 0:
                    return 0.0  # New proxies get neutral score
                
                success_score = metrics.success_rate
                # Normalize response time (lower is better, max 10s)
                time_score = max(0, 1 - (metrics.average_response_time / 10.0))
                return (success_score * 0.7) + (time_score * 0.3)
            
            best_ip, _ = max(healthy, key=score_proxy)
            return best_ip
    
    def get_global_stats(self) -> Dict:
        """Get global statistics across all proxies."""
        with self.lock:
            uptime = time.time() - self.start_time
            success_rate = (self.global_successes / self.global_requests * 100) if self.global_requests > 0 else 0
            
            return {
                'total_requests': self.global_requests,
                'successful_requests': self.global_successes,
                'failed_requests': self.global_failures,
                'success_rate': f"{success_rate:.2f}%",
                'uptime_seconds': int(uptime),
                'uptime_hours': uptime / 3600,
                'requests_per_hour': (self.global_requests / (uptime / 3600)) if uptime > 0 else 0,
                'unique_proxies_used': len(self.metrics),
                'healthy_proxies': len(self.get_healthy_proxies()),
                'unhealthy_proxies': len(self.get_unhealthy_proxies())
            }
    
    def print_stats(self):
        """Print comprehensive statistics (for debugging)."""
        stats = self.get_global_stats()
        
        print("\n" + "="*60)
        print("PROXY HEALTH MONITOR - GLOBAL STATS")
        print("="*60)
        print(f"Total Requests:     {stats['total_requests']:,}")
        print(f"Successful:         {stats['successful_requests']:,}")
        print(f"Failed:             {stats['failed_requests']:,}")
        print(f"Success Rate:       {stats['success_rate']}")
        print(f"Uptime:             {stats['uptime_hours']:.2f} hours")
        print(f"Requests/Hour:      {stats['requests_per_hour']:.1f}")
        print(f"Proxies Used:       {stats['unique_proxies_used']}")
        print(f"Healthy Proxies:    {stats['healthy_proxies']}")
        print(f"Unhealthy Proxies:  {stats['unhealthy_proxies']}")
        
        # Top 5 best performing proxies
        with self.lock:
            sorted_proxies = sorted(
                self.metrics.items(),
                key=lambda x: x[1].success_rate,
                reverse=True
            )[:5]
        
        if sorted_proxies:
            print("\nTop 5 Best Performing Proxies:")
            for i, (ip, metrics) in enumerate(sorted_proxies, 1):
                print(f"  {i}. {ip} - {metrics.success_rate*100:.1f}% success "
                      f"({metrics.successful_requests}/{metrics.total_requests} requests, "
                      f"avg {metrics.average_response_time:.2f}s)")
        
        print("="*60 + "\n")
    
    def reset_stats(self):
        """Reset all statistics (use with caution)."""
        with self.lock:
            self.metrics.clear()
            self.global_requests = 0
            self.global_successes = 0
            self.global_failures = 0
            self.start_time = time.time()


# Global singleton instance
_health_monitor_instance: Optional[ProxyHealthMonitor] = None
_monitor_lock = threading.Lock()


def get_health_monitor() -> ProxyHealthMonitor:
    """
    Get or create the global ProxyHealthMonitor singleton.
    Thread-safe initialization.
    
    Returns:
        Global ProxyHealthMonitor instance
    """
    global _health_monitor_instance
    
    if _health_monitor_instance is None:
        with _monitor_lock:
            # Double-check locking pattern
            if _health_monitor_instance is None:
                _health_monitor_instance = ProxyHealthMonitor()
    
    return _health_monitor_instance

