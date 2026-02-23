#!/bin/bash

# BuildingOS - Clean Startup Script
# Clears cache and starts dev servers fresh

echo "🧹 Cleaning cache..."
rm -rf node_modules/.vite 2>/dev/null
rm -rf .next 2>/dev/null
rm -rf apps/api/dist 2>/dev/null
rm -rf apps/web/.next 2>/dev/null

echo "🔨 Running full build..."
npm run build > /dev/null 2>&1

echo ""
echo "🚀 Starting BuildingOS (Clean)..."
echo ""
echo "✅ API:  Will start on http://localhost:4000"
echo "✅ Web:  Will start on http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start API in background
echo "[1/2] Starting API..."
cd apps/api
npm run dev &
API_PID=$!

# Start Web in background
echo "[2/2] Starting Web..."
cd ../web
npm run dev &
WEB_PID=$!

# Handle Ctrl+C to kill both
trap "kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM

# Wait for both processes
wait
