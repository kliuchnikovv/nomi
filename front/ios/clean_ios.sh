#!/bin/bash

# Script to clean iOS build cache and reinstall pods

set -e

echo "🧹 Cleaning iOS build cache..."

# Remove DerivedData
rm -rf ~/Library/Developer/Xcode/DerivedData/genie-*

# Remove build folder
rm -rf build

# Remove Pods folder
rm -rf Pods

# Remove Podfile.lock
rm -f Podfile.lock

echo "✅ Clean complete. Please run 'pod install' next."
