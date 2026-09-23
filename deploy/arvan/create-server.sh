#!/usr/bin/env bash
# Creates ONE ArvanCloud cloud server (ECC) for OpenMuse through the public API.
# THIS COSTS MONEY. Without CONFIRM=yes it only prints the request (dry run).
#
# Required env:
#   ARVAN_API_KEY   API key from panel > Profile > API keys (value after "apikey ")
#   SSH_KEY_NAME    name of an SSH key ALREADY registered in that region (e.g. openmuse-deploy)
#                   (panel > Cloud Server > SSH keys, or POST /ecc/v1/regions/{region}/ssh-keys)
# Optional env:
#   REGION          default ir-thr-ba1 (Tehran Bamdad); regions: GET /ecc/v1/regions
#   FLAVOR_ID       default g4-4-2-0 (2 vCPU, 4 GB RAM, 25 GB) - list: GET /ecc/v1/regions/$REGION/sizes
#   IMAGE_ID        default: Ubuntu 24.04 looked up via GET /images?type=distributions
#   NETWORK_ID      default: region default network from GET /servers/options
#   SECURITY_GROUP  security group NAME, default "openmuse-sg" (must exist; allow tcp 22/80/443, udp 443).
#                   Its id is looked up and sent: the API rejects names ("Requested firewall was not found").
#   DISK_SIZE       default 25 (GB)
#   SERVER_NAME     default openmuse-1
#   INIT_SCRIPT     default deploy/arvan/bootstrap.sh. Arvan runs init_script as a SHELL script;
#                   a #cloud-config document is not parsed as cloud-config.
#   CONFIRM         set to "yes" to actually send the POST
# Needs: curl, jq
set -euo pipefail

: "${ARVAN_API_KEY:?Set ARVAN_API_KEY}"
: "${SSH_KEY_NAME:?Set SSH_KEY_NAME (an SSH key registered in the region)}"
REGION="${REGION:-ir-thr-ba1}"
FLAVOR_ID="${FLAVOR_ID:-g4-4-2-0}"
SECURITY_GROUP="${SECURITY_GROUP:-openmuse-sg}"
DISK_SIZE="${DISK_SIZE:-25}"
SERVER_NAME="${SERVER_NAME:-openmuse-1}"
API="https://napi.arvancloud.ir/ecc/v1/regions/$REGION"
HERE="$(cd "$(dirname "$0")" && pwd)"
INIT_SCRIPT="${INIT_SCRIPT:-$HERE/bootstrap.sh}"
auth=(-H "Authorization: apikey $ARVAN_API_KEY" -H "Accept: application/json")

get() { curl -fsS "${auth[@]}" "$API$1"; }

if [ -z "${IMAGE_ID:-}" ]; then
  IMAGE_ID="$(get "/images?type=distributions" |
    jq -r '.data[] | select(.name|ascii_downcase=="ubuntu") | .images[] | select(.name=="24.04") | .id' | head -n1)"
fi
[ -n "$IMAGE_ID" ] || { echo "Could not find the Ubuntu 24.04 image in $REGION" >&2; exit 1; }
if [ -z "${NETWORK_ID:-}" ]; then
  NETWORK_ID="$(get "/servers/options" | jq -r '.data.network_id')"
fi
get "/sizes" | jq -e --arg f "$FLAVOR_ID" '.data[] | select(.id==$f) |
  "flavor \(.id): \(.cpu_count) vCPU, \(.memory) GB RAM, \(.disk) GB, \(.price_per_month) IRR/month"' ||
  { echo "Flavor $FLAVOR_ID is not offered in $REGION" >&2; exit 1; }
SG_ID="$(get "/securities" | jq -r --arg n "$SECURITY_GROUP" '.data[] | select(.name==$n or .real_name==$n) | .id' | head -n1)"
[ -n "$SG_ID" ] || { echo "Security group \"$SECURITY_GROUP\" not found in $REGION" >&2; exit 1; }
get "/ssh-keys" | jq -e --arg k "$SSH_KEY_NAME" '.data[] | select(.name==$k) | .name' >/dev/null ||
  { echo "SSH key \"$SSH_KEY_NAME\" is not registered in $REGION" >&2; exit 1; }

payload="$(jq -n \
  --arg name "$SERVER_NAME" --arg flavor "$FLAVOR_ID" --arg image "$IMAGE_ID" \
  --arg net "$NETWORK_ID" --arg sg "$SG_ID" --arg key "$SSH_KEY_NAME" \
  --argjson disk "$DISK_SIZE" --rawfile init "$INIT_SCRIPT" \
  '{name:$name, flavor_id:$flavor, image_id:$image, network_ids:[$net],
    security_groups:[{name:$sg}], ssh_key:true, key_name:$key, count:1,
    disk_size:$disk, init_script:$init, ha_enabled:false}')"

echo "POST $API/servers"
echo "$payload" | jq 'del(.init_script) + {init_script:"<'"$(basename "$INIT_SCRIPT")"'>"}'

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "Dry run only. Re-run with CONFIRM=yes to create the server (billed hourly)." >&2
  exit 0
fi
curl -fsS "${auth[@]}" -H "Content-Type: application/json" -X POST --data "$payload" "$API/servers" | jq .
echo "Server requested. Poll: curl -H 'Authorization: apikey ...' $API/servers | jq '.data[] | {name,status,addresses}'"
echo "SSH user is root: ssh -i <key> root@<ip>  (bootstrap log: /var/log/cloud-init-output.log)"
