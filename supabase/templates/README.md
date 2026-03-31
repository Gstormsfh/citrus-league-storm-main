# Supabase Email Templates

Branded email templates for Citrus Fantasy Sports authentication emails.

## Templates

| File | Purpose | Supabase Dashboard Section |
|------|---------|---------------------------|
| `confirm_signup.html` | New user email verification | Authentication > Email Templates > Confirm signup |
| `reset_password.html` | Password reset link | Authentication > Email Templates > Reset password |
| `magic_link.html` | Magic link sign-in | Authentication > Email Templates > Magic link |
| `email_change.html` | Email address change | Authentication > Email Templates > Change email address |

## Deploying to Production

These templates are automatically used in local development via `config.toml`. For production (hosted Supabase), you must manually update the templates in the Supabase Dashboard:

1. Go to **Authentication > Email Templates** in your Supabase project
2. For each template type, paste the corresponding HTML from this directory
3. Set the **Subject** line to match the subjects in `config.toml`

### Subject Lines

- **Confirm signup:** `Confirm your email — Citrus Fantasy Sports`
- **Reset password:** `Reset your password — Citrus Fantasy Sports`
- **Magic link:** `Sign in to Citrus Fantasy Sports`
- **Change email:** `Confirm email change — Citrus Fantasy Sports`

## Template Variables

Supabase uses Go template syntax. The main variable is `{{ .ConfirmationURL }}` which contains the full confirmation/reset/sign-in link.
