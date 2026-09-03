FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends awscli \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/backup-cron-entrypoint.sh /usr/local/bin/backup-cron-entrypoint.sh
RUN chmod +x /usr/local/bin/backup-cron-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/backup-cron-entrypoint.sh"]
