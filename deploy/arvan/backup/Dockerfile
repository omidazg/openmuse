# Backup image: the same Postgres 17 client tools as the database, plus the static
# rclone binary for ArvanCloud Object Storage (S3). Both pulled from Docker Hub, so
# REGISTRY_MIRROR=docker.arvancloud.ir/ works on Iran-region servers.
ARG REGISTRY_MIRROR=
ARG RCLONE_TAG=latest
FROM ${REGISTRY_MIRROR}rclone/rclone:${RCLONE_TAG} AS rclone

FROM ${REGISTRY_MIRROR}library/postgres:17-alpine
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
# The script itself is bind-mounted from deploy/arvan/backup/backup.sh (no rebuild on edits).
ENTRYPOINT ["/bin/sh", "/opt/backup/backup.sh"]
CMD ["loop"]
