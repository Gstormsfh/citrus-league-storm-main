# Security Documentation

## Overview

This document outlines security practices, policies, and procedures for the Citrus Sports application.

## Security Architecture

### Authentication & Authorization

- **Supabase Auth**: All user authentication handled by Supabase
- **Row Level Security (RLS)**: Database-level access control on all tables
- **League Membership Verification**: Client-side and server-side checks
- **Commissioner Privileges**: Verified via database, not client-side toggles

### Credential Management

#### Environment Variables

All sensitive credentials are stored in environment variables, never in source code:

- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Public anon key (safe for client-side)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-side ONLY)
- `CITRUS_PROXY_USERNAME` - Webshare proxy username
- `CITRUS_PROXY_PASSWORD` - Webshare proxy password
- `CITRUS_PROXY_API_URL` - Webshare API endpoint

#### Credential Storage

- `.env` file (local development) - **NEVER commit to git**
- Environment variables (production) - Set in deployment platform
- `.env.example` - Template file (safe to commit, no real values)

### Security Best Practices

#### ✅ DO

- Use environment variables for all credentials
- Rotate credentials periodically (every 90 days recommended)
- Use different credentials for development and production
- Keep `.env` files in `.gitignore`
- Verify RLS policies are enabled on all tables
- Use Supabase anon key in client-side code only
- Use service role key in server-side Python scripts only
- Validate user permissions before sensitive operations

#### ❌ DON'T

- Never hardcode credentials in source code
- Never commit `.env` files to version control
- Never use service role key in client-side code
- Never expose API tokens or passwords in logs
- Never bypass authentication checks
- Never trust client-side authorization alone

## Credential Rotation Policy

### When to Rotate

1. **Immediately** if credentials are exposed or compromised
2. **Every 90 days** as routine maintenance
3. **After team member departure** who had access
4. **After security incident** or suspected breach

### Rotation Procedure

1. Generate new credentials in service dashboard (Supabase, Webshare, etc.)
2. Update `.env` file with new values
3. Update production environment variables
4. Test application with new credentials
5. Revoke old credentials after verification
6. Document rotation date in this file

### Last Rotation Dates

- Supabase Keys: _[Update after rotation]_
- Proxy Credentials: _[Update after rotation]_

## Incident Response

### If Credentials Are Exposed

1. **Immediately** rotate the exposed credentials
2. Review access logs for unauthorized usage
3. Notify affected services (Supabase, proxy provider, etc.)
4. Document the incident
5. Review and strengthen security measures

### Security Contact

For security concerns or incidents, contact: _[Add contact information]_

## Code Security

### Client-Side Code

- Minified and obfuscated in production builds
- Source maps disabled (`sourcemap: false`)
- No secrets in client bundles
- Console logging silenced in production

### Server-Side Code

- Python scripts use environment variables
- Service role keys only in server-side code
- Proxy credentials only in server-side code
- All database operations respect RLS policies

## Database Security

### Row Level Security (RLS)

All tables have RLS policies that:

- Restrict access based on user authentication
- Verify league membership before data access
- Prevent unauthorized data modification
- Isolate demo league data (read-only for guests)

### Demo League Isolation

- Demo league has no `owner_id` (prevents user association)
- Excluded from user league queries
- Read-only access for unauthenticated users
- Write operations blocked for guests

## API Security

### Supabase API

- Anon key: Public, restricted by RLS policies
- Service role key: Server-side only, full access
- All requests validated by RLS
- Rate limiting handled by Supabase

### External APIs

- Proxy rotation for rate limit protection
- User-Agent rotation for realistic requests
- Circuit breaker to protect proxy pool
- Exponential backoff on rate limits

## Deployment Security

### Build Process

- Source maps disabled
- Code minification enabled
- Environment variables injected at build time
- No secrets in build artifacts

### Hosting

- Firebase Hosting with security headers
- Environment variables in deployment platform
- No credentials in deployment scripts
- HTTPS enforced

## Security Checklist

Before deploying:

- [ ] No hardcoded credentials in code
- [ ] All environment variables documented
- [ ] `.env` file in `.gitignore`
- [ ] RLS policies enabled on all tables
- [ ] Service role key only in server-side code
- [ ] Proxy credentials only in server-side code
- [ ] Source maps disabled in production
- [ ] Console logging silenced in production
- [ ] Security headers configured
- [ ] Credentials rotated if >90 days old

## Security Audit

Last comprehensive audit: January 28, 2026

### Findings

- ✅ Supabase keys properly configured
- ✅ RLS policies comprehensive
- ✅ Authentication flow secure
- ✅ Authorization checks robust
- ✅ Environment variables properly managed
- ✅ No authentication bypasses
- ✅ No privilege escalation vulnerabilities
- ✅ Proxy credentials moved to environment variables

### Remediated Issues

- ✅ Removed hardcoded proxy credentials
- ✅ Added credential validation
- ✅ Created `.env.example` template
- ✅ Added security documentation

## Compliance

### Data Protection

- User passwords: Hashed by Supabase Auth
- Personal data: Protected by RLS policies
- API keys: Stored in environment variables only
- No sensitive data in logs

### Access Control

- User authentication required for all operations
- League membership verified before access
- Commissioner privileges verified server-side
- Demo league isolated from user data

## Updates

This document should be reviewed and updated:

- After security incidents
- After credential rotations
- When adding new services/APIs
- Quarterly as routine maintenance

---

**Last Updated**: January 28, 2026
