#!/usr/bin/env python3
"""
monitor_proxy_health.py - Real-time Proxy Health Dashboard

View real-time statistics on your proxy pool performance.
Yahoo/Sleeper-grade operational monitoring.

Usage:
    python monitor_proxy_health.py              # View current stats
    python monitor_proxy_health.py --watch      # Live monitoring (refresh every 10s)
    python monitor_proxy_health.py --reset      # Reset all statistics
"""

import argparse
import time
import sys
from dotenv import load_dotenv

load_dotenv()


def print_dashboard():
    """Print comprehensive proxy health dashboard."""
    try:
        from src.utils.proxy_health import get_health_monitor
        
        monitor = get_health_monitor()
        stats = monitor.get_global_stats()
        
        # Clear screen (works on Windows and Unix)
        print("\033[2J\033[H")  # ANSI escape codes
        
        print("="*70)
        print(" " * 15 + "🍋 CITRUS PROXY HEALTH MONITOR 🍋")
        print("="*70)
        
        # Global Statistics
        print("\n📊 GLOBAL STATISTICS")
        print("-" * 70)
        print(f"  Total Requests:        {stats['total_requests']:,}")
        print(f"  Successful:            {stats['successful_requests']:,}")
        print(f"  Failed:                {stats['failed_requests']:,}")
        print(f"  Success Rate:          {stats['success_rate']}")
        print(f"  Uptime:                {stats['uptime_hours']:.2f} hours")
        print(f"  Requests/Hour:         {stats['requests_per_hour']:.1f}")
        
        # Proxy Pool Health
        print("\n🔄 PROXY POOL HEALTH")
        print("-" * 70)
        print(f"  Total Proxies Used:    {stats['unique_proxies_used']}")
        print(f"  Healthy Proxies:       {stats['healthy_proxies']} ✅")
        print(f"  Unhealthy Proxies:     {stats['unhealthy_proxies']} ⚠️")
        
        # Top Performers
        with monitor.lock:
            sorted_proxies = sorted(
                monitor.metrics.items(),
                key=lambda x: (x[1].success_rate, -x[1].average_response_time),
                reverse=True
            )[:5]
        
        if sorted_proxies:
            print("\n⭐ TOP 5 BEST PERFORMING PROXIES")
            print("-" * 70)
            for i, (ip, metrics) in enumerate(sorted_proxies, 1):
                status = "✅" if metrics.is_healthy else "⚠️"
                print(f"  {i}. {ip} {status}")
                print(f"     Success: {metrics.success_rate*100:.1f}% "
                      f"({metrics.successful_requests}/{metrics.total_requests} requests)")
                print(f"     Avg Response Time: {metrics.average_response_time:.2f}s")
                if metrics.rate_limited_count > 0:
                    print(f"     Rate Limits: {metrics.rate_limited_count}")
        
        # Bottom Performers (if any unhealthy)
        if stats['unhealthy_proxies'] > 0:
            unhealthy = [(ip, m) for ip, m in monitor.metrics.items() if not m.is_healthy]
            unhealthy.sort(key=lambda x: x[1].success_rate)
            
            print("\n⚠️  UNHEALTHY PROXIES (Need Attention)")
            print("-" * 70)
            for i, (ip, metrics) in enumerate(unhealthy[:5], 1):
                print(f"  {i}. {ip}")
                print(f"     Success: {metrics.success_rate*100:.1f}% "
                      f"({metrics.successful_requests}/{metrics.total_requests} requests)")
                print(f"     Consecutive Failures: {metrics.consecutive_failures}")
        
        # Performance Insights
        print("\n💡 PERFORMANCE INSIGHTS")
        print("-" * 70)
        
        # Calculate aggregate response time
        if monitor.metrics:
            all_times = []
            for metrics in monitor.metrics.values():
                if metrics.recent_response_times:
                    all_times.extend(metrics.recent_response_times)
            
            if all_times:
                avg_time = sum(all_times) / len(all_times)
                min_time = min(all_times)
                max_time = max(all_times)
                
                print(f"  Average Response Time: {avg_time:.2f}s")
                print(f"  Fastest Response:      {min_time:.2f}s")
                print(f"  Slowest Response:      {max_time:.2f}s")
        
        # System Status
        print("\n🚦 SYSTEM STATUS")
        print("-" * 70)
        
        if stats['success_rate'].replace('%', '').replace('.', '').isdigit():
            success_pct = float(stats['success_rate'].replace('%', ''))
            if success_pct >= 95:
                status = "🟢 EXCELLENT - System running smoothly"
            elif success_pct >= 85:
                status = "🟡 GOOD - Minor issues detected"
            elif success_pct >= 70:
                status = "🟠 DEGRADED - Performance impact possible"
            else:
                status = "🔴 CRITICAL - Immediate attention needed"
        else:
            status = "⚪ UNKNOWN - No data yet"
        
        print(f"  {status}")
        
        print("\n" + "="*70)
        print(f"  Last Updated: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*70)
        
    except Exception as e:
        print(f"Error displaying dashboard: {e}")
        import traceback
        traceback.print_exc()


def watch_mode():
    """Continuously refresh dashboard every 10 seconds."""
    print("Starting live monitoring... (Press Ctrl+C to stop)")
    try:
        while True:
            print_dashboard()
            time.sleep(10)
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped.")


def reset_stats():
    """Reset all proxy health statistics."""
    try:
        from src.utils.proxy_health import get_health_monitor
        
        monitor = get_health_monitor()
        
        response = input("Are you sure you want to reset all statistics? (yes/no): ")
        if response.lower() in ('yes', 'y'):
            monitor.reset_stats()
            print("✅ All statistics have been reset.")
        else:
            print("❌ Reset cancelled.")
    except Exception as e:
        print(f"Error resetting stats: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor Citrus Proxy Health",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--watch', action='store_true', 
                       help='Continuously refresh dashboard (every 10s)')
    parser.add_argument('--reset', action='store_true',
                       help='Reset all statistics')
    
    args = parser.parse_args()
    
    if args.reset:
        reset_stats()
    elif args.watch:
        watch_mode()
    else:
        print_dashboard()


if __name__ == "__main__":
    main()

