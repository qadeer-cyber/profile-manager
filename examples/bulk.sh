#!/usr/bin/env bash
# Bulk create and launch three profiles. Usage: PM_API_TOKEN=... ./examples/bulk.sh
BASE=${PM_URL:-http://127.0.0.1:3000}; H="Authorization: Bearer $PM_API_TOKEN"
IDS=$(curl -s -X POST "$BASE/api/v1/bulk/create" -H "$H" -H 'Content-Type: application/json' \
  -d '{"profiles":[{"name":"bulk-1","tags":["bulk"]},{"name":"bulk-2","tags":["bulk"]},{"name":"bulk-3","tags":["bulk"]}]}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).map(p=>p.id))))')
curl -s -X POST "$BASE/api/v1/bulk/launch" -H "$H" -H 'Content-Type: application/json' -d "{\"ids\":$IDS,\"headless\":true}"
