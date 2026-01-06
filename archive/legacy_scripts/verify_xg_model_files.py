#!/usr/bin/env python3
"""
verify_xg_model_files.py

Verification script to ensure all xG model files are present and in the correct location.
Run this before processing to catch missing files early.
"""

import os
import sys
import joblib

# Required model files
REQUIRED_FILES = [
    'xg_model_moneypuck.joblib',  # Primary model
    'xg_model.joblib',  # Fallback model
    'model_features_moneypuck.joblib',  # Primary features
    'model_features.joblib',  # Fallback features
    'shot_type_encoder.joblib',
    'pass_zone_encoder.joblib',
    'last_event_category_encoder.joblib',
    'xa_model.joblib',
    'xa_model_features.joblib',
    'rebound_model.joblib',
    'rebound_model_features.joblib',
    'player_shooting_talent.joblib',
]

# Critical files (pipeline will fail without these)
CRITICAL_FILES = [
    'xg_model_moneypuck.joblib',
    'model_features_moneypuck.joblib',
    'shot_type_encoder.joblib',
]

def check_model_files():
    """Check if all required model files exist and can be loaded."""
    print("=" * 80)
    print("xG MODEL FILES VERIFICATION")
    print("=" * 80)
    print()
    
    missing_files = []
    corrupted_files = []
    valid_files = []
    
    # Check each file
    for filename in REQUIRED_FILES:
        filepath = os.path.join('.', filename)
        
        if not os.path.exists(filepath):
            missing_files.append(filename)
            print(f"[MISSING] {filename}")
        else:
            # Try to load the file
            try:
                file_size = os.path.getsize(filepath)
                if file_size == 0:
                    corrupted_files.append(filename)
                    print(f"[CORRUPTED] {filename} (0 bytes)")
                else:
                    # Try to load with joblib
                    try:
                        obj = joblib.load(filepath)
                        valid_files.append(filename)
                        print(f"[OK] {filename} ({file_size:,} bytes, {type(obj).__name__})")
                    except Exception as e:
                        corrupted_files.append(filename)
                        print(f"[CORRUPTED] {filename} (cannot load: {e})")
            except Exception as e:
                corrupted_files.append(filename)
                print(f"[ERROR] {filename} (error checking: {e})")
    
    print()
    print("=" * 80)
    
    # Check for critical files
    critical_missing = [f for f in CRITICAL_FILES if f in missing_files or f in corrupted_files]
    
    if critical_missing:
        print("[CRITICAL] Missing or corrupted critical files:")
        for f in critical_missing:
            print(f"  - {f}")
        print()
        print("SOLUTION:")
        print("  1. Copy files from archive/temp_files/ to root directory:")
        print("     Copy-Item -Path archive\\temp_files\\*.joblib -Destination . -Force")
        print("  2. Or regenerate models:")
        print("     python model_trainer.py")
        print()
        return False
    
    if missing_files or corrupted_files:
        print("[WARNING] Some optional files are missing or corrupted:")
        for f in missing_files + corrupted_files:
            if f not in CRITICAL_FILES:
                print(f"  - {f}")
        print("  Pipeline may work but some features may be disabled.")
        print()
        return True
    
    print("[SUCCESS] All model files are present and valid!")
    print(f"  - {len(valid_files)}/{len(REQUIRED_FILES)} files verified")
    print()
    return True

def test_model_loading():
    """Test that models can be loaded as data_acquisition.py does."""
    print("=" * 80)
    print("TESTING MODEL LOADING (as data_acquisition.py does)")
    print("=" * 80)
    print()
    
    try:
        # Suppress warnings
        import warnings
        warnings.filterwarnings('ignore', message='.*Trying to unpickle.*', category=UserWarning)
        
        # Try to load primary model
        try:
            xg_model = joblib.load('xg_model_moneypuck.joblib')
            features = joblib.load('model_features_moneypuck.joblib')
            print(f"[OK] Primary model loaded: {type(xg_model).__name__}")
            print(f"[OK] Features loaded: {len(features)} features")
            USE_MONEYPUCK_MODEL = True
        except FileNotFoundError:
            xg_model = joblib.load('xg_model.joblib')
            features = joblib.load('model_features.joblib')
            print(f"[OK] Fallback model loaded: {type(xg_model).__name__}")
            print(f"[OK] Features loaded: {len(features)} features")
            USE_MONEYPUCK_MODEL = False
        
        # Try to load encoders
        try:
            shot_encoder = joblib.load('shot_type_encoder.joblib')
            print(f"[OK] Shot type encoder loaded: {type(shot_encoder).__name__}")
        except FileNotFoundError:
            print("[WARNING] Shot type encoder not found")
        
        try:
            pass_encoder = joblib.load('pass_zone_encoder.joblib')
            print(f"[OK] Pass zone encoder loaded: {type(pass_encoder).__name__}")
        except FileNotFoundError:
            print("[WARNING] Pass zone encoder not found")
        
        try:
            last_event_encoder = joblib.load('last_event_category_encoder.joblib')
            print(f"[OK] Last event category encoder loaded: {type(last_event_encoder).__name__}")
        except FileNotFoundError:
            print("[WARNING] Last event category encoder not found")
        
        # Try to load xA model
        try:
            xa_model = joblib.load('xa_model.joblib')
            xa_features = joblib.load('xa_model_features.joblib')
            print(f"[OK] xA model loaded: {type(xa_model).__name__}")
            print(f"[OK] xA features loaded: {len(xa_features)} features")
        except FileNotFoundError:
            print("[WARNING] xA model not found (xA calculation will be skipped)")
        
        # Try to load rebound model
        try:
            rebound_model = joblib.load('rebound_model.joblib')
            rebound_features = joblib.load('rebound_model_features.joblib')
            print(f"[OK] Rebound model loaded: {type(rebound_model).__name__}")
            print(f"[OK] Rebound features loaded: {len(rebound_features)} features")
        except FileNotFoundError:
            print("[WARNING] Rebound model not found (rebound calculation will be skipped)")
        
        print()
        print("=" * 80)
        print("[SUCCESS] All available models loaded successfully!")
        print("=" * 80)
        return True
        
    except Exception as e:
        print()
        print("=" * 80)
        print(f"[ERROR] Failed to load models: {e}")
        print("=" * 80)
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    files_ok = check_model_files()
    if files_ok:
        loading_ok = test_model_loading()
        if loading_ok:
            print()
            print("[READY] xG pipeline is ready to process data!")
            sys.exit(0)
        else:
            print()
            print("[NOT READY] Model loading failed. Fix issues above.")
            sys.exit(1)
    else:
        print()
        print("[NOT READY] Critical model files missing. Fix issues above.")
        sys.exit(1)


