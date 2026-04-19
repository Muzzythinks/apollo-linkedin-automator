#!/bin/bash
cd "$(dirname "$0")"

# Check Node.js is installed
if ! command -v node &> /dev/null; then
  echo ""
  echo "Node.js is not installed."
  echo "Download it from https://nodejs.org, install it, then double-click this file again."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

# Check API key has been filled in
API_KEY=$(grep APOLLO_API_KEY .env | cut -d '=' -f2)
if [ "$API_KEY" = "YOUR_APOLLO_API_KEY_HERE" ] || [ -z "$API_KEY" ]; then
  echo ""
  echo "Open the .env file and replace YOUR_APOLLO_API_KEY_HERE with your Apollo API key."
  echo "Then double-click this file again."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (one-time setup)..."
  npm install --silent
  echo "Done."
  echo ""
fi

# Open dashboard in browser after server starts
sleep 2 && open http://localhost:3000 &

echo "Starting dashboard..."
echo "Opening http://localhost:3000 in your browser."
echo "Close this window to stop the server."
echo ""
node server.js
