#!/usr/bin/env python3
from dotenv import load_dotenv
import os

load_dotenv()

key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
url = os.getenv('VITE_SUPABASE_URL')

print("="*50)
print("ENV VARIABLE CHECK")
print("="*50)
print(f"URL: {url}")
print(f"Key found: {key is not None}")
if key:
    print(f"Key length: {len(key)}")
    print(f"Key starts with: {key[:30]}...")
    print(f"Has parentheses: {'(' in key or ')' in key}")
    print(f"Valid JWT format: {key.startswith('eyJ')}")
else:
    print("❌ KEY NOT FOUND!")
print("="*50)

