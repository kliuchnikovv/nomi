#!/bin/bash
# Jules VM Environment Setup Script
# This script runs when Jules initializes the development environment
set -e

echo ">>> Initializing Jules Environment for Genie Monorepo..."

# ============================================
# 1. Go Backend (api/)
# ============================================
echo ">>> Setting up Go environment..."
cd api

# Download dependencies
go mod download

# Install linter (if not present)
if ! command -v golangci-lint &> /dev/null; then
    echo ">>> Installing golangci-lint..."
    curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin v1.55.0
fi

# Verify build
echo ">>> Verifying Go build..."
go build ./...

cd ..

# ============================================
# 2. Python Agent (back/)
# ============================================
echo ">>> Setting up Python environment..."
cd back

# Check Python version (prefer python3.11 if available)
if command -v python3.11 &> /dev/null; then
    PYTHON_CMD="python3.11"
else
    PYTHON_CMD="python3"
fi

PYTHON_VERSION=$($PYTHON_CMD -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
REQUIRED_VERSION="3.10"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$PYTHON_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "⚠️  WARNING: Python $PYTHON_VERSION detected, but $REQUIRED_VERSION+ is required"
    echo "⚠️  Skipping Python setup. Install Python 3.10+ to enable Python agent."
    echo "⚠️  Recommended: brew install python@3.11"
    cd ..
else
    # Create virtual environment if not exists
    if [ ! -d ".venv" ]; then
        $PYTHON_CMD -m venv .venv
    fi

    # Activate and install dependencies
    source .venv/bin/activate
    pip install --upgrade pip -q
    pip install -r requirements.txt -q || echo "⚠️  Some dependencies failed to install"

    # Install dev tools
    pip install pytest flake8 black -q || true
    
    cd ..
fi

# ============================================
# 3. React Native (front/) - Limited setup
# ============================================
echo ">>> Setting up Node.js environment..."
cd front

# Install npm dependencies
npm install --silent

# Note: Cannot run iOS/Android simulators in Jules VM
# Only linting and type-checking available
echo ">>> Running TypeScript check..."
npx tsc --noEmit || echo "TypeScript check completed (warnings may exist)"

cd ..

# ============================================
# Done
# ============================================
echo ""
echo "=========================================="
echo ">>> Jules Environment Ready!"
echo "=========================================="
echo ""
echo "Available commands:"
echo "  Go API:     cd api && go test ./..."
echo "  Python:     cd back && pytest"
echo "  Frontend:   cd front && npm run lint"
echo ""
