#!/bin/bash

set -e
clear

# Path to your .env file
ENV_FILE="../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo ".env file not found."
  exit 1
fi

# Load .env file
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Show loaded env values
echo "==================================================================="
echo "KV_NAME=$KV_NAME"
echo "Wait until the KV and KV preview spaces are created ..."

# Create KV namespaces
npx wrangler kv namespace create "$KV_NAME" > /dev/null
npx wrangler kv namespace create "$KV_NAME" --preview > /dev/null

# Get KV namespace list and save to temp files
npx wrangler kv namespace list > temp_raw.json

# Create a copy (optional, simulating the intermediate file in original script)
cp temp_raw.json temp.json

# Parse with jq
jq -r '.[] | "KV: \(.title); ID: \(.id)"' temp.json > parsed.txt

# Echo each parsed line
while IFS= read -r line; do
  echo "$line"
done < parsed.txt

echo "==================================================================="

# Cleanup
rm -f temp.json parsed.txt temp_raw.json
