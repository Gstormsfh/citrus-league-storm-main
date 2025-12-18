# How to Reset and Start Over with Signup

## Option 1: Sign Out (Recommended)
1. If you're logged in, click your profile in the navbar
2. Click "Log out"
3. This will clear your session and you can sign up again

## Option 2: Clear Browser Storage
1. Open browser DevTools (F12)
2. Go to Application/Storage tab
3. Clear "Local Storage" for your site
4. Refresh the page

## Option 3: Delete Test User from Supabase
1. Go to Supabase Dashboard → Authentication → Users
2. Find and delete your test user
3. This will also delete the associated profile (due to CASCADE)

## Option 4: Reset All Test Data (Development Only)
Run this SQL in Supabase SQL Editor (WARNING: Deletes all data):

```sql
-- Delete all test data
delete from public.draft_picks;
delete from public.draft_order;
delete from public.teams;
delete from public.leagues;
delete from public.profiles;
-- Then delete users from Auth dashboard or:
-- delete from auth.users where email like '%test%';
```

## Fresh Signup Flow
1. Go to `/auth` or click "Get Started" on homepage
2. Click "Sign Up" tab
3. Enter email and password
4. If email confirmation is enabled, check your email and confirm
5. Sign in with your credentials
6. You'll be redirected to `/profile-setup`
7. Fill in username and personal information
8. Click "Complete Setup"
9. You'll be redirected to homepage and can now create leagues!

