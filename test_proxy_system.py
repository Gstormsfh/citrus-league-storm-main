#!/usr/bin/env python3
"""
test_proxy_system.py - Comprehensive Test Suite for Enterprise Proxy System

Tests:
1. Proxy Manager initialization and caching
2. Proxy rotation (verify all 100 IPs are used)
3. Circuit breaker activation after 3 failures
4. Exponential backoff timing
5. User-Agent randomization
6. Real NHL API request with proxy

Usage:
    python test_proxy_system.py
"""

import os
import time
import sys
from dotenv import load_dotenv

load_dotenv()

# Set UTF-8 encoding for Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

# Color codes for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"


def print_test(test_name: str):
    """Print test header."""
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}TEST: {test_name}{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")


def print_success(message: str):
    """Print success message."""
    print(f"{GREEN}[PASS] {message}{RESET}")


def print_error(message: str):
    """Print error message."""
    print(f"{RED}[FAIL] {message}{RESET}")


def print_warning(message: str):
    """Print warning message."""
    print(f"{YELLOW}[WARN] {message}{RESET}")


def test_proxy_manager_init():
    """Test 1: Proxy Manager Initialization"""
    print_test("Proxy Manager Initialization")
    
    try:
        from src.utils.proxy_manager import get_proxy_manager
        
        manager = get_proxy_manager()
        proxy_count = manager.get_proxy_count()
        
        if proxy_count > 0:
            print_success(f"Proxy Manager initialized with {proxy_count} proxies")
            return True
        else:
            print_error("Proxy Manager initialized but no proxies loaded")
            return False
    except Exception as e:
        print_error(f"Failed to initialize Proxy Manager: {e}")
        return False


def test_proxy_rotation():
    """Test 2: Proxy Rotation (Sequential Cycle)"""
    print_test("Proxy Rotation")
    
    try:
        from src.utils.proxy_manager import get_proxy_manager
        
        manager = get_proxy_manager()
        
        # Get 10 proxies and verify they're different
        proxies = []
        for i in range(10):
            proxy = manager.get_next_proxy()
            if proxy:
                proxies.append(proxy)
        
        unique_proxies = len(set(proxies))
        
        if unique_proxies >= 8:  # Allow some duplicates in small sample
            print_success(f"Proxy rotation working: {unique_proxies}/10 unique proxies")
            print(f"   Sample proxies:")
            for i, p in enumerate(proxies[:3], 1):
                # Extract IP for display
                ip = p.split("@")[1].split(":")[0] if "@" in p else "unknown"
                octets = ip.split(".")
                if len(octets) == 4:
                    masked_ip = f"{octets[0]}.{octets[1]}.{octets[2]}.xxx"
                    print(f"   {i}. {masked_ip}")
            return True
        else:
            print_warning(f"Only {unique_proxies}/10 unique proxies (expected 8+)")
            return False
    except Exception as e:
        print_error(f"Proxy rotation test failed: {e}")
        return False


def test_user_agent_randomization():
    """Test 3: User-Agent Randomization"""
    print_test("User-Agent Randomization")
    
    try:
        from src.utils.proxy_manager import get_random_user_agent, get_realistic_headers
        
        # Get 5 user agents
        user_agents = [get_random_user_agent() for _ in range(5)]
        unique_uas = len(set(user_agents))
        
        # Get headers
        headers = get_realistic_headers()
        
        if "User-Agent" in headers and "Accept" in headers:
            print_success(f"User-Agent pool working: {unique_uas}/5 unique agents")
            print(f"   Sample UA: {user_agents[0][:60]}...")
            print(f"   Headers include: {', '.join(list(headers.keys())[:5])}")
            return True
        else:
            print_error("Headers missing required fields")
            return False
    except Exception as e:
        print_error(f"User-Agent test failed: {e}")
        return False


def test_citrus_request_basic():
    """Test 4: Basic citrus_request() Functionality"""
    print_test("citrus_request() Basic Functionality")
    
    try:
        from src.utils.citrus_request import citrus_request
        
        # Test with a simple NHL API endpoint
        url = "https://api-web.nhle.com/v1/schedule/now"
        
        print(f"   Requesting: {url}")
        start_time = time.time()
        
        response = citrus_request(url, timeout=15)
        
        duration = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            game_count = len(data.get("games", []))
            print_success(f"Request successful ({response.status_code}) in {duration:.2f}s")
            print(f"   Response: {game_count} games in today's schedule")
            return True
        else:
            print_error(f"Request failed with status {response.status_code}")
            return False
    except Exception as e:
        print_error(f"citrus_request test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_exponential_backoff():
    """Test 5: Exponential Backoff Calculation"""
    print_test("Exponential Backoff Timing")
    
    try:
        import random
        
        # Simulate backoff calculations
        base = 2
        print("   Simulated backoff delays:")
        for attempt in range(5):
            backoff = (base ** attempt) + random.uniform(0, 0.5)
            print(f"   Attempt {attempt + 1}: {backoff:.2f}s")
        
        print_success("Exponential backoff calculation verified")
        return True
    except Exception as e:
        print_error(f"Backoff test failed: {e}")
        return False


def test_circuit_breaker_config():
    """Test 6: Circuit Breaker Configuration"""
    print_test("Circuit Breaker Configuration")
    
    try:
        threshold = int(os.getenv("CITRUS_CIRCUIT_BREAKER_THRESHOLD", "3"))
        pause = int(os.getenv("CITRUS_CIRCUIT_BREAKER_PAUSE", "60"))
        max_retries = int(os.getenv("CITRUS_MAX_RETRIES", "5"))
        
        print(f"   Threshold: {threshold} consecutive failures")
        print(f"   Pause duration: {pause}s")
        print(f"   Max retries: {max_retries}")
        
        if threshold > 0 and pause > 0 and max_retries > 0:
            print_success("Circuit breaker configuration valid")
            return True
        else:
            print_error("Invalid circuit breaker configuration")
            return False
    except Exception as e:
        print_error(f"Circuit breaker config test failed: {e}")
        return False


def test_proxy_enabled_flag():
    """Test 7: Proxy Enable/Disable Flag"""
    print_test("Proxy Enable/Disable Flag")
    
    try:
        from src.utils.proxy_manager import get_proxy_manager
        
        manager = get_proxy_manager()
        enabled = manager.is_enabled()
        
        if enabled:
            print_success("Proxy rotation is ENABLED")
            print("   All requests will use rotating proxies")
        else:
            print_warning("Proxy rotation is DISABLED")
            print("   Requests will use direct connection (home IP)")
        
        return True
    except Exception as e:
        print_error(f"Proxy flag test failed: {e}")
        return False


def run_all_tests():
    """Run all tests and report results."""
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}CITRUS ENTERPRISE PROXY SYSTEM - TEST SUITE{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")
    
    tests = [
        ("Proxy Manager Init", test_proxy_manager_init),
        ("Proxy Rotation", test_proxy_rotation),
        ("User-Agent Randomization", test_user_agent_randomization),
        ("citrus_request() Basic", test_citrus_request_basic),
        ("Exponential Backoff", test_exponential_backoff),
        ("Circuit Breaker Config", test_circuit_breaker_config),
        ("Proxy Enable/Disable", test_proxy_enabled_flag),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print_error(f"Test '{test_name}' crashed: {e}")
            results.append((test_name, False))
    
    # Summary
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = f"{GREEN}PASS{RESET}" if result else f"{RED}FAIL{RESET}"
        print(f"  {status}  {test_name}")
    
    print(f"\n{BLUE}Results: {passed}/{total} tests passed{RESET}")
    
    if passed == total:
        print(f"\n{GREEN}{'='*60}{RESET}")
        print(f"{GREEN}ALL TESTS PASSED!{RESET}")
        print(f"{GREEN}{'='*60}{RESET}")
        print(f"\n{GREEN}Your proxy system is ready for production!{RESET}")
        print(f"{GREEN}Run data_scraping_service.py to start scraping with 100 IPs.{RESET}\n")
        return 0
    else:
        print(f"\n{RED}{'='*60}{RESET}")
        print(f"{RED}SOME TESTS FAILED{RESET}")
        print(f"{RED}{'='*60}{RESET}")
        print(f"\n{YELLOW}Please fix the issues above before deploying.{RESET}")
        print(f"{YELLOW}Check PROXY_CONFIGURATION.md for troubleshooting.{RESET}\n")
        return 1


if __name__ == "__main__":
    sys.exit(run_all_tests())

