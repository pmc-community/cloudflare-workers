#!/bin/bash

set -e

# Clear screen
clear

# Ensure all required parameters are provided
if [ $# -lt 4 ]; then
  echo "Usage: $0 <json_file> <encryption_key_secret_name> <iv_secret_name> <kv_key>"
  exit 1
fi

# Assign parameters
INPUT_JSON_FILE="$1"
KEY_SECRET_NAME="$2"
IV_SECRET_NAME="$3"
KV_KEY="$4"

# Check if the input file exists
if [ ! -f "$INPUT_JSON_FILE" ]; then
  echo "File '$INPUT_JSON_FILE' does not exist."
  exit 1
fi

# Extract base name and directory
BASENAME=$(basename "$INPUT_JSON_FILE" .json)
DIRNAME=$(dirname "$INPUT_JSON_FILE")

# Construct output file names
ENCRYPTED_FILE="$DIRNAME/${BASENAME}_enc.txt"
KEY_FILE="$DIRNAME/${BASENAME}.key"
IV_FILE="$DIRNAME/${BASENAME}.iv"

# Delete existing output files if they exist
rm -f "$ENCRYPTED_FILE" "$KEY_FILE" "$IV_FILE"

# Generate a random 32-byte key (hex-encoded)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Generate a random 16-byte IV (hex-encoded)
IV=$(openssl rand -hex 16)

# Encrypt the file
openssl enc -aes-256-cbc -in "$INPUT_JSON_FILE" -out "$ENCRYPTED_FILE" -base64 -K "$ENCRYPTION_KEY" -iv "$IV"

# Save key and IV to files
echo "$ENCRYPTION_KEY" > "$KEY_FILE"
echo "$IV" > "$IV_FILE"

# Output values
echo
echo "======================================="
echo "Encryption Key (hex): $ENCRYPTION_KEY"
echo "Initialization Vector (IV - hex): $IV"
echo "======================================="
echo

# Upload to production KV namespace
echo "Uploading to production KV..."
wrangler kv:key put --remote --binding=HS_KV --preview=false "$KV_KEY" --path "$ENCRYPTED_FILE"

# Upload to preview KV namespace
echo "Uploading to preview KV..."
wrangler kv:key put --remote --binding=HS_KV --preview "$KV_KEY" --path "$ENCRYPTED_FILE"

# Push secrets using Wrangler
echo "Uploading encryption key secret..."
echo "$ENCRYPTION_KEY" | wrangler secret put "$KEY_SECRET_NAME"

echo "Uploading IV secret..."
echo "$IV" | wrangler secret put "$IV_SECRET_NAME"

# Delete sensitive files after upload (comment out if debugging)
rm -f "$ENCRYPTED_FILE" "$KEY_FILE" "$IV_FILE"

echo
echo "====================================================="
echo "Encryption and upload completed successfully."
echo "Encrypted file: $ENCRYPTED_FILE"
echo "Uploaded to KV under key: $KV_KEY"
echo "Encryption key stored as secret: $KEY_SECRET_NAME"
echo "IV stored as secret: $IV_SECRET_NAME"
echo "====================================================="
