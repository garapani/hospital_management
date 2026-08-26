# Hospital Management System - Deployment Guide

This guide covers deployment procedures, Docker build processes, SSL/TLS configuration, and backup strategies for the Hospital Management System.

## Table of Contents

1. [Docker Build Process](#docker-build-process)
2. [SSL/TLS Configuration](#ssl-tls-configuration)
3. [Backup and Recovery](#backup-and-recovery)
4. [API Versioning Strategy](#api-versioning-strategy)
5. [Environment Variables](#environment-variables)
6. [Monitoring and Observability](#monitoring-and-observability)

---

## Docker Build Process

### Building the API Image

```bash
# Development build
docker build -t hospital-api:dev \
  --build-arg NODE_ENV=development \
  -f apps/api/Dockerfile .

# Production build (multi-stage)
docker build -t hospital-api:latest \
  --build-arg NODE_ENV=production \
  --build-arg NPM_CONFIG_PRODUCTION=true \
  -f apps/api/Dockerfile.prod .
```

### Docker Compose Setup

For local development with all dependencies:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

This starts:
- PostgreSQL 16 database
- Redis 7 cache
- API application (with hot-reload in dev mode)

### Production Deployment

```yaml
# Example Kubernetes deployment snippet
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hospital-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hospital-api
  template:
    spec:
      containers:
      - name: api
        image: hospital-api:latest
        env:
        - name: NODE_ENV
          value: "production"
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: host
        ports:
        - containerPort: 3000
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

---

## SSL/TLS Configuration

### Termination Strategies

#### Option 1: Load Balancer Termination (Recommended)

Terminate SSL at the load balancer (AWS ALB, NGINX, Traefik):

```yaml
# AWS ALB Ingress annotation example
metadata:
  annotations:
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:region:account:certificate/id
    alb.ingress.kubernetes.io/ssl-redirect: '443'
```

**Pros:**
- Centralized certificate management
- Offloads encryption/decryption from application
- Easier certificate rotation

**Configuration:**
```nginx
# NGINX example
server {
    listen 443 ssl http2;
    server_name api.hospital.example.com;
    
    ssl_certificate /etc/nginx/ssl/hospital.crt;
    ssl_certificate_key /etc/nginx/ssl/hospital.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    location / {
        proxy_pass http://hospital-api:3000;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

#### Option 2: Application-Level Termination

If terminating at the application layer:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import * as https from 'https';
import * as fs from 'fs';

async function bootstrap() {
  const httpsOptions = {
    key: fs.readFileSync('./secrets/private-key.pem'),
    cert: fs.readFileSync('./secrets/certificate.pem'),
  };
  
  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });
  
  await app.listen(443);
}
bootstrap();
```

### Certificate Management

Use Let's Encrypt with automatic renewal:

```bash
# Install certbot
apt-get install certbot python3-certbot-nginx

# Obtain certificate
certbot --nginx -d api.hospital.example.com

# Auto-renewal (cron job)
0 3 * * * certbot renew --quiet
```

---

## Backup and Recovery

### Database Backup Strategy

#### Automated Daily Backups

```bash
#!/bin/bash
# backup-postgres.sh

BACKUP_DIR="/backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup
pg_dump -h $DB_HOST -U $DB_USERNAME $DB_DATABASE | gzip > $BACKUP_DIR/hospital_$DATE.sql.gz

# Delete old backups
find $BACKUP_DIR -name "hospital_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/hospital_$DATE.sql.gz s3://hospital-backups/postgres/
```

#### Cron Schedule

```cron
# Daily backup at 2 AM
0 2 * * * /scripts/backup-postgres.sh >> /var/log/backup.log 2>&1
```

#### Point-in-Time Recovery (PITR)

Enable WAL archiving in `postgresql.conf`:

```conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://hospital-backups/wal/%f'
max_wal_senders = 3
```

### Redis Backup

Redis data is ephemeral; focus on persistence configuration:

```conf
# redis.conf
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
```

### Backup Verification

Weekly backup restoration test:

```bash
#!/bin/bash
# verify-backup.sh

LATEST_BACKUP=$(ls -t /backups/postgres/hospital_*.sql.gz | head -1)
TEST_DB="hospital_verify_$(date +%s)"

# Restore to test database
gunzip -c $LATEST_BACKUP | psql -h localhost -U postgres -d $TEST_DB

# Run integrity checks
psql -h localhost -U postgres -d $TEST_DB -c "SELECT COUNT(*) FROM patients;"
psql -h localhost -U postgres -d $TEST_DB -c "SELECT COUNT(*) FROM invoices;"

# Cleanup
dropdb $TEST_DB
```

### Disaster Recovery Plan

1. **RTO (Recovery Time Objective):** 4 hours
2. **RPO (Recovery Point Objective):** 24 hours (daily backups)

**Recovery Steps:**
1. Provision new infrastructure
2. Restore latest database backup
3. Apply WAL logs if PITR needed
4. Update DNS/load balancer targets
5. Verify health checks
6. Resume normal operations

---

## API Versioning Strategy

### URL Versioning (Recommended)

```
GET /api/v1/patients
GET /api/v2/patients
```

**Implementation:**

```typescript
// main.ts
app.setGlobalPrefix('api/v1');

// Future version
// app.setGlobalPrefix('api/v2');
```

### Deprecation Policy

1. **New Version Release:**
   - Maintain previous version for minimum 6 months
   - Document breaking changes in changelog
   - Add `Deprecation` header to old version responses

2. **Breaking Change Examples:**
   - Removing fields from responses
   - Changing field types
   - Modifying authentication mechanisms
   - Altering error response formats

3. **Non-Breaking Changes (Safe for Current Version):**
   - Adding new endpoints
   - Adding optional request parameters
   - Adding new response fields
   - Performance improvements

### Version Migration Example

```typescript
// v1 controller
@Controller('api/v1/patients')
export class PatientsControllerV1 {
  @Get()
  find() {
    return { id: '1', name: 'John' };
  }
}

// v2 controller (parallel deployment)
@Controller('api/v2/patients')
export class PatientsControllerV2 {
  @Get()
  find() {
    return { 
      id: '1', 
      firstName: 'John', 
      lastName: 'Doe',
      metadata: { createdAt: '2024-01-01' }
    };
  }
}
```

---

## Environment Variables

### Required Variables

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=hospital_user
DB_PASSWORD=secure_password_here
DB_DATABASE=hospital_db
DB_POOL_MAX=20
DB_STATEMENT_TIMEOUT_MS=30000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Rate Limiting (applies to every route; login/refresh/change-password override it to a tighter
# limit — see AuthController)
RATE_LIMIT_DEFAULT=100

# JWT
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Application
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://hospital.example.com

# Observability
LOG_LEVEL=info
SENTRY_DSN=https://key@sentry.io/project-id
```

### Security Best Practices

- Use secrets management (AWS Secrets Manager, HashiCorp Vault)
- Never commit `.env` files to version control
- Rotate secrets quarterly
- Use different credentials per environment

---

## Monitoring and Observability

### Health Checks

```typescript
// Health endpoint already configured at /health
// Returns: { status: 'ok', info: { database: { status: 'up' }, redis: { status: 'up' } } }
```

### Metrics to Monitor

1. **Application Metrics:**
   - Request rate (req/s)
   - Response time (p95, p99)
   - Error rate (%)
   - Active connections

2. **Database Metrics:**
   - Connection pool utilization
   - Query execution time
   - Transaction rate
   - Deadlock count

3. **Business Metrics:**
   - Active tenants
   - Daily patient registrations
   - Invoice volume
   - API usage by module

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Error Rate | > 1% | > 5% |
| Response Time (p95) | > 500ms | > 2000ms |
| DB Pool Usage | > 80% | > 95% |
| Disk Usage | > 70% | > 90% |

### Log Aggregation

Configure structured logging:

```typescript
// Already configured via ObservabilityLoggerModule
// Logs are JSON-formatted and include:
// - timestamp
// - level
// - message
// - context
// - tenantId (when available)
// - userId (when authenticated)
```

Send logs to centralized system (ELK, Splunk, Datadog):

```yaml
# Fluentd configuration example
<match hospital.**>
  @type elasticsearch
  host elasticsearch.logging.svc
  port 9200
  index_name hospital-logs
</match>
```

---

## Scaling Recommendations

### Horizontal Scaling

- **Stateless API:** Scale horizontally behind load balancer
- **Database:** Read replicas for reporting queries
- **Redis:** Cluster mode for high availability

### Vertical Scaling

Minimum recommended instance sizes:

| Component | CPU | Memory | Storage |
|-----------|-----|--------|---------|
| API (per instance) | 2 cores | 4 GB | 20 GB |
| PostgreSQL | 4 cores | 16 GB | 100 GB SSD |
| Redis | 2 cores | 4 GB | 10 GB |

---

## Support

For deployment issues or questions:
- Check application logs: `kubectl logs -f deployment/hospital-api`
- Review health endpoint: `curl https://api.hospital.example.com/health`
- Contact DevOps team: devops@hospital.example.com

Last updated: August 2024
