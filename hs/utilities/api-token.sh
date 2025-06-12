#!/bin/bash

charset="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
result=""

for i in {1..5}; do
    part=""
    for j in {1..8}; do
        idx=$((RANDOM % ${#charset}))
        part="$part${charset:$idx:1}"
    done
    if [ -z "$result" ]; then
        result="$part"
    else
        result="$result-$part"
    fi
done

echo "$result"
