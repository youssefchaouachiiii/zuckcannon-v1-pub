# GitHub Actions CI/CD Setup Guide

## Overview

This project uses GitHub Actions for automated testing, building, and deployment. The CI/CD pipeline includes:

- **CI Workflow** (`ci.yml`) - Tests and linting on all branches
- **Deploy Workflow** (`deploy.yml`) - Tests, builds, and deploys on push to `staging` or `production`
- **Security Scan** (`security-scan.yml`) - Weekly security audits and vulnerability scanning
- **Rollback** (`rollback.yml`) - Manual rollback to previous versions
- **Release** (`release.yml`) - Automated releases on git tags

## Required Secrets

Set these secrets in GitHub Settings → Secrets and variables → Actions:

### Docker Registry
- `DOCKER_USERNAME` - Your Docker Hub username
- `DOCKER_PASSWORD` - Your Docker Hub access token (not password)

### Server Deployment
- `SERVER_HOST` - Your server IP or hostname
- `SERVER_USERNAME` - SSH username for server access
- `SERVER_SSH_KEY` - Private SSH key for authentication

### Optional
- `SNYK_TOKEN` - Snyk security scanning token (for security-scan.yml)
- `SLACK_WEBHOOK_URL` - Slack webhook for notifications (for release.yml)

## Step 1: Prepare Your Docker Hub

1. Go to [Docker Hub](https://hub.docker.com)
2. Create a repository named `zuckcannon`
3. Generate an access token:
   - Account Settings → Security → Access Tokens
   - Create token and copy it

## Step 2: Generate SSH Key for Server Access

```bash
ssh-keygen -t ed25519 -f zuckcannon-deploy -C "github-actions"
```

Copy the public key to your server:
```bash
ssh-copy-id -i zuckcannon-deploy.pub user@your-server.com
```

## Step 3: Add GitHub Secrets

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Create new secrets:

```
DOCKER_USERNAME = yourdockerusername
DOCKER_PASSWORD = your_docker_access_token
SERVER_HOST = your-server.com
SERVER_USERNAME = your_ssh_username
SERVER_SSH_KEY = (paste entire private key content)
```

## Step 4: Update Dockerfile (Optional)

If your app needs health checks, update the Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1
```

## Step 5: Update package.json Scripts

For testing to work, add these scripts to `package.json`:

```json
{
  "scripts": {
    "start": "node init-directories.js && node server.js",
    "dev": "node init-directories.js && nodemon server.js",
    "test": "jest --coverage",
    "lint": "eslint ."
  }
}
```

## Workflows Overview

### CI Workflow (ci.yml)
Runs on every push and pull request to verify code quality:
- Installs dependencies
- Runs linting (if configured)
- Runs tests (if configured)
- Builds Docker image

**Triggers:**
- Any push to any branch
- Pull requests to `main` or `staging`

### Deploy Workflow (deploy.yml)
Builds and deploys Docker image to your server:
1. Runs tests
2. Builds Docker image and pushes to Docker Hub
3. Pulls image on server and restarts container
4. Verifies container health

**Triggers:**
- Push to `staging` branch
- Push to `production` branch
- Manual trigger (workflow_dispatch)

### Security Scan (security-scan.yml)
Scans for vulnerabilities:
- `npm audit` for dependencies
- Trivy for container image vulnerabilities
- Optional: Snyk integration

**Triggers:**
- Weekly on Sunday at midnight
- On push to `staging`/`main`
- On pull requests

### Rollback (rollback.yml)
Manual rollback to a previous version:

```bash
# On GitHub Actions tab, click "Run workflow"
# Select environment and version to rollback to
```

### Release (release.yml)
Creates releases when you push git tags:

```bash
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0
```

## Environment Variables

Your server must have `/root/zuck/.env` with:
```
NODE_ENV=production
PORT=3000
DATABASE_URL=...
# Add other vars as needed
```

## Docker Hub Image Tagging

Images are automatically tagged with:
- `yourusername/zuckcannon:staging` - Latest from staging branch
- `yourusername/zuckcannon:production` - Latest from production branch
- `yourusername/zuckcannon:vX.Y.Z` - Semantic version tags
- `yourusername/zuckcannon:sha-abc123` - Git commit SHA

## Monitoring & Debugging

### View Workflow Runs
1. Go to Actions tab in GitHub
2. Click on a workflow to see detailed logs

### Check Deployment Status
- Success: Green checkmark on commit
- Failure: Red X with error details

### SSH into Server
```bash
ssh -i zuckcannon-deploy user@your-server.com
docker logs zuckcannon
docker ps -a
```

## Common Issues

### Docker build fails
- Check `Dockerfile` is in root directory
- Verify all COPY paths exist
- Check dependencies in `package.json`

### Deployment fails
- Verify secrets are set correctly
- Check SSH key permissions: `chmod 600 private_key`
- Verify server is reachable: `ssh -i key user@server`
- Check container logs: `docker logs zuckcannon`

### Container won't start
- Verify `.env` file exists on server
- Check application logs for errors
- Ensure port 3000 is available

### Tests fail in CI
- Run locally first: `npm test`
- Add test scripts to `package.json`
- Check for environment variables needed

## Next Steps

1. **Add linting**: Install ESLint
   ```bash
   npm install --save-dev eslint
   npm init @eslint/config
   ```

2. **Add testing**: Set up Jest
   ```bash
   npm install --save-dev jest supertest
   npx jest --init
   ```

3. **Enable branch protection**: Settings → Branches → Require status checks to pass

4. **Set up notifications**: Add Slack webhook for alerts

5. **Configure auto-deployment**: Update workflow triggers as needed
